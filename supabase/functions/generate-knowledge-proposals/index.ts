import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import {
  buildCaptureProposalMessages,
  captureProposalSchema,
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

type ServerConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  groqApiUrl: string;
  groqApiKey: string;
  reasoningModel: string;
};

class ProviderError extends Error {
  constructor(public readonly publicMessage: string, public readonly status: number) {
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

function groqError(status: number) {
  if (status === 401 || status === 403) return new ProviderError('Relay’s organizing service needs attention.', 503);
  if (status === 413) return new ProviderError('This capture is too large to organize at once. Split it into smaller captures.', 422);
  if (status === 429) return new ProviderError('Relay is organizing many captures right now. Wait a moment and try again.', 429);
  return new ProviderError('Relay could not organize this capture. Your capture is safe; retry in a moment.', 503);
}

async function markCaptureFailed(admin: ReturnType<typeof createClient>, captureId: string, error: unknown) {
  const message = error instanceof StructuringError || error instanceof ProviderError
    ? error.publicMessage
    : 'Relay could not organize this capture. Your capture is safe; retry in a moment.';
  await admin.from('captures').update({
    structuring_status: 'failed',
    structuring_failure_reason: message.slice(0, 500),
    structured_at: null,
    structured_proposal_count: null,
  }).eq('id', captureId).eq('structuring_status', 'processing');
}

async function requestCaptureProposals(
  config: ServerConfig,
  roleTitle: string,
  evidence: CaptureEvidence[],
  approvedKnowledge: ApprovedKnowledge[],
) {
  const response = await fetch(`${config.groqApiUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.groqApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.reasoningModel,
      reasoning_effort: 'low',
      temperature: 0,
      max_completion_tokens: 8_000,
      messages: buildCaptureProposalMessages({ roleTitle, evidence, approvedKnowledge }),
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'relay_capture_proposals', strict: true, schema: captureProposalSchema },
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw groqError(response.status);
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new StructuringError('Relay did not receive structured suggestions. Retry in a moment.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    throw new StructuringError('Relay received an unreadable structured response. Retry in a moment.');
  }
  return validateCaptureProposalOutput(decoded, evidence, new Set(approvedKnowledge.map((item) => item.id)));
}

async function organizeCapture(
  config: ServerConfig,
  client: ReturnType<typeof createClient>,
  admin: ReturnType<typeof createClient>,
  captureId: string,
) {
  const { data: capture, error: captureError } = await client
    .from('captures')
    .select('id, organization_id, handoff_id, submitted_at')
    .eq('id', captureId)
    .maybeSingle();
  if (captureError || !capture) return json({ error: 'This capture is unavailable.' }, 404);
  if (!capture.submitted_at) return json({ error: 'Save this capture before organizing it.' }, 409);

  const { data: isHolder, error: holderError } = await client.rpc('is_role_holder_for_handoff', {
    requested_handoff_id: capture.handoff_id,
  });
  if (holderError || !isHolder) return json({ error: 'You do not have permission to organize this capture.' }, 403);

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
    return json({
      error: failedAttachment.failure_reason ?? 'Relay could not process an attached file. Organize again to retry it.',
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
  if (!evidence.length) return json({ error: 'Add text or a readable file before organizing.' }, 409);
  const evidenceCharacters = evidence.reduce((total, item) => total + item.text.length, 0);
  if (evidenceCharacters > MAX_CAPTURE_EVIDENCE_CHARS) {
    return json({ error: 'This capture contains too much readable text to organize safely at once. Split it into smaller captures.' }, 422);
  }

  const { data: claimed, error: claimError } = await admin.from('captures').update({
    structuring_status: 'processing',
    structuring_failure_reason: null,
    structured_at: null,
    structured_proposal_count: null,
  }).eq('id', captureId).in('structuring_status', ['not_started', 'failed', 'ready']).select('id').maybeSingle();
  if (claimError) return json({ error: 'Relay could not start organizing this capture.' }, 500);
  if (!claimed) return json({ error: 'This capture is already being organized.' }, 409);

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

    const proposals = await requestCaptureProposals(config, role.title, evidence, approved ?? []);
    const { data: count, error: storeError } = await client.rpc('replace_capture_knowledge_proposals', {
      requested_capture_id: captureId,
      requested_proposals: proposals,
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
    return json({ error: message, captureId }, status);
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
  const client = createClient(config.supabaseUrl, config.anonKey, {
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
  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  return organizeCapture(config, client, admin, captureId);
});
