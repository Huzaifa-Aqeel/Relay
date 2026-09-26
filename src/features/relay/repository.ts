import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';
import { z } from 'zod';

import { FunctionsHttpError } from '@supabase/supabase-js';

import { requireSupabase } from '@/lib/supabase';
import type { Database } from '@/types/database';
import { ALL_KNOWLEDGE_TYPES } from '@/features/relay/types';
import type {
  AskRelayAnswer,
  CaptureInput,
  CaptureDraftInput,
  CaptureSubmitResult,
  Handoff,
  HandoffCapture,
  HandoffInput,
  HandoffPublication,
  HandoffSource,
  KnowledgeItem,
  KnowledgeItemUpdateInput,
  KnowledgeProvenance,
  Organization,
  OrganizationContentFile,
  OrganizationContentInput,
  OrganizationFile,
  OrganizationInput,
  MembershipRequestStatus,
  MembershipSearchResult,
  PendingMembershipRequest,
  RelayAccess,
  OrganizationPlan,
  OrganizationRole,
  AssignedRole,
  PreflightEvidence,
  PreflightFinding,
  PreflightResolutionInput,
  PreflightRun,
  RoleInput,
  SharedHandoff,
  MemoryRole,
  MemorySnapshot,
  RoleMemoryChange,
  RoleMemoryComparison,
  DocumentSourceInput,
  DocumentDuplicateCheckInput,
  DocumentDuplicateCheckResult,
  GoogleDriveImportStart,
  SourceUploadResult,
  VoiceRecordingInput,
  VoiceTranscriptPreview,
} from '@/features/relay/types';

type OrganizationRow = Database['public']['Tables']['organizations']['Row'];
type OrganizationFileRow = Database['public']['Tables']['organization_files']['Row'];
type RoleRow = Database['public']['Tables']['roles']['Row'];
type HandoffRow = Database['public']['Tables']['handoffs']['Row'];
type SourceRow = Database['public']['Tables']['sources']['Row'];
type CaptureRow = Database['public']['Tables']['captures']['Row'];
type KnowledgeItemRow = Database['public']['Tables']['knowledge_items']['Row'];
type PreflightRunRow = Database['public']['Tables']['preflight_runs']['Row'];
type PreflightFindingRow = Database['public']['Tables']['preflight_findings']['Row'];
type PreflightEvidenceRow = Database['public']['Tables']['preflight_finding_evidence']['Row'];
type HandoffPublicationRow = Database['public']['Tables']['handoff_publications']['Row'];
type HandoffPublicationItemRow = Database['public']['Tables']['handoff_publication_items']['Row'];
type RoleMemoryComparisonRow = Database['public']['Tables']['role_memory_comparisons']['Row'];
type RoleMemoryChangeRow = Database['public']['Tables']['role_memory_changes']['Row'];

const LOGO_BUCKET = 'organization-logos';
const ORGANIZATION_CONTENT_BUCKET = 'organization-content';
const SOURCE_BUCKET = 'handoff-sources';
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const MAX_ORGANIZATION_FILE_BYTES = 25 * 1024 * 1024;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

export type RelayPlanLimit = 'organization' | 'role' | 'role_access' | 'handoff';

export class RelayPlanLimitError extends Error {
  constructor(public readonly limit: RelayPlanLimit) {
    super(limit === 'role_access'
      ? 'Relay Pro is required to open this Role.'
      : `Relay Pro is required to create another ${limit}.`);
    this.name = 'RelayPlanLimitError';
  }
}

function messageFor(error: { code?: string; message: string }) {
  const normalizedMessage = error.message.toLowerCase();
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
  if (error.message.includes('every capture to finish')) return 'Wait for every capture to finish, then open Review.';
  if (error.message.includes('Active published link unavailable')) return 'This published link is already inactive.';
  if (normalizedMessage.includes('mime type') && normalizedMessage.includes('not supported')) {
    return 'This file type is not available for Capture yet.';
  }
  if (normalizedMessage.includes('network') || normalizedMessage.includes('fetch')) {
    return 'Check your connection and try again.';
  }
  return 'Relay could not complete that request. Please try again.';
}

function throwDataError(error: { code?: string; message: string } | null): asserts error is null {
  if (!error) return;
  const planLimit = error.message.match(/RELAY_PRO_REQUIRED:(organization|role_access|role|handoff)/)?.[1] as RelayPlanLimit | undefined;
  if (planLimit) throw new RelayPlanLimitError(planLimit);
  throw new Error(messageFor(error));
}

function mapOrganization(
  row: OrganizationRow,
  urls: { logo?: string | null; files?: OrganizationFile[] } = {},
): Organization {
  return {
    id: row.id,
    createdBy: row.created_by,
    name: row.name,
    institution: row.institution,
    description: row.description,
    logoPath: row.logo_path,
    logoUrl: urls.logo ?? null,
    youtubeVideoUrl: row.youtube_video_url,
    files: urls.files ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapOrganizationFile(row: OrganizationFileRow, url: string | null): OrganizationFile {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    fileName: row.file_name,
    storagePath: row.storage_path,
    url,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
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
    contentHash: row.content_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCapture(row: CaptureRow, attachments: HandoffSource[]): HandoffCapture {
  return {
    id: row.id,
    organizationId: row.organization_id,
    handoffId: row.handoff_id,
    createdBy: row.created_by,
    title: row.title,
    textContent: row.text_content,
    promptId: row.prompt_id,
    submittedAt: row.submitted_at!,
    structuringStatus: row.structuring_status as HandoffCapture['structuringStatus'],
    structuringFailureReason: row.structuring_failure_reason,
    structuredAt: row.structured_at,
    structuredProposalCount: row.structured_proposal_count,
    attachments,
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
    lineageId: row.lineage_id,
    inheritedFromServicePeriod: row.inherited_from_service_period,
    proposalAction: row.proposal_action as KnowledgeItem['proposalAction'],
    proposalTargetId: row.proposal_target_id,
    captureId: row.capture_id,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
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
    knowledgeType: z.enum(ALL_KNOWLEDGE_TYPES),
    title: z.string().min(1).max(160),
    content: z.string().min(1).max(5000),
    sortOrder: z.number().int().nonnegative(),
  }).strict()).max(1000),
}).strict();

const askRelayAnswerSchema = z.object({
  status: z.enum(['answered', 'unsupported', 'conflict']),
  answer: z.string().min(1).max(1600),
  citations: z.array(z.object({
    ref: z.string().regex(/^E\d+$/),
    title: z.string().min(1).max(160),
    knowledgeType: z.enum(ALL_KNOWLEDGE_TYPES),
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
  willRenew: z.boolean().nullable(),
  store: z.string().nullable(),
  isPurchaser: z.boolean(),
}).strict();

const relayAccessSchema = z.object({
  hasMembership: z.boolean(),
  hasFullAccess: z.boolean(),
}).strict();

const membershipSearchResultSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  institution: z.string().max(160),
  requestStatus: z.enum(['pending', 'accepted', 'rejected']).nullable(),
}).strict();

const membershipRequestStatusSchema = z.object({
  requestId: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(1).max(100),
  institution: z.string().max(160),
  status: z.enum(['pending', 'accepted', 'rejected']),
  requestedAt: z.string(),
}).strict();

const pendingMembershipRequestSchema = z.object({
  requestId: z.string().uuid(),
  userId: z.string().uuid(),
  name: z.string().max(100),
  requestedAt: z.string(),
}).strict();

const voiceTranscriptPreviewSchema = z.object({
  transcript: z.string().trim().min(1).max(50_000),
  providerReference: z.string().max(500).nullable(),
}).strict();

async function signedLogo(path: string | null) {
  if (!path) return null;
  const { data, error } = await requireSupabase().storage.from(LOGO_BUCKET).createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}

async function signedOrganizationFile(path: string | null) {
  if (!path) return null;
  const { data, error } = await requireSupabase().storage
    .from(ORGANIZATION_CONTENT_BUCKET)
    .createSignedUrl(path, 3600);
  return error ? null : data.signedUrl;
}

async function uploadOrganizationPdf(organizationId: string, file: OrganizationContentFile) {
  if (file.size && file.size > MAX_ORGANIZATION_FILE_BYTES) {
    throw new Error('Choose a PDF smaller than 25 MB.');
  }
  if (file.mimeType && file.mimeType !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Choose a PDF document.');
  }
  const body = await readFileBody(file.uri);
  if (body.byteLength > MAX_ORGANIZATION_FILE_BYTES) throw new Error('Choose a PDF smaller than 25 MB.');
  const path = `${organizationId}/${Crypto.randomUUID()}.pdf`;
  const uploaded = await requireSupabase().storage.from(ORGANIZATION_CONTENT_BUCKET).upload(path, body, {
    contentType: 'application/pdf', upsert: false,
  });
  throwDataError(uploaded.error);
  return { path, sizeBytes: body.byteLength };
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

function hexDigest(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(buffer: ArrayBuffer) {
  return hexDigest(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(buffer)));
}

export async function findExactDocumentDuplicate(
  input: DocumentDuplicateCheckInput,
): Promise<DocumentDuplicateCheckResult> {
  if (input.file.size && input.file.size > MAX_SOURCE_BYTES) {
    throw new Error('Choose a file smaller than 25 MB.');
  }
  const body = await readFileBody(input.file.uri);
  if (body.byteLength > MAX_SOURCE_BYTES) throw new Error('Choose a file smaller than 25 MB.');
  const contentHash = await sha256(body);
  const { data, error } = await requireSupabase()
    .from('sources')
    .select('id, title, mime_type, size_bytes')
    .eq('organization_id', input.organizationId)
    .eq('handoff_id', input.handoffId)
    .eq('kind', 'document')
    .eq('content_hash', contentHash)
    .maybeSingle();
  throwDataError(error);
  return {
    contentHash,
    duplicate: data ? { sourceId: data.id, title: data.title } : null,
  };
}

export async function transcribeVoiceRecording(input: VoiceRecordingInput): Promise<VoiceTranscriptPreview> {
  if (input.file.size && input.file.size > MAX_SOURCE_BYTES) {
    throw new Error('Record a voice note shorter than 25 MB.');
  }

  const body = await readFileBody(input.file.uri);
  if (body.byteLength > MAX_SOURCE_BYTES) throw new Error('Record a voice note shorter than 25 MB.');
  const result = await requireSupabase().functions.invoke('transcribe-source', {
    body,
    headers: {
      'content-type': input.file.mimeType,
      'x-relay-handoff-id': input.handoffId,
      'x-relay-file-name': safeFileName(input.file.name),
    },
  });
  if (result.error) {
    throw new Error("We couldn't transcribe this recording.");
  }
  const preview = voiceTranscriptPreviewSchema.parse(result.data);
  return {
    organizationId: input.organizationId,
    handoffId: input.handoffId,
    ...preview,
  };
}

export async function listOrganizations() {
  const { data, error } = await requireSupabase()
    .from('organizations')
    .select('*')
    .order('name', { ascending: true });
  throwDataError(error);
  return Promise.all(data.map(async (row) => mapOrganization(row, { logo: await signedLogo(row.logo_path) })));
}

export async function getOrganization(id: string) {
  const client = requireSupabase();
  const [{ data, error }, { data: fileRows, error: filesError }] = await Promise.all([
    client.from('organizations').select('*').eq('id', id).single(),
    client.from('organization_files').select('*').eq('organization_id', id).order('created_at', { ascending: true }),
  ]);
  throwDataError(error);
  throwDataError(filesError);
  const [logo, files] = await Promise.all([
    signedLogo(data.logo_path),
    Promise.all(fileRows.map(async (file) => mapOrganizationFile(file, await signedOrganizationFile(file.storage_path)))),
  ]);
  return mapOrganization(data, { logo, files });
}

export async function getRelayAccess(): Promise<RelayAccess> {
  const { data, error } = await requireSupabase().rpc('get_my_relay_access');
  throwDataError(error);
  return relayAccessSchema.parse(data);
}

export async function searchOrganizationsForMembership(query: string): Promise<MembershipSearchResult[]> {
  const { data, error } = await requireSupabase().rpc('search_organizations_for_membership', {
    requested_query: query.trim(),
  });
  throwDataError(error);
  return z.array(membershipSearchResultSchema).parse(data);
}

export async function listMyMembershipRequests(): Promise<MembershipRequestStatus[]> {
  const { data, error } = await requireSupabase().rpc('list_my_membership_requests');
  throwDataError(error);
  return z.array(membershipRequestStatusSchema).parse(data);
}

export async function requestOrganizationMembership(organizationId: string) {
  const { data, error } = await requireSupabase().rpc('request_organization_membership', {
    requested_organization_id: organizationId,
  });
  throwDataError(error);
  return z.string().uuid().parse(data);
}

export async function listPendingMembershipRequests(organizationId: string): Promise<PendingMembershipRequest[]> {
  const { data, error } = await requireSupabase().rpc('list_pending_membership_requests', {
    requested_organization_id: organizationId,
  });
  throwDataError(error);
  return z.array(pendingMembershipRequestSchema).parse(data);
}

export async function decideOrganizationMembershipRequest(
  requestId: string,
  decision: 'accepted' | 'rejected',
) {
  const { data, error } = await requireSupabase().rpc('decide_organization_membership_request', {
    requested_request_id: requestId,
    requested_decision: decision,
  });
  throwDataError(error);
  return z.string().uuid().parse(data);
}

export async function updateOrganizationContent(input: OrganizationContentInput) {
  const client = requireSupabase();
  const uploadedPaths: string[] = [];
  try {
    const addedFiles = [];
    for (const addition of input.addedFiles) {
      const title = addition.title.trim();
      const fileName = addition.file.name.trim();
      if (!title || title.length > 120) throw new Error('Enter a file title under 120 characters.');
      if (!fileName || fileName.length > 255) throw new Error('Choose a PDF with a shorter file name.');
      const uploaded = await uploadOrganizationPdf(input.organizationId, addition.file);
      uploadedPaths.push(uploaded.path);
      addedFiles.push({
        title,
        fileName,
        storagePath: uploaded.path,
        sizeBytes: uploaded.sizeBytes,
      });
    }

    const { data, error } = await client.rpc('save_organization_home_content', {
      requested_organization_id: input.organizationId,
      requested_description: input.description.trim(),
      requested_youtube_video_url: input.youtubeVideoUrl?.trim() || null,
      requested_added_files: addedFiles,
      requested_removed_file_ids: input.removedFileIds,
    });
    throwDataError(error);
    const result = z.object({ removedPaths: z.array(z.string()) }).parse(data);
    if (result.removedPaths.length) {
      await client.storage.from(ORGANIZATION_CONTENT_BUCKET).remove(result.removedPaths);
    }
  } catch (error) {
    if (uploadedPaths.length) await client.storage.from(ORGANIZATION_CONTENT_BUCKET).remove(uploadedPaths);
    throw error;
  }
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

export async function listMyAssignedRoles(): Promise<AssignedRole[]> {
  const client = requireSupabase();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError) throw new Error('Relay could not verify your Role access. Please try again.');
  if (!authData.user) return [];

  const { data: assignments, error: assignmentsError } = await client
    .from('role_assignments')
    .select('role_id, organization_id, service_period, accepted_at')
    .eq('user_id', authData.user.id)
    .eq('status', 'active')
    .order('accepted_at', { ascending: false });
  throwDataError(assignmentsError);
  if (!assignments.length) return [];

  const roleIds = [...new Set(assignments.map((assignment) => assignment.role_id))];
  const organizationIds = [...new Set(assignments.map((assignment) => assignment.organization_id))];
  const [{ data: roles, error: rolesError }, { data: organizations, error: organizationsError }] = await Promise.all([
    client.from('roles').select('id, organization_id, title, description').in('id', roleIds).is('archived_at', null),
    client.from('organizations').select('id, name').in('id', organizationIds),
  ]);
  throwDataError(rolesError);
  throwDataError(organizationsError);

  const rolesById = new Map(roles.map((role) => [role.id, role]));
  const organizationsById = new Map(organizations.map((organization) => [organization.id, organization]));
  const seen = new Set<string>();
  return assignments.flatMap((assignment) => {
    if (seen.has(assignment.role_id)) return [];
    const role = rolesById.get(assignment.role_id);
    const organization = organizationsById.get(assignment.organization_id);
    if (!role || !organization) return [];
    seen.add(assignment.role_id);
    return [{
      roleId: role.id,
      organizationId: role.organization_id,
      organizationName: organization.name,
      title: role.title,
      description: role.description,
      servicePeriod: assignment.service_period,
    }];
  });
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
    .order('period_start_year', { ascending: false, nullsFirst: false })
    .order('period_end_year', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
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

export async function listHandoffCaptures(handoffId: string): Promise<HandoffCapture[]> {
  const client = requireSupabase();
  const { data: captures, error: captureError } = await client
    .from('captures')
    .select('*')
    .eq('handoff_id', handoffId)
    .not('submitted_at', 'is', null)
    .order('created_at', { ascending: false });
  throwDataError(captureError);
  if (!captures.length) return [];

  const captureIds = captures.map((capture) => capture.id);
  const { data: links, error: linkError } = await client
    .from('capture_sources')
    .select('capture_id, source_id, relationship, position')
    .in('capture_id', captureIds)
    .eq('relationship', 'attachment')
    .is('removed_at', null)
    .order('position', { ascending: true });
  throwDataError(linkError);
  const sourceIds = [...new Set(links.map((link) => link.source_id))];
  const { data: sources, error: sourceError } = sourceIds.length
    ? await client.from('sources').select('*').in('id', sourceIds)
    : { data: [], error: null };
  throwDataError(sourceError);
  const sourceById = new Map(sources.map((source) => [source.id, mapSource(source)]));
  const attachmentsByCapture = new Map<string, HandoffSource[]>();
  for (const link of links) {
    const source = sourceById.get(link.source_id);
    if (!source) continue;
    const current = attachmentsByCapture.get(link.capture_id) ?? [];
    current.push(source);
    attachmentsByCapture.set(link.capture_id, current);
  }
  return captures.map((capture) => mapCapture(capture, attachmentsByCapture.get(capture.id) ?? []));
}

export async function listCaptureAttachments(captureId: string): Promise<HandoffSource[]> {
  const client = requireSupabase();
  const { data: links, error: linkError } = await client.from('capture_sources')
    .select('source_id, position')
    .eq('capture_id', captureId)
    .eq('relationship', 'attachment')
    .is('removed_at', null)
    .order('position', { ascending: true });
  throwDataError(linkError);
  if (!links.length) return [];
  const { data: sources, error: sourceError } = await client.from('sources')
    .select('*')
    .in('id', links.map((link) => link.source_id));
  throwDataError(sourceError);
  const sourceById = new Map(sources.map((source) => [source.id, mapSource(source)]));
  return links.flatMap((link) => {
    const source = sourceById.get(link.source_id);
    return source ? [source] : [];
  });
}

export async function getHandoffSource(id: string) {
  const { data, error } = await requireSupabase().from('sources').select('*').eq('id', id).single();
  throwDataError(error);
  return mapSource(data);
}

async function markDocumentProcessingFailed(sourceId: string) {
  const reason = 'The document is saved, but Relay could not reach document processing. Check your connection and retry.';
  const { error } = await requireSupabase()
    .from('sources')
    .update({ processing_status: 'failed', failure_reason: reason })
    .eq('id', sourceId);
  throwDataError(error);
}

export async function processDocumentSource(sourceId: string) {
  const client = requireSupabase();
  const result = await client.functions.invoke('process-document-source', { body: { sourceId } });
  if (result.error) {
    const { data: current } = await client
      .from('sources')
      .select('processing_status')
      .eq('id', sourceId)
      .maybeSingle();
    if (!current || current.processing_status === 'processing') await markDocumentProcessingFailed(sourceId);
    throw new Error('Your document is safe, but processing is not available yet.');
  }
}

async function removeDocumentAttachment(captureId: string, sourceId: string) {
  const result = await requireSupabase().functions.invoke('process-document-source', {
    body: { action: 'remove', captureId, sourceId },
  });
  if (result.error) throw new Error('Relay could not finish removing an attachment. Try Organize again.');
}

async function createDocumentSource(input: DocumentSourceInput, userId: string): Promise<SourceUploadResult> {
  if (input.file.size && input.file.size > MAX_SOURCE_BYTES) {
    throw new Error('Choose a file smaller than 25 MB.');
  }

  const client = requireSupabase();
  const id = Crypto.randomUUID();
  const body = await readFileBody(input.file.uri);
  if (body.byteLength > MAX_SOURCE_BYTES) throw new Error('Choose a file smaller than 25 MB.');

  const contentHash = await sha256(body);

  const { data: duplicate, error: duplicateError } = await client
    .from('sources')
    .select('id, title')
    .eq('organization_id', input.organizationId)
    .eq('handoff_id', input.handoffId)
    .eq('kind', 'document')
    .eq('content_hash', contentHash)
    .maybeSingle();
  throwDataError(duplicateError);
  if (duplicate) {
    const attached = await client.rpc('attach_source_to_capture', {
      requested_capture_id: input.captureId,
      requested_source_id: duplicate.id,
      requested_position: input.capturePosition ?? 0,
      requested_created_for_capture: false,
    });
    throwDataError(attached.error);
    return { status: 'duplicate', sourceId: duplicate.id, title: duplicate.title };
  }

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
    kind: 'document',
    title: input.title.trim(),
    storage_path: path,
    mime_type: input.file.mimeType,
    size_bytes: body.byteLength,
    processing_status: 'pending',
    content_hash: contentHash,
  });
  if (inserted.error) {
    await client.storage.from(SOURCE_BUCKET).remove([path]);
    if (inserted.error.code === '23505' && contentHash) {
      const { data: duplicate } = await client.from('sources')
        .select('id, title')
        .eq('handoff_id', input.handoffId)
        .eq('content_hash', contentHash)
        .maybeSingle();
      if (duplicate) {
        const attached = await client.rpc('attach_source_to_capture', {
          requested_capture_id: input.captureId,
          requested_source_id: duplicate.id,
          requested_position: input.capturePosition ?? 0,
          requested_created_for_capture: false,
        });
        throwDataError(attached.error);
        return { status: 'duplicate', sourceId: duplicate.id, title: duplicate.title };
      }
    }
    throwDataError(inserted.error);
  }

  const attached = await client.rpc('attach_source_to_capture', {
    requested_capture_id: input.captureId,
    requested_source_id: id,
    requested_position: input.capturePosition ?? 0,
    requested_created_for_capture: true,
  });
  if (attached.error) {
    await client.storage.from(SOURCE_BUCKET).remove([path]);
    await client.from('sources').delete().eq('id', id);
    throwDataError(attached.error);
  }
  return { status: 'created', sourceId: id };
}

export async function discardCaptureDraft(captureId: string) {
  const client = requireSupabase();
  const { data: links } = await client.from('capture_sources')
    .select('source_id, relationship, created_for_capture')
    .eq('capture_id', captureId)
    .eq('created_for_capture', true);
  for (const link of links ?? []) {
    if (link.relationship === 'attachment') {
      await rollbackCaptureAttachment(captureId, link.source_id);
    }
  }
  const discarded = await client.rpc('discard_capture_draft', { requested_capture_id: captureId });
  throwDataError(discarded.error);
}

export async function rollbackCaptureAttachment(captureId: string, sourceId: string) {
  const client = requireSupabase();
  const { data: storagePath, error } = await client.rpc('rollback_capture_attachment', {
    requested_capture_id: captureId,
    requested_source_id: sourceId,
  });
  throwDataError(error);
  if (storagePath) await client.storage.from(SOURCE_BUCKET).remove([storagePath]);
}

export async function createCaptureDraft(input: CaptureDraftInput) {
  const { data, error } = await requireSupabase().rpc('create_capture_draft', {
    requested_organization_id: input.organizationId,
    requested_handoff_id: input.handoffId,
    requested_title: input.title.trim(),
    requested_prompt_id: input.promptId ?? null,
    requested_text_content: input.textContent?.trim() || null,
  });
  throwDataError(error);
  return data;
}

async function functionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.clone().json();
      if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim();
    } catch {
      // Keep the safe fallback when the response has no readable JSON body.
    }
  }
  return fallback;
}

export async function startGoogleDriveImport(captureId: string, returnUrl: string): Promise<GoogleDriveImportStart> {
  const result = await requireSupabase().functions.invoke('google-drive-import', {
    body: { captureId, returnUrl },
  });
  if (result.error) {
    throw new Error(await functionErrorMessage(result.error, 'Google Drive could not be opened. Try again.'));
  }
  const authUrl = typeof result.data?.authUrl === 'string' ? result.data.authUrl : '';
  if (!/^https:\/\/accounts\.google\.com\//.test(authUrl)) {
    throw new Error('Google Drive could not be opened. Try again.');
  }
  return { authUrl };
}

export async function submitCapture(input: CaptureInput, userId: string): Promise<CaptureSubmitResult> {
  const client = requireSupabase();
  let captureId = input.captureId ?? null;
  const creating = !captureId;
  if (!captureId) {
    const created = await client.rpc('create_capture_draft', {
      requested_organization_id: input.organizationId,
      requested_handoff_id: input.handoffId,
      requested_title: input.title.trim(),
      requested_prompt_id: input.promptId ?? null,
      requested_text_content: input.textContent?.trim() || null,
    });
    throwDataError(created.error);
    captureId = created.data;
  }

  const attachmentSourceIds = [...input.retainedAttachmentSourceIds];
  const newlyAttachedSourceIds: string[] = [];
  const duplicateTitles: string[] = [];
  try {
    for (const [index, attachment] of input.attachments.entries()) {
      const result = await createDocumentSource({
        organizationId: input.organizationId,
        handoffId: input.handoffId,
        kind: 'document',
        title: attachment.title,
        file: attachment,
        captureId,
        capturePosition: attachmentSourceIds.length + index + 1,
      }, userId);
      attachmentSourceIds.push(result.sourceId);
      if (!input.retainedAttachmentSourceIds.includes(result.sourceId)) {
        newlyAttachedSourceIds.push(result.sourceId);
      }
      if (result.status === 'duplicate') duplicateTitles.push(result.title);
    }

    const saved = await client.rpc('save_capture', {
      requested_capture_id: captureId,
      requested_title: input.title.trim(),
      requested_prompt_id: input.promptId ?? null,
      requested_text_content: input.textContent?.trim() || null,
      requested_attachment_source_ids: [...new Set(attachmentSourceIds)],
    });
    throwDataError(saved.error);
    return { captureId, duplicateTitles };
  } catch (error) {
    if (creating) await discardCaptureDraft(captureId).catch(() => undefined);
    else {
      for (const sourceId of newlyAttachedSourceIds.reverse()) {
        await rollbackCaptureAttachment(captureId, sourceId).catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function generateCaptureProposals(captureId: string) {
  const client = requireSupabase();
  const { data: relations, error: relationError } = await client.from('capture_sources')
    .select('source_id, removed_at')
    .eq('capture_id', captureId)
    .eq('relationship', 'attachment');
  throwDataError(relationError);

  for (const relation of relations.filter((item) => item.removed_at)) {
    await removeDocumentAttachment(captureId, relation.source_id);
  }

  const activeIds = relations.filter((item) => !item.removed_at).map((item) => item.source_id);
  const { data: activeSources, error: sourceError } = activeIds.length
    ? await client.from('sources').select('id, processing_status').in('id', activeIds)
    : { data: [], error: null };
  throwDataError(sourceError);
  const toProcess = activeSources.filter((source) => source.processing_status === 'pending' || source.processing_status === 'failed');
  if (toProcess.length) {
    await Promise.all(toProcess.map((source) => processDocumentSource(source.id)));
    return 0;
  }
  if (activeSources.some((source) => source.processing_status === 'processing')) return 0;

  const result = await client.functions.invoke('generate-knowledge-proposals', {
    body: { captureId },
  });
  if (result.error) {
    let message = "We couldn't organize this capture. Try again.";
    if (result.error instanceof FunctionsHttpError) {
      try {
        const body = await result.error.context.clone().json();
        if (typeof body?.error === 'string' && body.error.trim()) message = body.error.trim();
      } catch {
        // Retain the safe fallback when the function response has no readable JSON body.
      }
    }
    throw new Error(message);
  }
  return Number(result.data?.proposalCount ?? 0);
}

export async function listKnowledgeItems(handoffId: string) {
  const { data, error } = await requireSupabase()
    .from('knowledge_items')
    .select('*')
    .eq('handoff_id', handoffId)
    .in('status', ['proposed', 'approved'])
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

export async function updateKnowledgeItem(id: string, input: KnowledgeItemUpdateInput) {
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

export async function listRolePublications(roleId: string) {
  const handoffs = await listRoleHandoffs(roleId);
  if (!handoffs.length) return [];
  const { data, error } = await requireSupabase().from('handoff_publications').select('*')
    .in('handoff_id', handoffs.map(h => h.id))
    .order('period_start_year', { ascending: false, nullsFirst: false })
    .order('period_end_year', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false });
  throwDataError(error); return data.map(mapHandoffPublication);
}

export async function publishHandoff(handoffId: string) {
  const client = requireSupabase();
  const { data, error } = await client.rpc('publish_handoff', {
    requested_handoff_id: handoffId,
  });
  throwDataError(error);
  const indexResult = await client.functions.invoke('index-publication-knowledge', {
    body: { handoffId },
  });
  if (indexResult.error) {
    // The immutable publication is already complete. Ask Relay can repair a
    // missing vector index lazily and still retains lexical BM25F fallback.
    console.warn('Published handoff vector indexing was deferred.');
  }
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

function mapMemoryComparison(row: RoleMemoryComparisonRow): RoleMemoryComparison {
  return {
    id: row.id,
    organizationId: row.organization_id,
    roleId: row.role_id,
    previousPublicationId: row.previous_publication_id,
    currentPublicationId: row.current_publication_id,
    previousServicePeriod: row.previous_service_period,
    currentServicePeriod: row.current_service_period,
    status: row.status as RoleMemoryComparison['status'],
    failureReason: row.failure_reason,
    materialChangeCount: row.material_change_count,
    completedAt: row.completed_at,
  };
}

function parseCitationSources(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const source = candidate as Record<string, unknown>;
    if (typeof source.label !== 'string') return [];
    return [{
      label: source.label,
      locator: typeof source.locator === 'string' ? source.locator : null,
    }];
  });
}

function parseMemorySnapshot(value: unknown): MemorySnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.id !== 'string'
    || typeof snapshot.sourceKnowledgeItemId !== 'string'
    || typeof snapshot.knowledgeType !== 'string'
    || !ALL_KNOWLEDGE_TYPES.includes(snapshot.knowledgeType as typeof ALL_KNOWLEDGE_TYPES[number])
    || typeof snapshot.title !== 'string'
    || typeof snapshot.content !== 'string') return null;
  return {
    id: snapshot.id,
    sourceKnowledgeItemId: snapshot.sourceKnowledgeItemId,
    knowledgeType: snapshot.knowledgeType as MemorySnapshot['knowledgeType'],
    title: snapshot.title,
    content: snapshot.content,
    citationSources: parseCitationSources(snapshot.citationSources ?? []),
  };
}

function mapMemoryChange(row: RoleMemoryChangeRow): RoleMemoryChange {
  return {
    id: row.id,
    comparisonId: row.comparison_id,
    changeType: row.change_type as RoleMemoryChange['changeType'],
    title: row.title,
    summary: row.summary,
    reasonCategory: row.reason_category as RoleMemoryChange['reasonCategory'],
    reasonExplanation: row.reason_explanation,
    beforeSnapshot: parseMemorySnapshot(row.before_snapshot),
    afterSnapshot: parseMemorySnapshot(row.after_snapshot),
    supportingProvenance: parseCitationSources(row.supporting_provenance),
    humanConfirmed: row.human_confirmed,
  };
}

export async function listMemoryRoles(): Promise<MemoryRole[]> {
  const client = requireSupabase();
  const { data: publications, error: publicationError } = await client.from('handoff_publications').select('handoff_id');
  throwDataError(publicationError);
  if (!publications.length) return [];
  const { data: handoffs, error: handoffError } = await client
    .from('handoffs')
    .select('id, organization_id, role_id, service_period, period_start_year, period_end_year, published_at')
    .in('id', publications.map(p => p.handoff_id))
    .order('period_start_year', { ascending: false, nullsFirst: false })
    .order('period_end_year', { ascending: false, nullsFirst: false })
    .order('published_at', { ascending: false });
  throwDataError(handoffError);
  if (!handoffs.length) return [];

  const roleIds = [...new Set(handoffs.map((handoff) => handoff.role_id))];
  const organizationIds = [...new Set(handoffs.map((handoff) => handoff.organization_id))];
  const [{ data: roles, error: roleError }, { data: organizations, error: organizationError }] = await Promise.all([
    client.from('roles').select('id, title').in('id', roleIds),
    client.from('organizations').select('id, name').in('id', organizationIds),
  ]);
  throwDataError(roleError);
  throwDataError(organizationError);
  const roleTitles = new Map(roles.map((role) => [role.id, role.title]));
  const organizationNames = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const grouped = new Map<string, MemoryRole>();
  for (const handoff of handoffs) {
    const existing = grouped.get(handoff.role_id);
    if (existing) {
      existing.publishedHandoffCount += 1;
      continue;
    }
    grouped.set(handoff.role_id, {
      organizationId: handoff.organization_id,
      organizationName: organizationNames.get(handoff.organization_id) ?? 'Organization',
      roleId: handoff.role_id,
      roleTitle: roleTitles.get(handoff.role_id) ?? 'Role',
      publishedHandoffCount: 1,
      latestServicePeriod: handoff.service_period,
    });
  }
  return [...grouped.values()];
}

export async function getLatestRoleMemoryComparison(roleId: string): Promise<RoleMemoryComparison | null> {
  const { data, error } = await requireSupabase()
    .from('role_memory_comparisons')
    .select('*')
    .eq('role_id', roleId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  throwDataError(error);
  return data ? mapMemoryComparison(data) : null;
}

export async function listRoleMemoryChanges(comparisonId: string): Promise<RoleMemoryChange[]> {
  const { data, error } = await requireSupabase()
    .from('role_memory_changes')
    .select('*')
    .eq('comparison_id', comparisonId)
    .order('created_at', { ascending: true });
  throwDataError(error);
  return data.map(mapMemoryChange);
}

export async function listRoleLessons(roleId: string): Promise<Pick<KnowledgeItem, 'id' | 'title' | 'content'>[]> {
  const client = requireSupabase();
  const publications = await listRolePublications(roleId);
  if (!publications.length) return [];
  const { data, error } = await client
    .from('handoff_publication_items')
    .select('source_knowledge_item_id, title, content')
    .in('publication_id', publications.map(p => p.id))
    .in('knowledge_type', ['lesson', 'warning_lesson'])
    .order('created_at', { ascending: false });
  throwDataError(error);
  return data.map(item => ({ id: item.source_knowledge_item_id, title: item.title, content: item.content }));
}

export async function confirmMemoryChangeReason(input: {
  changeId: string;
  reasonCategory: 'lesson_driven' | 'leadership_preference' | 'contact_resource' | 'unknown';
  explanation: string;
  lessonKnowledgeItemId?: string | null;
}) {
  const { error } = await requireSupabase().rpc('confirm_memory_change_reason_v13', {
    requested_change_id: input.changeId,
    requested_reason_category: input.reasonCategory,
    requested_explanation: input.explanation.trim(),
    requested_lesson_knowledge_item_id: input.lessonKnowledgeItemId ?? null,
  });
  throwDataError(error);
}

export async function compareRoleHandoffs(roleId: string) {
  const result = await requireSupabase().functions.invoke('compare-handoffs', { body: { roleId } });
  if (result.error) throw new Error('Relay could not compare these handoffs safely. Please try again.');
  return String(result.data?.comparisonId ?? '');
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
