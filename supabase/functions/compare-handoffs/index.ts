import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

import {
  MEMORY_CLAIM_INDEX_VERSION,
  ORGANIZATION_MEMORY_CLAIM_SYSTEM_PROMPT,
  memoryClaimPrompt,
  normalizeMemoryClaimOutput,
  organizationMemoryClaimSchema,
  storedClaimsToEvidence,
  type ClaimSourceItem,
  type PriorMemoryTopic,
  type StoredMemoryClaim,
} from '../_shared/organization-memory-claims.ts';
import {
  broadMemoryKnowledgeType,
  createMemoryMatchingPlan,
  deterministicMemoryChanges,
  isMemoryScope,
  materialMemoryPairPlan,
  memoryCandidatePrompt,
  organizationMemorySchema,
  validateMemoryChanges,
  type MemoryEvidenceItem,
  type MemoryMatchingPlan,
  type PublicationMemoryItem,
} from '../_shared/organization-memory.ts';
import {
  readTextLlmConfig,
  requestTextLlmJson,
  TextLlmError,
  type TextLlmConfig,
} from '../_shared/text-llm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ORGANIZATION_MEMORY_MATERIALITY_PROMPT = `You evaluate already-linked atomic operational claims from two adjacent, immutable, human-approved Handoffs for the same Organization and Role.

The server has already established every relationship. Never discover, merge, split, or replace a relationship. Evaluate only the supplied CHANGED_CANDIDATE pairs.

Include a pair only when the difference could materially change what the next Role Holder does, decides, monitors, follows, relies on, expects, or must complete.

Include material changes to procedures, responsibilities, lead times, requirements, approvals, thresholds, limits, risks, contacts, systems, resources, dependencies, access instructions, and unresolved obligations.

Omit:
- punctuation, formatting, sentence order, synonymous wording, or grammatical cleanup
- a routine move from one service year's calendar date to the corresponding date in the next year when no changed rule, cadence, lead time, or constraint is explicitly documented
- a generic document-scope or resource-list update that is not independently actionable
- any comparison whose operational meaning is uncertain

Do not infer that an annual date changed materially merely because its day, month, or year differs. An explicitly documented new scheduling constraint is material; the ordinary yearly event date itself is not.

Return changed when the same operational fact has a material new value. Return resolved only when the previous claim explicitly says the matter was pending/open and the current claim explicitly says it was completed/closed. Return retired only when the current claim explicitly says the prior practice was discontinued, replaced, or no longer applies.

Provide reason_statement only when the previous or current claim in that exact candidate explicitly states why. Preserve that wording closely. Otherwise return null. Never infer causality from chronology.

Return exactly one result for every candidate. Use include=false with all nullable fields null for an immaterial or uncertain pair. Return only the required JSON.`;

type ServerConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  textLlm: TextLlmConfig;
};

type Publication = {
  id: string;
  handoff_id: string;
  service_period: string;
  period_start_year: number | null;
  period_end_year: number | null;
  published_at: string;
};

type PublicationItemRow = PublicationMemoryItem & {
  publication_id: string;
  sort_order: number;
  created_at: string;
};

class MemoryError extends Error {
  constructor(public readonly publicMessage: string, public readonly status = 422) {
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
    textLlm: readTextLlmConfig((name) => Deno.env.get(name)),
  };
}

function citations(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const source = candidate as Record<string, unknown>;
    if (typeof source.label !== 'string' || !source.label.trim()) return [];
    return [{
      label: source.label.trim().slice(0, 160),
      locator: typeof source.locator === 'string' ? source.locator.trim().slice(0, 200) || null : null,
    }];
  }).slice(0, 24);
}

function snapshot(item: ReturnType<typeof storedClaimsToEvidence>[number] | null) {
  if (!item) return null;
  return {
    id: item.id,
    sourceKnowledgeItemId: item.source_knowledge_item_id,
    knowledgeType: item.knowledge_type,
    title: item.title,
    content: item.content,
    citationSources: citations(item.citation_sources),
  };
}

function claimSources(
  previousItems: PublicationItemRow[],
  currentItems: PublicationItemRow[],
  includePrevious: boolean,
) {
  return [
    ...(includePrevious ? previousItems.map((item, index) => ({
      ...item,
      ref: `P${index + 1}`,
      period: 'previous' as const,
    })) : []),
    ...currentItems.map((item, index) => ({
      ...item,
      ref: `C${index + 1}`,
      period: 'current' as const,
    })),
  ] satisfies ClaimSourceItem[];
}

async function loadPriorTopics(
  admin: ReturnType<typeof createClient>,
  previousPublicationId: string,
): Promise<PriorMemoryTopic[]> {
  const { data: claims, error: claimError } = await admin
    .from('publication_memory_claims')
    .select('topic_id, knowledge_type, title, content, comparison_value')
    .eq('publication_id', previousPublicationId)
    .order('created_at', { ascending: true });
  if (claimError) throw claimError;
  const topicIds = [...new Set((claims ?? []).map((claim) => claim.topic_id))];
  if (!topicIds.length) return [];
  const { data: topics, error: topicError } = await admin
    .from('role_memory_topics')
    .select('id, canonical_key, label')
    .in('id', topicIds);
  if (topicError) throw topicError;
  const topicById = new Map((topics ?? []).map((topic) => [topic.id, topic]));
  return (claims ?? []).flatMap((claim, index) => {
    const topic = topicById.get(claim.topic_id);
    if (!topic) return [];
    return [{
      ref: `T${index + 1}`,
      topicId: claim.topic_id,
      canonicalKey: topic.canonical_key,
      label: topic.label,
      knowledgeType: claim.knowledge_type,
      title: claim.title,
      content: claim.content,
      comparisonValue: claim.comparison_value,
    }];
  });
}

async function ensureClaimIndexes({
  admin,
  config,
  actorId,
  organizationId,
  roleId,
  roleTitle,
  previous,
  current,
  publicationItems,
}: {
  admin: ReturnType<typeof createClient>;
  config: ServerConfig;
  actorId: string;
  organizationId: string;
  roleId: string;
  roleTitle: string;
  previous: Publication;
  current: Publication;
  publicationItems: PublicationItemRow[];
}) {
  const { data: indexes, error: indexError } = await admin
    .from('publication_memory_indexes')
    .select('publication_id, status, index_version')
    .in('publication_id', [previous.id, current.id]);
  if (indexError) throw indexError;
  const ready = new Set((indexes ?? [])
    .filter((index) => index.status === 'ready' && index.index_version === MEMORY_CLAIM_INDEX_VERSION)
    .map((index) => index.publication_id));
  if (ready.has(previous.id) && ready.has(current.id)) return;

  const previousItems = publicationItems.filter((item) => item.publication_id === previous.id);
  const currentItems = publicationItems.filter((item) => item.publication_id === current.id);
  if (!previousItems.length || !currentItems.length) {
    throw new MemoryError('Both published Handoffs need approved knowledge before Relay can compare them.', 409);
  }

  const incremental = ready.has(previous.id) && !ready.has(current.id);
  const priorTopics = incremental ? await loadPriorTopics(admin, previous.id) : [];
  // An empty prior index cannot establish continuity safely, so rebuild the
  // adjacent pair together rather than treating every current claim as new.
  const rebuildPair = !incremental || !priorTopics.length;
  const sources = claimSources(previousItems, currentItems, rebuildPair);
  let decoded: unknown;
  try {
    decoded = await requestTextLlmJson({
      config: config.textLlm,
      schema: organizationMemoryClaimSchema,
      timeoutMs: Math.min(config.textLlm.requestTimeoutMs, 110_000),
      messages: [
        { role: 'system', content: ORGANIZATION_MEMORY_CLAIM_SYSTEM_PROMPT },
        {
          role: 'user',
          content: memoryClaimPrompt({
            roleTitle,
            previousPeriod: previous.service_period,
            currentPeriod: current.service_period,
            sources,
            priorTopics: rebuildPair ? [] : priorTopics,
          }),
        },
      ],
    });
  } catch (error) {
    if (error instanceof TextLlmError && error.status === 429) {
      throw new MemoryError('Organization Memory is busy right now. Wait a moment and retry.', 429);
    }
    if (error instanceof TextLlmError && error.kind === 'output') {
      throw new MemoryError('Relay could not prepare a reliable Memory index from these Handoffs.', 502);
    }
    throw new MemoryError('Relay could not prepare Organization Memory right now.', 503);
  }

  const claims = normalizeMemoryClaimOutput({
    value: decoded,
    sources,
    publicationIds: { previous: previous.id, current: current.id },
    priorTopics: rebuildPair ? [] : priorTopics,
  });
  const targetPublicationIds = rebuildPair ? [previous.id, current.id] : [current.id];
  if (!claims.length || targetPublicationIds.some((publicationId) => (
    !claims.some((claim) => claim.publicationId === publicationId)
  ))) {
    throw new MemoryError('Relay could not ground enough approved knowledge to prepare Organization Memory.', 502);
  }

  const { error: commitError } = await admin.rpc('commit_publication_memory_claim_indexes', {
    requested_organization_id: organizationId,
    requested_role_id: roleId,
    requested_publication_ids: targetPublicationIds,
    requested_created_by: actorId,
    requested_index_version: MEMORY_CLAIM_INDEX_VERSION,
    requested_claims: claims,
  });
  if (commitError) throw commitError;
}

async function evaluateMaterialPairs({
  config,
  roleTitle,
  previousPeriod,
  currentPeriod,
  evidence,
  evidenceByRef,
  pairPlan,
}: {
  config: ServerConfig;
  roleTitle: string;
  previousPeriod: string;
  currentPeriod: string;
  evidence: MemoryEvidenceItem[];
  evidenceByRef: Map<string, MemoryEvidenceItem>;
  pairPlan: MemoryMatchingPlan;
}) {
  const fallback = deterministicMemoryChanges(evidenceByRef, pairPlan);
  if (!pairPlan.pairs.length) return fallback;
  const candidateRefs = new Set(pairPlan.pairs.flatMap((pair) => [pair.beforeRef, pair.afterRef]));
  const evidenceBlock = evidence.filter((item) => candidateRefs.has(item.ref)).map((item) => [
    `[${item.ref}]`,
    `Period: ${item.period.toUpperCase()}`,
    `Knowledge Type: ${broadMemoryKnowledgeType(item.knowledge_type)}`,
    `Title: ${item.title}`,
    'Content:',
    item.content,
  ].join('\n')).join('\n\n');

  try {
    const decoded = await requestTextLlmJson({
      config: config.textLlm,
      schema: organizationMemorySchema,
      timeoutMs: Math.min(config.textLlm.requestTimeoutMs, 45_000),
      messages: [
        { role: 'system', content: ORGANIZATION_MEMORY_MATERIALITY_PROMPT },
        {
          role: 'user',
          content: [
            'ROLE:', roleTitle, '',
            'SERVICE PERIOD COMPARISON:', `${previousPeriod} -> ${currentPeriod}`, '',
            'CANDIDATES:', memoryCandidatePrompt(pairPlan), '',
            'APPROVED ATOMIC CLAIMS:', evidenceBlock, '',
            'Evaluate every candidate. Return only the required JSON.',
          ].join('\n'),
        },
      ],
    });
    return validateMemoryChanges(decoded, evidenceByRef, pairPlan);
  } catch (error) {
    // Claim identity and the deterministic calendar/resource filters have
    // already run. A provider or output problem must not destroy an otherwise
    // usable comparison or the last complete result.
    console.warn('Organization Memory materiality review used deterministic fallback',
      error instanceof Error ? error.message : 'unknown error');
    return fallback;
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
  const admin = createClient(config.supabaseUrl, config.serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return json({ error: 'Your session is no longer valid.' }, 401);

  let roleId = '';
  try {
    const body = await request.json();
    roleId = typeof body?.roleId === 'string' ? body.roleId : '';
  } catch {
    return json({ error: 'A role ID is required.' }, 400);
  }
  if (!UUID_PATTERN.test(roleId)) return json({ error: 'A valid role ID is required.' }, 400);

  const { data: role, error: roleError } = await client
    .from('roles').select('id, organization_id, title').eq('id', roleId).maybeSingle();
  if (roleError || !role) return json({ error: 'This role is unavailable.' }, 404);
  const { data: canView } = await client.rpc('can_view_role_history', { requested_role_id: role.id });
  if (!canView) return json({ error: 'You do not have permission to compare this role.' }, 403);
  const { data: plan } = await client.rpc('get_organization_plan', { requested_organization_id: role.organization_id });
  if (plan?.plan !== 'pro') return json({ error: 'This Organization needs Relay Pro. Its Owner can upgrade it.' }, 403);

  const { data: handoffs, error: handoffError } = await client
    .from('handoffs')
    .select('id, organization_id, role_id')
    .eq('role_id', role.id)
    .eq('organization_id', role.organization_id);
  if (handoffError) return json({ error: 'Relay could not load Handoff history.' }, 500);
  if (!handoffs || handoffs.length < 2) {
    return json({ error: 'Publish at least two service periods for this Role before comparing them.' }, 409);
  }
  if (handoffs.some((handoff) => !isMemoryScope(handoff, {
    organizationId: role.organization_id,
    roleId: role.id,
  }))) return json({ error: 'Relay could not resolve this Role history safely.' }, 409);

  const { data: publications, error: publicationError } = await client
    .from('handoff_publications')
    .select('id, handoff_id, service_period, period_start_year, period_end_year, published_at')
    .eq('organization_id', role.organization_id)
    .in('handoff_id', handoffs.map((handoff) => handoff.id))
    .order('period_start_year', { ascending: false, nullsFirst: false })
    .order('period_end_year', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false })
    .limit(2);
  if (publicationError || !publications || publications.length !== 2) {
    return json({ error: 'Relay could not resolve both immutable publications.' }, 409);
  }
  const [current, previous] = publications as Publication[];

  const { data: existingComparison, error: comparisonError } = await admin
    .from('role_memory_comparisons')
    .select('id, status')
    .eq('role_id', role.id)
    .eq('previous_publication_id', previous.id)
    .eq('current_publication_id', current.id)
    .maybeSingle();
  if (comparisonError) return json({ error: 'Relay could not start the comparison.' }, 500);

  try {
    const { data: itemRows, error: itemError } = await admin
      .from('handoff_publication_items')
      .select('id, publication_id, source_knowledge_item_id, knowledge_lineage_id, knowledge_type, title, content, citation_sources, sort_order, created_at')
      .in('publication_id', [previous.id, current.id])
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (itemError) throw itemError;
    const publicationItems = (itemRows ?? []) as PublicationItemRow[];

    await ensureClaimIndexes({
      admin,
      config,
      actorId: userData.user.id,
      organizationId: role.organization_id,
      roleId: role.id,
      roleTitle: role.title,
      previous,
      current,
      publicationItems,
    });

    const { data: claimRows, error: claimError } = await admin
      .from('publication_memory_claims')
      .select('id, publication_id, topic_id, knowledge_type, title, content, comparison_value, claim_state, primary_publication_item_id, source_publication_item_ids, citation_sources')
      .in('publication_id', [previous.id, current.id])
      .order('created_at', { ascending: true });
    if (claimError) throw claimError;
    const evidence = storedClaimsToEvidence({
      claims: (claimRows ?? []) as StoredMemoryClaim[],
      publicationItems,
      previousPublicationId: previous.id,
    });
    const evidenceByRef = new Map(evidence.map((item) => [item.ref, item]));
    const matchingPlan = createMemoryMatchingPlan(evidence);
    const pairPlan = materialMemoryPairPlan(matchingPlan, evidenceByRef);
    const pairChanges = await evaluateMaterialPairs({
      config,
      roleTitle: role.title,
      previousPeriod: previous.service_period,
      currentPeriod: current.service_period,
      evidence,
      evidenceByRef,
      pairPlan,
    });
    const standaloneChanges = deterministicMemoryChanges(evidenceByRef, {
      pairs: [],
      addedRefs: matchingPlan.addedRefs,
      omittedRefs: matchingPlan.omittedRefs,
    });
    const changes = [...pairChanges, ...standaloneChanges];

    const persistedChanges = changes.map((change) => {
      const provenance = [
        ...citations(change.before?.citation_sources),
        ...citations(change.after?.citation_sources),
        ...citations(change.reasonEvidence?.citation_sources),
      ].filter((candidate, index, all) => all.findIndex((other) => (
        other.label === candidate.label && other.locator === candidate.locator
      )) === index).slice(0, 24);
      return {
        changeType: change.changeType,
        title: change.title,
        summary: change.summary,
        previousPublicationItemId: change.before?.id ?? null,
        currentPublicationItemId: change.after?.id ?? null,
        matchBasis: change.matchBasis,
        reasonStatement: change.reasonStatement,
        beforeSnapshot: snapshot(change.before),
        afterSnapshot: snapshot(change.after),
        supportingProvenance: provenance,
        reasonProvenance: citations(change.reasonEvidence?.citation_sources),
      };
    });
    const { data: comparisonId, error: commitError } = await admin.rpc(
      'commit_role_memory_comparison',
      {
        requested_organization_id: role.organization_id,
        requested_role_id: role.id,
        requested_previous_publication_id: previous.id,
        requested_current_publication_id: current.id,
        requested_previous_service_period: previous.service_period,
        requested_current_service_period: current.service_period,
        requested_created_by: userData.user.id,
        requested_changes: persistedChanges,
      },
    );
    if (commitError || !comparisonId) throw commitError ?? new Error('Comparison commit failed.');
    return json({ ready: true, comparisonId, materialChangeCount: changes.length });
  } catch (error) {
    console.error('Organization Memory comparison failed', error instanceof Error ? error.message : 'unknown error');
    const message = error instanceof MemoryError
      ? error.publicMessage
      : 'Relay could not compare these Handoffs safely. Your published Handoffs are unchanged.';
    let comparisonId = existingComparison?.id ?? null;
    if (existingComparison?.status !== 'ready') {
      const { data: failedComparison } = await admin.from('role_memory_comparisons').upsert({
        organization_id: role.organization_id,
        role_id: role.id,
        previous_publication_id: previous.id,
        current_publication_id: current.id,
        previous_service_period: previous.service_period,
        current_service_period: current.service_period,
        status: 'failed',
        failure_reason: message.slice(0, 500),
        material_change_count: null,
        created_by: userData.user.id,
        completed_at: null,
      }, { onConflict: 'role_id,previous_publication_id,current_publication_id' }).select('id').single();
      comparisonId = failedComparison?.id ?? comparisonId;
    }
    return json({ error: message, comparisonId }, error instanceof MemoryError ? error.status : 500);
  }
});
