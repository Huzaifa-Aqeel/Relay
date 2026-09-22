import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FINDING_TYPES = new Set(['missing', 'ambiguous', 'incomplete', 'contradiction']);
const SEVERITIES = new Set(['critical', 'optional']);
const KNOWLEDGE_TYPES = new Set([
  'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson',
]);
const MAX_FINDINGS = 30;

type ServerConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  groqApiUrl: string;
  groqApiKey: string;
  reasoningModel: string;
  astraEndpoint: string;
  astraToken: string;
  astraKeyspace: string;
  astraCollection: string;
};

type Evidence = {
  ref: string;
  evidenceKind: 'knowledge' | 'source';
  knowledgeItemId: string | null;
  sourceId: string | null;
  label: string;
  excerpt: string;
  locator: string | null;
};

type ModelFinding = {
  finding_type: string;
  severity: string;
  title: string;
  question: string;
  explanation: string;
  suggested_knowledge_type: string | null;
  primary_evidence_ref: string | null;
  evidence_refs: string[];
};

class PreflightError extends Error {
  constructor(public readonly publicMessage: string) {
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
    astraEndpoint: requiredEnv('ASTRA_DB_API_ENDPOINT').replace(/\/$/, ''),
    astraToken: requiredEnv('ASTRA_DB_APPLICATION_TOKEN'),
    astraKeyspace: requiredEnv('ASTRA_DB_KEYSPACE'),
    astraCollection: requiredEnv('ASTRA_DB_COLLECTION'),
  };
}

const preflightSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          finding_type: {
            type: 'string',
            enum: ['missing', 'ambiguous', 'incomplete', 'contradiction'],
          },
          severity: { type: 'string', enum: ['critical', 'optional'] },
          title: { type: 'string' },
          question: { type: 'string' },
          explanation: { type: 'string' },
          suggested_knowledge_type: {
            type: ['string', 'null'],
            enum: [
              'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson', null,
            ],
          },
          primary_evidence_ref: { type: ['string', 'null'] },
          evidence_refs: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'finding_type', 'severity', 'title', 'question', 'explanation',
          'suggested_knowledge_type', 'primary_evidence_ref', 'evidence_refs',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
};

function limitText(value: string, max: number) {
  const clean = value.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

async function astraCommand(config: ServerConfig, command: Record<string, unknown>) {
  const response = await fetch(
    `${config.astraEndpoint}/api/json/v1/${encodeURIComponent(config.astraKeyspace)}/${encodeURIComponent(config.astraCollection)}`,
    {
      method: 'POST',
      headers: { Token: config.astraToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || (Array.isArray(body.errors) && body.errors.length)) {
    throw new PreflightError('Relay could not retrieve the supporting document evidence. Retry Preflight in a moment.');
  }
  return body;
}

async function documentEvidence(
  config: ServerConfig,
  organizationId: string,
  handoffId: string,
  query: string,
  currentSourceIds: string[],
) {
  if (!currentSourceIds.length) return [];
  const result = await astraCommand(config, {
    find: {
      filter: {
        organization_id: organizationId,
        handoff_id: handoffId,
        source_id: { $in: currentSourceIds.slice(0, 500) },
      },
      sort: { $vectorize: limitText(query, 1_500) },
      projection: {
        _id: 1,
        source_id: 1,
        source_title: 1,
        text: 1,
        page_number: 1,
        element_type: 1,
      },
      options: { limit: 30, includeSimilarity: true },
    },
  });
  return Array.isArray(result?.data?.documents) ? result.data.documents : [];
}

function validateFinding(value: unknown, evidenceByRef: Map<string, Evidence>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PreflightError('Relay received an invalid Preflight finding. Retry in a moment.');
  }
  const candidate = value as Record<string, unknown>;
  const expected = [
    'evidence_refs', 'explanation', 'finding_type', 'primary_evidence_ref',
    'question', 'severity', 'suggested_knowledge_type', 'title',
  ];
  const keys = Object.keys(candidate).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new PreflightError('Relay received an invalid Preflight finding. Retry in a moment.');
  }
  if (typeof candidate.finding_type !== 'string' || !FINDING_TYPES.has(candidate.finding_type)) {
    throw new PreflightError('Relay received an unsupported Preflight finding type. Retry in a moment.');
  }
  if (typeof candidate.severity !== 'string' || !SEVERITIES.has(candidate.severity)) {
    throw new PreflightError('Relay received an invalid Preflight severity. Retry in a moment.');
  }
  if (typeof candidate.title !== 'string' || candidate.title.trim().length < 1 || candidate.title.trim().length > 160
    || typeof candidate.question !== 'string' || candidate.question.trim().length < 1 || candidate.question.trim().length > 500
    || typeof candidate.explanation !== 'string' || candidate.explanation.trim().length < 1 || candidate.explanation.trim().length > 2_000) {
    throw new PreflightError('Relay received invalid Preflight copy. Retry in a moment.');
  }
  if (candidate.suggested_knowledge_type !== null
    && (typeof candidate.suggested_knowledge_type !== 'string'
      || !KNOWLEDGE_TYPES.has(candidate.suggested_knowledge_type))) {
    throw new PreflightError('Relay received an invalid suggested knowledge type. Retry in a moment.');
  }
  if (candidate.primary_evidence_ref !== null && typeof candidate.primary_evidence_ref !== 'string') {
    throw new PreflightError('Relay received invalid primary evidence. Retry in a moment.');
  }
  if (!Array.isArray(candidate.evidence_refs)
    || candidate.evidence_refs.length < 1
    || candidate.evidence_refs.length > 6
    || candidate.evidence_refs.some((ref) => typeof ref !== 'string' || !evidenceByRef.has(ref))) {
    throw new PreflightError('Relay could not verify a Preflight finding against its evidence. Retry in a moment.');
  }
  const evidenceRefs = [...new Set(candidate.evidence_refs as string[])];
  if (evidenceRefs.length !== candidate.evidence_refs.length) {
    throw new PreflightError('Relay received duplicate evidence references. Retry in a moment.');
  }
  if (candidate.finding_type === 'contradiction' && evidenceRefs.length < 2) {
    throw new PreflightError('Relay received an unsupported contradiction. Retry in a moment.');
  }
  if (candidate.primary_evidence_ref !== null && !evidenceRefs.includes(candidate.primary_evidence_ref as string)) {
    throw new PreflightError('Relay received primary evidence that is not attached to the finding. Retry in a moment.');
  }

  const primaryEvidence = candidate.primary_evidence_ref === null
    ? null
    : evidenceByRef.get(candidate.primary_evidence_ref as string)!;
  const evidence = evidenceRefs.map((ref) => evidenceByRef.get(ref)!).map((item) => ({
    evidence_kind: item.evidenceKind,
    knowledge_item_id: item.knowledgeItemId,
    source_id: item.sourceId,
    label: item.label,
    excerpt: item.excerpt,
    locator: item.locator,
  }));
  return {
    finding_type: candidate.finding_type,
    severity: candidate.severity,
    title: candidate.title.trim(),
    question: candidate.question.trim(),
    explanation: candidate.explanation.trim(),
    suggested_knowledge_type: candidate.suggested_knowledge_type,
    primary_knowledge_item_id: primaryEvidence?.evidenceKind === 'knowledge'
      ? primaryEvidence.knowledgeItemId
      : null,
    evidence,
  };
}

async function failRun(
  admin: ReturnType<typeof createClient>,
  runId: string,
  error: unknown,
) {
  const message = error instanceof PreflightError
    ? error.publicMessage
    : 'Relay could not complete Preflight. Your handoff is safe; retry in a moment.';
  await admin
    .from('preflight_runs')
    .update({ status: 'failed', failure_reason: message.slice(0, 500) })
    .eq('id', runId)
    .eq('status', 'processing');
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
  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Your session is no longer valid.' }, 401);

  let handoffId = '';
  try {
    const body = await request.json();
    handoffId = typeof body?.handoffId === 'string' ? body.handoffId : '';
  } catch {
    return json({ error: 'A handoff ID is required.' }, 400);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(handoffId)) {
    return json({ error: 'A valid handoff ID is required.' }, 400);
  }

  const { data: handoff, error: handoffError } = await client
    .from('handoffs')
    .select('id, organization_id, role_id')
    .eq('id', handoffId)
    .maybeSingle();
  if (handoffError || !handoff) return json({ error: 'This handoff is unavailable.' }, 404);
  const { data: isAdmin, error: adminCheckError } = await client.rpc('is_role_holder_for_handoff', {
    requested_handoff_id: handoff.id,
  });
  if (adminCheckError || !isAdmin) return json({ error: 'You do not have permission to run Preflight.' }, 403);

  const { data: runId, error: runError } = await client.rpc('begin_preflight_run', {
    requested_handoff_id: handoff.id,
  });
  if (runError || !runId) {
    return json({ error: runError?.message ?? 'Relay could not start Preflight.' }, 409);
  }

  try {
    const { data: role, error: roleError } = await client
      .from('roles')
      .select('title, description')
      .eq('id', handoff.role_id)
      .single();
    if (roleError) throw roleError;
    const { data: approved, error: approvedError } = await client
      .from('knowledge_items')
      .select('id, knowledge_type, title, content, uncertainty_note, sort_order')
      .eq('handoff_id', handoff.id)
      .eq('status', 'approved')
      .order('sort_order', { ascending: true });
    if (approvedError) throw approvedError;
    if (!approved?.length) throw new PreflightError('Approve at least one knowledge item before running Preflight.');

    const { data: links, error: linkError } = await client
      .from('knowledge_item_sources')
      .select('knowledge_item_id, source_id, source_excerpt, source_locator')
      .eq('handoff_id', handoff.id);
    if (linkError) throw linkError;
    const linkedSourceIds = [...new Set((links ?? []).map((link) => link.source_id))];
    const { data: linkedSources, error: sourceError } = linkedSourceIds.length
      ? await client.from('sources').select('id, title, is_current').in('id', linkedSourceIds)
      : { data: [], error: null };
    if (sourceError) throw sourceError;
    const sourceTitles = new Map((linkedSources ?? []).map((source) => [source.id, source.title]));
    const currentLinkedSourceIds = new Set((linkedSources ?? [])
      .filter((source) => source.is_current)
      .map((source) => source.id));

    const evidence: Evidence[] = approved.map((item, index) => ({
      ref: `K${index + 1}`,
      evidenceKind: 'knowledge',
      knowledgeItemId: item.id,
      sourceId: null,
      label: limitText(`${item.knowledge_type}: ${item.title}`, 200),
      excerpt: limitText(item.content, 2_000),
      locator: null,
    }));
    const seenSourceEvidence = new Set<string>();
    for (const link of links ?? []) {
      if (!currentLinkedSourceIds.has(link.source_id)) continue;
      const excerpt = link.source_excerpt?.trim();
      if (!excerpt) continue;
      const key = `${link.source_id}:${excerpt}`;
      if (seenSourceEvidence.has(key)) continue;
      seenSourceEvidence.add(key);
      evidence.push({
        ref: `S${evidence.length + 1}`,
        evidenceKind: 'source',
        knowledgeItemId: null,
        sourceId: link.source_id,
        label: limitText(sourceTitles.get(link.source_id) ?? 'Source evidence', 200),
        excerpt: limitText(excerpt, 2_000),
        locator: link.source_locator ? limitText(link.source_locator, 200) : null,
      });
    }

    const retrievalQuery = [
      role.title,
      role.description,
      ...approved.flatMap((item) => [item.title, item.content]),
    ].join(' ');
    const { data: currentDocumentSources, error: currentSourcesError } = await client
      .from('sources')
      .select('id')
      .eq('handoff_id', handoff.id)
      .eq('kind', 'document')
      .eq('is_current', true)
      .eq('processing_status', 'ready');
    if (currentSourcesError) throw currentSourcesError;
    const documents = await documentEvidence(
      config,
      handoff.organization_id,
      handoff.id,
      retrievalQuery,
      (currentDocumentSources ?? []).map((source) => source.id),
    );
    for (const document of documents) {
      if (typeof document?.source_id !== 'string' || typeof document?.text !== 'string' || !document.text.trim()) continue;
      const excerpt = limitText(document.text, 2_000);
      const key = `${document.source_id}:${excerpt}`;
      if (seenSourceEvidence.has(key)) continue;
      seenSourceEvidence.add(key);
      evidence.push({
        ref: `S${evidence.length + 1}`,
        evidenceKind: 'source',
        knowledgeItemId: null,
        sourceId: document.source_id,
        label: limitText(document.source_title || 'Document evidence', 200),
        excerpt,
        locator: Number.isInteger(document.page_number) ? `Page ${document.page_number}` : null,
      });
    }
    const boundedEvidence = evidence.slice(0, 120).map((item, index) => ({ ...item, ref: `E${index + 1}` }));
    const evidenceByRef = new Map(boundedEvidence.map((item) => [item.ref, item]));
    const evidencePrompt = boundedEvidence
      .map((item) => `${item.ref} [${item.evidenceKind}] ${item.label}${item.locator ? ` · ${item.locator}` : ''}\n${item.excerpt}`)
      .join('\n\n');

    const response = await fetch(`${config.groqApiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.reasoningModel,
        reasoning_effort: 'medium',
        temperature: 0,
        max_completion_tokens: 10_000,
        messages: [
          {
            role: 'system',
            content: [
              'You run a conservative leadership-handoff Preflight.',
              'Ask whether a new person could carry out the documented role without unsafe or consequential guessing.',
              'Find only: missing information explicitly implied by evidence, ambiguous language, incomplete instructions, and direct contradictions.',
              'Do not demand generic best practices or information unrelated to the documented role.',
              'Do not invent a resolution. Ask the outgoing leader one plain-language question.',
              'Use critical only when the gap could block a core responsibility, cause a missed consequential deadline, create a safety/access risk, or make two instructions impossible to follow together. Otherwise use optional.',
              'Every finding must cite 1–6 supplied evidence refs. A contradiction must cite at least two refs that actually disagree.',
              'Use primary_evidence_ref for the approved knowledge item that should be edited when one exists; otherwise use null.',
              'Return no findings when the evidence is sufficiently actionable. Never output a completeness score.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `ROLE: ${role.title}`,
              `ROLE DESCRIPTION: ${role.description || 'Not provided.'}`,
              'AUTHORIZED EVIDENCE:',
              evidencePrompt,
            ].join('\n\n'),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'relay_preflight_findings',
            strict: true,
            schema: preflightSchema,
          },
        },
      }),
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 429) throw new PreflightError('Preflight is busy right now. Wait a moment and retry.');
      if (response.status === 401 || response.status === 403) {
        throw new PreflightError('Preflight is temporarily unavailable because the reasoning connection needs attention.');
      }
      throw new PreflightError('Relay could not analyze this handoff safely. Retry in a moment.');
    }
    const content = responseBody?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new PreflightError('Relay did not receive a valid Preflight result. Retry in a moment.');
    let decoded: unknown;
    try {
      decoded = JSON.parse(content);
    } catch {
      throw new PreflightError('Relay received an unreadable Preflight result. Retry in a moment.');
    }
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)
      || Object.keys(decoded as object).length !== 1
      || !Array.isArray((decoded as { findings?: unknown }).findings)) {
      throw new PreflightError('Relay received an invalid Preflight result. Retry in a moment.');
    }
    const rawFindings = (decoded as { findings: unknown[] }).findings;
    if (rawFindings.length > MAX_FINDINGS) {
      throw new PreflightError('Preflight returned too many questions. Refine the handoff and run it again.');
    }
    const findings = rawFindings.map((finding) => validateFinding(finding, evidenceByRef));
    const unique = new Set<string>();
    for (const finding of findings) {
      const key = `${finding.finding_type}:${finding.question.toLocaleLowerCase()}`;
      if (unique.has(key)) throw new PreflightError('Preflight returned duplicate questions. Retry in a moment.');
      unique.add(key);
    }

    const { data: count, error: completeError } = await client.rpc('complete_preflight_run', {
      requested_run_id: runId,
      requested_findings: findings,
    });
    if (completeError) throw completeError;
    return json({ ready: true, runId, findingCount: Number(count ?? findings.length) });
  } catch (error) {
    console.error('Preflight failed', error instanceof Error ? error.message : 'unknown error');
    await failRun(admin, runId, error);
    const message = error instanceof PreflightError
      ? error.publicMessage
      : 'Relay could not complete Preflight. Your handoff is safe; retry in a moment.';
    return json({ error: message, runId }, 422);
  }
});
