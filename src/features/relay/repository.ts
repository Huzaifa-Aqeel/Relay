import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { z } from 'zod';

import { requireSupabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { KNOWLEDGE_TYPES } from '@/features/relay/types';
import type {
  AskRelayAnswer,
  Handoff,
  HandoffInput,
  HandoffPublication,
  HandoffSource,
  KnowledgeItem,
  KnowledgeItemInput,
  KnowledgeProvenance,
  Organization,
  OrganizationInput,
  OrganizationPlan,
  OrganizationRole,
  PreflightEvidence,
  PreflightFinding,
  PreflightResolutionInput,
  PreflightRun,
  RoleInput,
  SharedHandoff,
  SourceFileInput,
  SourceTextInput,
  TypedSourceInput,
} from '@/features/relay/types';

type OrganizationRow = Database['public']['Tables']['organizations']['Row'];
type RoleRow = Database['public']['Tables']['roles']['Row'];
type HandoffRow = Database['public']['Tables']['handoffs']['Row'];
type SourceRow = Database['public']['Tables']['sources']['Row'];
type KnowledgeItemRow = Database['public']['Tables']['knowledge_items']['Row'];
type PreflightRunRow = Database['public']['Tables']['preflight_runs']['Row'];
type PreflightFindingRow = Database['public']['Tables']['preflight_findings']['Row'];
type PreflightEvidenceRow = Database['public']['Tables']['preflight_finding_evidence']['Row'];
type HandoffPublicationRow = Database['public']['Tables']['handoff_publications']['Row'];
type HandoffPublicationItemRow = Database['public']['Tables']['handoff_publication_items']['Row'];

const LOGO_BUCKET = 'organization-logos';
const SOURCE_BUCKET = 'handoff-sources';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export type RelayPlanLimit = 'organization' | 'role' | 'handoff';

export class RelayPlanLimitError extends Error {
  constructor(public readonly limit: RelayPlanLimit) {
    super(`Relay Pro is required to create another ${limit}.`);
    this.name = 'RelayPlanLimitError';
  }
}

function messageFor(error: { code?: string; message: string }) {
  if (error.code === '23505' && error.message.includes('roles_active_title_idx')) {
    return 'That organization already has an active role with this title.';
  }
  if (error.code === '23505' && error.message.includes('handoffs_role_id_service_period_key')) {
    return 'A handoff for this role and service period already exists.';
  }
  if (error.code === '42501') return 'You do not have permission to make that change.';
  if (error.code === 'PGRST116') return 'This item no longer exists or you do not have access.';
  if (error.message.includes('Preview this handoff')) return 'Open the exact recipient Preview before publishing.';
  if (error.message.includes('Run Preflight')) return 'Run Preflight again before publishing this handoff.';
  if (error.message.includes('Critical findings')) return 'Acknowledge the remaining critical findings before publishing.';
  if (error.message.includes('Review every proposal')) return 'Review every proposed item before publishing.';
  if (error.message.includes('Active published link unavailable')) return 'This published link is already inactive.';
  if (error.message.toLowerCase().includes('network') || error.message.toLowerCase().includes('fetch')) {
    return 'Check your connection and try again.';
  }
  return 'Relay could not complete that request. Please try again.';
}

function throwDataError(error: { code?: string; message: string } | null): asserts error is null {
  if (!error) return;
  const planLimit = error.message.match(/RELAY_PRO_REQUIRED:(organization|role|handoff)/)?.[1] as RelayPlanLimit | undefined;
  if (planLimit) throw new RelayPlanLimitError(planLimit);
  throw new Error(messageFor(error));
}

function mapOrganization(row: OrganizationRow, logoUrl: string | null = null): Organization {
  return {
    id: row.id,
    createdBy: row.created_by,
    name: row.name,
    institution: row.institution,
    description: row.description,
    logoPath: row.logo_path,
    logoUrl,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRole(row: RoleRow): OrganizationRole {
  return {
    id: row.id,
    organizationId: row.organization_id,
    createdBy: row.created_by,
    title: row.title,
    description: row.description,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHandoff(row: HandoffRow): Handoff {
  return {
    id: row.id,
    organizationId: row.organization_id,
    roleId: row.role_id,
    createdBy: row.created_by,
    servicePeriod: row.service_period,
    status: row.status as Handoff['status'],
    stage: row.stage as Handoff['stage'],
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSource(row: SourceRow): HandoffSource {
  return {
    id: row.id,
    organizationId: row.organization_id,
    handoffId: row.handoff_id,
    createdBy: row.created_by,
    kind: row.kind as HandoffSource['kind'],
    title: row.title,
    textContent: row.text_content,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    processingStatus: row.processing_status as HandoffSource['processingStatus'],
    failureReason: row.failure_reason,
    structuringStatus: row.structuring_status as HandoffSource['structuringStatus'],
    structuringFailureReason: row.structuring_failure_reason,
    structuredAt: row.structured_at,
    structuredProposalCount: row.structured_proposal_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapKnowledgeItem(row: KnowledgeItemRow): KnowledgeItem {
  return {
    id: row.id,
    organizationId: row.organization_id,
    handoffId: row.handoff_id,
    createdBy: row.created_by,
    knowledgeType: row.knowledge_type as KnowledgeItem['knowledgeType'],
    title: row.title,
    content: row.content,
    status: row.status as KnowledgeItem['status'],
    origin: row.origin as KnowledgeItem['origin'],
    uncertaintyNote: row.uncertainty_note,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPreflightRun(row: PreflightRunRow): PreflightRun {
  return {
    id: row.id,
    organizationId: row.organization_id,
    handoffId: row.handoff_id,
    createdBy: row.created_by,
    status: row.status as PreflightRun['status'],
    failureReason: row.failure_reason,
    findingCount: row.finding_count,
    criticalAcknowledgedAt: row.critical_acknowledged_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPreflightFinding(row: PreflightFindingRow): PreflightFinding {
  return {
    id: row.id,
    runId: row.run_id,
    organizationId: row.organization_id,
    handoffId: row.handoff_id,
    findingType: row.finding_type as PreflightFinding['findingType'],
    severity: row.severity as PreflightFinding['severity'],
    title: row.title,
    question: row.question,
    explanation: row.explanation,
    suggestedKnowledgeType: row.suggested_knowledge_type as PreflightFinding['suggestedKnowledgeType'],
    primaryKnowledgeItemId: row.primary_knowledge_item_id,
    status: row.status as PreflightFinding['status'],
    resolutionKnowledgeItemId: row.resolution_knowledge_item_id,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPreflightEvidence(row: PreflightEvidenceRow): PreflightEvidence {
  return {
    id: row.id,
    findingId: row.finding_id,
    runId: row.run_id,
    evidenceKind: row.evidence_kind as PreflightEvidence['evidenceKind'],
    knowledgeItemId: row.knowledge_item_id,
    sourceId: row.source_id,
    label: row.label,
    excerpt: row.excerpt,
    locator: row.locator,
  };
}

function mapHandoffPublication(row: HandoffPublicationRow): HandoffPublication {
  return {
    id: row.id,
    organizationId: row.organization_id,
    handoffId: row.handoff_id,
    accessToken: row.access_token,
    status: row.status as HandoffPublication['status'],
    organizationName: row.organization_name,
    organizationInstitution: row.organization_institution,
    roleTitle: row.role_title,
    roleDescription: row.role_description,
    servicePeriod: row.service_period,
    publishedAt: row.published_at,
    revokedAt: row.revoked_at,
  };
}

function mapPublishedHandoffItem(row: HandoffPublicationItemRow) {
  return {
    id: row.id,
    knowledgeType: row.knowledge_type as SharedHandoff['items'][number]['knowledgeType'],
    title: row.title,
    content: row.content,
    sortOrder: row.sort_order,
  };
}

const sharedHandoffSchema = z.object({
  publicationId: z.string().uuid(),
  organizationName: z.string().min(1).max(100),
  organizationInstitution: z.string().max(160),
  roleTitle: z.string().min(1).max(120),
  roleDescription: z.string().max(1200),
  servicePeriod: z.string().min(1).max(40),
  publishedAt: z.string(),
  items: z.array(z.object({
    id: z.string().uuid(),
    knowledgeType: z.enum(KNOWLEDGE_TYPES),
    title: z.string().min(1).max(160),
    content: z.string().min(1).max(5000),
    sortOrder: z.number().int().nonnegative(),
  }).strict()).max(1000),
}).strict();

const askRelayAnswerSchema = z.object({
  status: z.enum(['answered', 'unsupported']),
  answer: z.string().min(1).max(1600),
  citations: z.array(z.object({
    ref: z.string().regex(/^E\d+$/),
    title: z.string().min(1).max(160),
    knowledgeType: z.enum(KNOWLEDGE_TYPES),
    sources: z.array(z.object({
      label: z.string().min(1).max(160),
      locator: z.string().max(200).nullable(),
    }).strict()).min(1).max(8),
  }).strict()).max(5),
  remaining: z.number().int().min(0),
}).strict();

const organizationPlanSchema = z.object({
  organizationId: z.string().uuid(),
  plan: z.enum(['free', 'pro']),
  expiresAt: z.string().nullable(),
}).strict();

async function signedLogo(path: string | null) {
  if (!path) return null;
  const { data, error } = await requireSupabase().storage.from(LOGO_BUCKET).createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}

async function uploadLogo(organizationId: string, logo: NonNullable<OrganizationInput['logo']>) {
  let body: ArrayBuffer;
  if (Platform.OS === 'web') {
    const response = await fetch(logo.uri);
    if (!response.ok) throw new Error('Relay could not read the selected logo. Choose it again.');
    body = await response.arrayBuffer();
  } else {
    body = await new File(logo.uri).arrayBuffer();
  }
  if (body.byteLength > MAX_LOGO_BYTES) throw new Error('Choose a logo smaller than 5 MB.');

  const mimeType = logo.mimeType && ['image/jpeg', 'image/png', 'image/webp'].includes(logo.mimeType)
    ? logo.mimeType
    : 'image/jpeg';
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const path = `${organizationId}/logo-${Crypto.randomUUID()}.${extension}`;
  const client = requireSupabase();
  const uploaded = await client.storage.from(LOGO_BUCKET).upload(path, body, { contentType: mimeType, upsert: false });
  throwDataError(uploaded.error);

  const updated = await client.from('organizations').update({ logo_path: path }).eq('id', organizationId);
  if (updated.error) {
    await client.storage.from(LOGO_BUCKET).remove([path]);
    throwDataError(updated.error);
  }
}

async function readFileBody(uri: string) {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Relay could not read the selected file. Choose it again.');
    return response.arrayBuffer();
  }
  return new File(uri).arrayBuffer();
}

function safeFileName(name: string) {
  const cleaned = name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(-100) || 'source';
}

export async function listOrganizations() {
  const { data, error } = await requireSupabase()
    .from('organizations')
    .select('*')
    .order('name', { ascending: true });
  throwDataError(error);
  return Promise.all(data.map(async (row) => mapOrganization(row, await signedLogo(row.logo_path))));
}

export async function getOrganization(id: string) {
  const { data, error } = await requireSupabase().from('organizations').select('*').eq('id', id).single();
  throwDataError(error);
  return mapOrganization(data, await signedLogo(data.logo_path));
}

export async function getOrganizationPlan(organizationId: string): Promise<OrganizationPlan> {
  const { data, error } = await requireSupabase().rpc('get_organization_plan', {
    requested_organization_id: organizationId,
  });
  throwDataError(error);
  return organizationPlanSchema.parse(data);
}

export async function createOrganization(input: OrganizationInput) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('create_organization', {
    organization_name: input.name.trim(),
    organization_institution: input.institution.trim(),
    organization_description: input.description.trim(),
  });
  throwDataError(error);
  const id = data;

  if (input.logo) {
    try {
      await uploadLogo(id, input.logo);
    } catch (caught) {
      await client.from('organizations').delete().eq('id', id);
      throw caught;
    }
  }
  return id;
}

export async function listRoles(organizationId: string) {
  const { data, error } = await requireSupabase()
    .from('roles')
    .select('*')
    .eq('organization_id', organizationId)
    .is('archived_at', null)
    .order('title', { ascending: true });
  throwDataError(error);
  return data.map(mapRole);
}

export async function getRole(id: string) {
  const { data, error } = await requireSupabase().from('roles').select('*').eq('id', id).single();
  throwDataError(error);
  return mapRole(data);
}

export async function createRole(input: RoleInput) {
  const { data, error } = await requireSupabase().rpc('create_role', {
    requested_organization_id: input.organizationId,
    requested_title: input.title.trim(),
    requested_description: input.description.trim(),
  });
  throwDataError(error);
  return data;
}

export async function listOrganizationHandoffs(organizationId: string) {
  const { data, error } = await requireSupabase()
    .from('handoffs')
    .select('*')
    .eq('organization_id', organizationId)
    .order('updated_at', { ascending: false });
  throwDataError(error);
  return data.map(mapHandoff);
}

export async function listRoleHandoffs(roleId: string) {
  const { data, error } = await requireSupabase()
    .from('handoffs')
    .select('*')
    .eq('role_id', roleId)
    .order('updated_at', { ascending: false });
  throwDataError(error);
  return data.map(mapHandoff);
}

export async function getHandoff(id: string) {
  const { data, error } = await requireSupabase().from('handoffs').select('*').eq('id', id).single();
  throwDataError(error);
  return mapHandoff(data);
}

export async function createHandoff(input: HandoffInput) {
  const { data, error } = await requireSupabase().rpc('create_handoff', {
    requested_organization_id: input.organizationId,
    requested_role_id: input.roleId,
    requested_service_period: input.servicePeriod.trim(),
  });
  throwDataError(error);
  return data;
}

export async function listHandoffSources(handoffId: string) {
  const { data, error } = await requireSupabase()
    .from('sources')
    .select('*')
    .eq('handoff_id', handoffId)
    .order('created_at', { ascending: false });
  throwDataError(error);
  return data.map(mapSource);
}

export async function getHandoffSource(id: string) {
  const { data, error } = await requireSupabase().from('sources').select('*').eq('id', id).single();
  throwDataError(error);
  return mapSource(data);
}

export async function createTypedSource(input: TypedSourceInput, userId: string) {
  const { data, error } = await requireSupabase()
    .from('sources')
    .insert({
      organization_id: input.organizationId,
      handoff_id: input.handoffId,
      created_by: userId,
      kind: 'typed_text',
      title: input.title.trim(),
      text_content: input.textContent.trim(),
      processing_status: 'ready',
    })
    .select('id')
    .single();
  throwDataError(error);
  return data.id;
}

async function markProcessingFailed(sourceId: string, kind: SourceFileInput['kind']) {
  const reason = kind === 'voice'
    ? 'The recording is saved, but transcription could not start. Retry or add the transcript manually.'
    : 'The document is saved, but Relay could not reach document processing. Check your connection and retry.';
  const { error } = await requireSupabase()
    .from('sources')
    .update({ processing_status: 'failed', failure_reason: reason })
    .eq('id', sourceId);
  throwDataError(error);
}

export async function processSource(sourceId: string, kind: SourceFileInput['kind']) {
  const client = requireSupabase();
  const reset = await client
    .from('sources')
    .update({ processing_status: 'processing', failure_reason: null })
    .eq('id', sourceId);
  throwDataError(reset.error);

  const functionName = kind === 'voice' ? 'transcribe-source' : 'process-document-source';
  const result = await client.functions.invoke(functionName, { body: { sourceId } });
  if (result.error) {
    const { data: current } = await client
      .from('sources')
      .select('processing_status')
      .eq('id', sourceId)
      .maybeSingle();
    if (!current || current.processing_status === 'processing') await markProcessingFailed(sourceId, kind);
    throw new Error(
      kind === 'voice'
        ? 'Your recording is safe, but transcription is not available yet.'
        : 'Your document is safe, but processing is not available yet.',
    );
  }
}

export async function createFileSource(input: SourceFileInput, userId: string) {
  if (input.file.size && input.file.size > MAX_SOURCE_BYTES) {
    throw new Error('Choose a file smaller than 25 MB.');
  }

  const client = requireSupabase();
  const id = Crypto.randomUUID();
  const body = await readFileBody(input.file.uri);
  if (body.byteLength > MAX_SOURCE_BYTES) throw new Error('Choose a file smaller than 25 MB.');

  const path = `${input.organizationId}/${input.handoffId}/${id}/${safeFileName(input.file.name)}`;
  const uploaded = await client.storage.from(SOURCE_BUCKET).upload(path, body, {
    contentType: input.file.mimeType,
    upsert: false,
  });
  throwDataError(uploaded.error);

  const inserted = await client.from('sources').insert({
    id,
    organization_id: input.organizationId,
    handoff_id: input.handoffId,
    created_by: userId,
    kind: input.kind,
    title: input.title.trim(),
    storage_path: path,
    mime_type: input.file.mimeType,
    size_bytes: body.byteLength,
    processing_status: 'processing',
  });
  if (inserted.error) {
    await client.storage.from(SOURCE_BUCKET).remove([path]);
    throwDataError(inserted.error);
  }

  try {
    await processSource(id, input.kind);
  } catch {
    // The source and its plain-language failure state are intentionally retained.
  }
  return id;
}

export async function updateSourceText(input: SourceTextInput) {
  const { error } = await requireSupabase()
    .from('sources')
    .update({
      title: input.title.trim(),
      text_content: input.textContent.trim(),
      processing_status: 'ready',
      failure_reason: null,
    })
    .eq('id', input.id);
  throwDataError(error);
}

export async function generateKnowledgeProposals(sourceId: string) {
  const result = await requireSupabase().functions.invoke('generate-knowledge-proposals', {
    body: { sourceId },
  });
  if (result.error) {
    throw new Error('Relay could not create suggestions from this source. Check its status and retry.');
  }
  return Number(result.data?.proposalCount ?? 0);
}

export async function listKnowledgeItems(handoffId: string) {
  const { data, error } = await requireSupabase()
    .from('knowledge_items')
    .select('*')
    .eq('handoff_id', handoffId)
    .neq('status', 'rejected')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  throwDataError(error);
  return data.map(mapKnowledgeItem);
}

export async function listKnowledgeProvenance(handoffId: string): Promise<KnowledgeProvenance[]> {
  const client = requireSupabase();
  const { data: links, error: linkError } = await client
    .from('knowledge_item_sources')
    .select('knowledge_item_id, source_id, source_excerpt, source_locator')
    .eq('handoff_id', handoffId);
  throwDataError(linkError);
  if (!links.length) return [];

  const sourceIds = [...new Set(links.map((link) => link.source_id))];
  const { data: sources, error: sourceError } = await client
    .from('sources')
    .select('id, title')
    .in('id', sourceIds);
  throwDataError(sourceError);
  const titles = new Map(sources.map((source) => [source.id, source.title]));
  return links.map((link) => ({
    knowledgeItemId: link.knowledge_item_id,
    sourceId: link.source_id,
    sourceTitle: titles.get(link.source_id) ?? 'Source evidence',
    sourceExcerpt: link.source_excerpt,
    sourceLocator: link.source_locator,
  }));
}

export async function getKnowledgeItem(id: string) {
  const { data, error } = await requireSupabase().from('knowledge_items').select('*').eq('id', id).single();
  throwDataError(error);
  return mapKnowledgeItem(data);
}

export async function createManualKnowledgeItem(input: KnowledgeItemInput, userId: string) {
  const { data, error } = await requireSupabase()
    .from('knowledge_items')
    .insert({
      organization_id: input.organizationId,
      handoff_id: input.handoffId,
      created_by: userId,
      knowledge_type: input.knowledgeType,
      title: input.title.trim(),
      content: input.content.trim(),
      status: 'approved',
      origin: 'manual',
    })
    .select('id')
    .single();
  throwDataError(error);
  return data.id;
}

export async function updateKnowledgeItem(id: string, input: Pick<KnowledgeItemInput, 'knowledgeType' | 'title' | 'content'>) {
  const { error } = await requireSupabase()
    .from('knowledge_items')
    .update({
      knowledge_type: input.knowledgeType,
      title: input.title.trim(),
      content: input.content.trim(),
    })
    .eq('id', id);
  throwDataError(error);
}

export async function deleteKnowledgeItem(id: string) {
  const { error } = await requireSupabase().from('knowledge_items').delete().eq('id', id);
  throwDataError(error);
}

export async function moveKnowledgeItem(id: string, direction: 'up' | 'down') {
  const { error } = await requireSupabase().rpc('move_knowledge_item', {
    requested_item_id: id,
    direction,
  });
  throwDataError(error);
}

export async function beginHandoffReview(handoffId: string) {
  const { error } = await requireSupabase().rpc('begin_handoff_review', {
    requested_handoff_id: handoffId,
  });
  throwDataError(error);
}

export async function returnHandoffToCapture(handoffId: string) {
  const { error } = await requireSupabase().rpc('return_handoff_to_capture', {
    requested_handoff_id: handoffId,
  });
  throwDataError(error);
}

export async function decideKnowledgeProposal(id: string, decision: 'approved' | 'rejected') {
  const { error } = await requireSupabase().rpc('decide_knowledge_proposal', {
    requested_item_id: id,
    decision,
  });
  throwDataError(error);
}

export async function getLatestPreflightRun(handoffId: string) {
  const { data, error } = await requireSupabase()
    .from('preflight_runs')
    .select('*')
    .eq('handoff_id', handoffId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwDataError(error);
  return data ? mapPreflightRun(data) : null;
}

export async function listPreflightFindings(runId: string) {
  const { data, error } = await requireSupabase()
    .from('preflight_findings')
    .select('*')
    .eq('run_id', runId)
    .order('severity', { ascending: true })
    .order('created_at', { ascending: true });
  throwDataError(error);
  return data.map(mapPreflightFinding);
}

export async function listPreflightEvidence(runId: string) {
  const { data, error } = await requireSupabase()
    .from('preflight_finding_evidence')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwDataError(error);
  return data.map(mapPreflightEvidence);
}

export async function runPreflight(handoffId: string) {
  const result = await requireSupabase().functions.invoke('run-preflight', { body: { handoffId } });
  if (result.error) throw new Error('Relay could not complete Preflight. Check its status and retry.');
  return String(result.data?.runId ?? '');
}

export async function decidePreflightFinding(id: string, decision: 'skipped' | 'unknown') {
  const { error } = await requireSupabase().rpc('decide_preflight_finding', {
    requested_finding_id: id,
    decision,
  });
  throwDataError(error);
}

export async function resolvePreflightFinding(input: PreflightResolutionInput) {
  const { data, error } = await requireSupabase().rpc('resolve_preflight_finding', {
    requested_finding_id: input.findingId,
    requested_knowledge_item_id: input.knowledgeItemId ?? null,
    requested_knowledge_type: input.knowledgeType,
    requested_title: input.title.trim(),
    requested_content: input.content.trim(),
  });
  throwDataError(error);
  return data;
}

export async function advanceHandoffToPreview(handoffId: string, acknowledgeCritical: boolean) {
  const { error } = await requireSupabase().rpc('advance_handoff_to_preview', {
    requested_handoff_id: handoffId,
    acknowledge_critical: acknowledgeCritical,
  });
  throwDataError(error);
}

export async function getHandoffPublication(handoffId: string) {
  const { data, error } = await requireSupabase()
    .from('handoff_publications')
    .select('*')
    .eq('handoff_id', handoffId)
    .maybeSingle();
  throwDataError(error);
  return data ? mapHandoffPublication(data) : null;
}

export async function listHandoffPublicationItems(publicationId: string) {
  const { data, error } = await requireSupabase()
    .from('handoff_publication_items')
    .select('*')
    .eq('publication_id', publicationId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  throwDataError(error);
  return data.map(mapPublishedHandoffItem);
}

export async function publishHandoff(handoffId: string) {
  const { data, error } = await requireSupabase().rpc('publish_handoff', {
    requested_handoff_id: handoffId,
  });
  throwDataError(error);
  return data;
}

export async function revokeHandoffLink(handoffId: string) {
  const { error } = await requireSupabase().rpc('revoke_handoff_link', {
    requested_handoff_id: handoffId,
  });
  throwDataError(error);
}

export async function replaceHandoffLink(handoffId: string) {
  const { data, error } = await requireSupabase().rpc('replace_handoff_link', {
    requested_handoff_id: handoffId,
  });
  throwDataError(error);
  return data;
}

export async function getSharedHandoff(token: string): Promise<SharedHandoff | null> {
  const { data, error } = await requireSupabase().rpc('get_shared_handoff', {
    requested_token: token,
  });
  throwDataError(error);
  if (data === null) return null;
  const parsed = sharedHandoffSchema.safeParse(data);
  if (!parsed.success) throw new Error('This published handoff could not be verified safely.');
  return parsed.data;
}

export async function askRelay(token: string, question: string): Promise<AskRelayAnswer> {
  const result = await requireSupabase().functions.invoke('ask-relay', {
    body: { token, question: question.trim() },
  });
  if (result.error) {
    let message = 'Ask Relay is temporarily unavailable. The published handoff is still available above.';
    const context = (result.error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      const body = await context.json().catch(() => null) as { error?: unknown } | null;
      if (typeof body?.error === 'string') message = body.error;
    }
    throw new Error(message);
  }
  const parsed = askRelayAnswerSchema.safeParse(result.data);
  if (!parsed.success) throw new Error('Ask Relay could not verify its answer. Please try again.');
  return parsed.data;
}
