import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';
import type { Database } from '../../../src/types/database.ts';
import {
  buildCaptureProposalMessages,
  captureProposalSchema,
  NonRetryableStructuringError,
  selectRelevantApprovedKnowledge,
  StructuringError,
  validateCaptureProposalOutput,
  type ApprovedKnowledge,
  type CaptureEvidence,
} from '../_shared/organize-proposals.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MAX_CAPTURE_EVIDENCE_CHARS = 120_000;
// The configured on-demand reasoning tier enforces a 1,000 output-token/minute
// ceiling. Asking for 16,000 made every otherwise-valid Organize call fail as
// "request too large" before the model ran. Keep one Capture inside the actual
// provider contract; unusually dense Captures already fail closed and can be
// split by the user.
const MAX_ORGANIZE_COMPLETION_TOKENS = 1_000;
const MAX_PROVIDER_ATTEMPTS = 2;

type ServerConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  groqApiUrl: string;
  groqApiKey: string;
  reasoningModel: string;
};

type RelaySupabaseClient = SupabaseClient<Database>;

class ProviderError extends Error {
  constructor(
    public readonly publicMessage: string,
    public readonly status: number,
    /** false when retrying the same capture right away would just hit the same wall (rate limit, oversized file, auth) — the client must never auto-fire Organize again for these. */
    public readonly retryable: boolean,
  ) {
    super(publicMessage);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders });
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function readConfig(): ServerConfig {
  return {
    supabaseUrl: requiredEnv('SUPABASE_URL').replace(/\/$/, ''),
    anonKey: requiredEnv('SUPABASE_ANON_KEY'),
    serviceRoleKey: requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    groqApiUrl: requiredEnv('GROQ_API_URL').replace(/\/$/, ''),
    groqApiKey: requiredEnv('GROQ_API_KEY'),
    reasoningModel: requiredEnv('GROQ_REASONING_MODEL'),
  };
}

function groqErrorCode(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const providerError = (body as Record<string, unknown>).error;
  if (!providerError || typeof providerError !== 'object') return '';
  const code = (providerError as Record<string, unknown>).code;
  return typeof code === 'string' ? code : '';
}

function groqError(status: number, body: unknown) {
  if (status === 401 || status === 403) {
    return new ProviderError("Relay's organizing service needs attention.", 503, false);
  }
  if (status === 413) {
    return new ProviderError('This capture is too large to organize at once. Split it into smaller captures.', 422, false);
  }
  // Rate limits are never auto-retried: firing the same request again immediately
  // just spends more of the same per-minute token budget and fails again.
  if (status === 429 || groqErrorCode(body) === 'rate_limit_exceeded') {
    return new ProviderError('Relay is busy organizing other captures right now. Wait a few minutes, then choose Organize again.', 429, false);
  }
  return new ProviderError('Relay could not organize this capture. Your capture is safe; retry in a moment.', 503, true);
}

async function markCaptureFailed(admin: RelaySupabaseClient, captureId: string, error: unknown) {
  const message = error instanceof StructuringError || error instanceof ProviderError
    ? error.publicMessage
    : 'Relay could not organize this capture. Your capture is safe; retry in a moment.';
  await admin.from('captures').update({
    structuring_status: 'failed',
    structuring_failure_reason: message.slice(0, 500),
    structured_at: null,
    structured_proposal_count: null,
    structured_dropped_count: null,
    organize_requested_at: null,
  }).eq('id', captureId).eq('structuring_status', 'processing');
}

async function failWaitingCapture(
  admin: RelaySupabaseClient,
  captureId: string,
  message: string,
) {
  await admin.from('captures').update({
    structuring_status: 'failed',
    structuring_failure_reason: message.slice(0, 500),
    structured_at: null,
    structured_proposal_count: null,
    structured_dropped_count: null,
    organize_requested_at: null,
  }).eq('id', captureId).not('organize_requested_at', 'is', null).neq('structuring_status', 'processing');
}

async function requestCaptureProposals(
  config: ServerConfig,
  roleTitle: string,
  evidence: CaptureEvidence[],
  approvedKnowledge: ApprovedKnowledge[],
) {
  for (let attempt = 0; attempt < MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${config.groqApiUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.reasoningModel,
        temperature: 0,
        max_completion_tokens: MAX_ORGANIZE_COMPLETION_TOKENS,
        // Qwen can otherwise spend this tier's entire output allowance on hidden
        // reasoning and return an empty schema-compliant proposal list. Organize
        // is extraction/classification, so instruct mode is the appropriate path.
        reasoning_effort: config.reasoningModel.startsWith('qwen/') ? 'none' : 'low',
        messages: buildCaptureProposalMessages({ roleTitle, evidence, approvedKnowledge }),
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'relay_capture_proposals', strict: true, schema: captureProposalSchema },
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerError = groqError(response.status, body);
      if (providerError.retryable && attempt + 1 < MAX_PROVIDER_ATTEMPTS) {
        console.warn('Retrying transient Organize provider response', JSON.stringify({
          status: response.status,
          code: groqErrorCode(body),
          attempt: attempt + 1,
        }));
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      throw providerError;
    }
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      if (attempt + 1 < MAX_PROVIDER_ATTEMPTS) continue;
      throw new StructuringError('Relay did not receive structured suggestions. Retry in a moment.');
    }
    try {
      return validateCaptureProposalOutput(
        JSON.parse(content),
        evidence,
        new Set(approvedKnowledge.map((item) => item.id)),
      );
    } catch (error) {
      if (error instanceof SyntaxError && attempt + 1 < MAX_PROVIDER_ATTEMPTS) continue;
      if (error instanceof SyntaxError) {
        throw new StructuringError('Relay received an unreadable structured response. Retry in a moment.');
      }
      throw error;
    }
  }
  throw new StructuringError('Relay did not receive structured suggestions. Retry in a moment.');
}

/**
 * Only a structurally broken model response fails the whole capture. An
 * individually invalid suggestion (bad span citation, duplicate, etc.) is
 * dropped so the rest of a good batch still reaches Review.
 */
function requireSomeValidProposals(captureId: string, result: { valid: unknown[]; rejected: Array<{ index: number; reason: string }> }) {
  if (result.rejected.length) {
    console.warn('Capture organize dropped invalid suggestions', JSON.stringify({
      captureId,
      dropped: result.rejected.length,
      kept: result.valid.length,
      reasons: result.rejected.map((item) => item.reason),
    }));
  }
  if (!result.valid.length && result.rejected.length) {
    throw new StructuringError('Relay could not verify some proposed knowledge against the original source. Retry in a moment.');
  }
}

async function organizeCapture(
  config: ServerConfig,
  client: RelaySupabaseClient,
  admin: RelaySupabaseClient,
  captureId: string,
) {
  const { data: capture, error: captureError } = await client
    .from('captures')
    .select('id, organization_id, handoff_id, submitted_at, structuring_status, organize_requested_at')
    .eq('id', captureId)
    .maybeSingle();
  if (captureError || !capture) return json({ error: 'This capture is unavailable.' }, 404);
  if (!capture.submitted_at) return json({ error: 'Save this capture before organizing it.' }, 409);

  const { data: isHolder, error: holderError } = await client.rpc('is_role_holder_for_handoff', {
    requested_handoff_id: capture.handoff_id,
  });
  if (holderError || !isHolder) return json({ error: 'You do not have permission to organize this capture.' }, 403);

  if (!capture.organize_requested_at) {
    if (capture.structuring_status === 'processing') {
      return json({ waiting: true, alreadyOrganizing: true, captureId }, 202);
    }
    return json({ error: 'Choose Organize before generating suggestions.' }, 409);
  }

  // Recover abandoned source/capture work before deciding whether this
  // explicitly requested run is still waiting on an attachment.
  const { error: sweepError } = await client.rpc('sweep_stale_capture_processing', {
    target_handoff_id: capture.handoff_id,
  });
  if (sweepError) return json({ error: 'Relay could not check Organize progress.' }, 500);

  const { data: relations, error: relationError } = await client
    .from('capture_sources')
    .select('source_id, relationship, position')
    .eq('capture_id', captureId)
    .is('removed_at', null)
    .order('position', { ascending: true });
  if (relationError) return json({ error: 'Relay could not read this capture.' }, 500);
  const sourceIds = (relations ?? []).map((relation) => relation.source_id);
  const { data: sources, error: sourceError } = sourceIds.length
    ? await client.from('sources')
      .select('id, kind, title, text_content, processing_status, failure_reason')
      .in('id', sourceIds)
    : { data: [], error: null };
  if (sourceError) return json({ error: 'Relay could not read this capture evidence.' }, 500);
  const sourceById = new Map((sources ?? []).map((source) => [source.id, source]));
  const attachments = (relations ?? []).filter((relation) => relation.relationship === 'attachment');
  const failedAttachment = attachments
    .map((relation) => sourceById.get(relation.source_id))
    .find((source) => source?.processing_status === 'failed');
  if (failedAttachment) {
    const message = failedAttachment.failure_reason ?? 'Relay could not process an attached file. Organize again to retry it.';
    await failWaitingCapture(admin, captureId, message);
    return json({
      error: message,
      captureId,
      attachmentFailed: true,
    }, 409);
  }
  if (attachments.some((relation) => {
    const source = sourceById.get(relation.source_id);
    return !source || source.processing_status !== 'ready' || !source.text_content?.trim();
  })) {
    return json({ waiting: true, captureId }, 202);
  }

  const evidence: CaptureEvidence[] = [];
  for (const relation of relations ?? []) {
    const source = sourceById.get(relation.source_id);
    if (!source?.text_content?.trim()) continue;
    evidence.push({
      sourceId: source.id,
      label: relation.relationship === 'text' ? 'Capture note' : source.title,
      kind: relation.relationship === 'text' ? 'capture_text' : 'attachment',
      text: source.text_content,
    });
  }
  if (!evidence.length) {
    const message = 'Add text or a readable file before organizing.';
    await failWaitingCapture(admin, captureId, message);
    return json({ error: message }, 409);
  }
  const evidenceCharacters = evidence.reduce((total, item) => total + item.text.length, 0);
  if (evidenceCharacters > MAX_CAPTURE_EVIDENCE_CHARS) {
    const message = 'This capture contains too much readable text to organize safely at once. Split it into smaller captures.';
    await failWaitingCapture(admin, captureId, message);
    return json({ error: message, retryable: false }, 422);
  }

  const { data: claimed, error: claimError } = await admin.from('captures').update({
    structuring_status: 'processing',
    structuring_failure_reason: null,
    structured_at: null,
    structured_proposal_count: null,
    structured_dropped_count: null,
    organize_requested_at: null,
  }).eq('id', captureId)
    .not('organize_requested_at', 'is', null)
    .in('structuring_status', ['not_started', 'failed', 'ready'])
    .select('id').maybeSingle();
  if (claimError) return json({ error: 'Relay could not start organizing this capture.' }, 500);
  if (!claimed) return json({ waiting: true, alreadyOrganizing: true, captureId }, 202);

  try {
    const { data: handoff, error: handoffError } = await client.from('handoffs')
      .select('role_id').eq('id', capture.handoff_id).single();
    if (handoffError) throw handoffError;
    const { data: role, error: roleError } = await client.from('roles')
      .select('title').eq('id', handoff.role_id).single();
    if (roleError) throw roleError;
    const { data: approved, error: approvedError } = await client.from('knowledge_items')
      .select('id, knowledge_type, title, content')
      .eq('handoff_id', capture.handoff_id)
      .eq('status', 'approved')
      .order('sort_order', { ascending: true });
    if (approvedError) throw approvedError;

    const approvedContext = selectRelevantApprovedKnowledge(approved ?? [], evidence);
    const result = await requestCaptureProposals(config, role.title, evidence, approvedContext);
    requireSomeValidProposals(captureId, result);
    const proposals = result.valid;
    const { data: count, error: storeError } = await client.rpc('replace_capture_knowledge_proposals', {
      requested_capture_id: captureId,
      requested_proposals: proposals,
      requested_dropped_count: result.rejected.length,
    });
    if (storeError) throw storeError;
    return json({ ready: true, captureId, proposalCount: typeof count === 'number' ? count : proposals.length });
  } catch (error) {
    const diagnostic = error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : 'unknown error';
    console.error('Capture organizing failed', diagnostic);
    await markCaptureFailed(admin, captureId, error);
    const message = error instanceof StructuringError || error instanceof ProviderError
      ? error.publicMessage
      : 'Relay could not organize this capture. Your capture is safe; retry in a moment.';
    const status = error instanceof ProviderError ? error.status : 422;
    // Authoritative for the client's auto-retry decision — a rate limit or an
    // oversized-capture failure must never be silently fired again.
    const retryable = error instanceof ProviderError
      ? error.retryable
      : !(error instanceof NonRetryableStructuringError);
    return json({ error: message, captureId, retryable }, status);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let config: ServerConfig;
  try {
    config = readConfig();
  } catch {
    return json({ error: 'Server configuration is incomplete.' }, 500);
  }
  const authorization = request.headers.get('Authorization');
  if (!authorization) return json({ error: 'Authentication required.' }, 401);
  const client = createClient<Database>(config.supabaseUrl, config.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Your session is no longer valid.' }, 401);

  let captureId = '';
  try {
    const body = await request.json();
    captureId = typeof body?.captureId === 'string' ? body.captureId : '';
  } catch {
    return json({ error: 'A capture ID is required.' }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(captureId)) {
    return json({ error: 'A valid capture ID is required.' }, 400);
  }
  const admin = createClient<Database>(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  return organizeCapture(config, client, admin, captureId);
});
