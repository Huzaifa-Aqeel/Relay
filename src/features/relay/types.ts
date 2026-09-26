export type Organization = {
  id: string;
  createdBy: string;
  name: string;
  institution: string;
  description: string;
  logoPath: string | null;
  logoUrl: string | null;
  youtubeVideoUrl: string | null;
  files: OrganizationFile[];
  createdAt: string;
  updatedAt: string;
};

export type RelayAccess = {
  hasMembership: boolean;
  hasFullAccess: boolean;
};

export type MembershipSearchResult = {
  organizationId: string;
  name: string;
  institution: string;
  requestStatus: 'pending' | 'accepted' | 'rejected' | null;
};

export type MembershipRequestStatus = {
  requestId: string;
  organizationId: string;
  name: string;
  institution: string;
  status: 'pending' | 'accepted' | 'rejected';
  requestedAt: string;
};

export type PendingMembershipRequest = {
  requestId: string;
  userId: string;
  name: string;
  requestedAt: string;
};

export type OrganizationContentFile = {
  uri: string;
  name: string;
  mimeType?: string | null;
  size?: number | null;
};

export type OrganizationFile = {
  id: string;
  organizationId: string;
  title: string;
  fileName: string;
  storagePath: string;
  url: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationContentFileAddition = {
  title: string;
  file: OrganizationContentFile;
};

export type OrganizationContentInput = {
  organizationId: string;
  description: string;
  youtubeVideoUrl: string | null;
  addedFiles: OrganizationContentFileAddition[];
  removedFileIds: string[];
};

export type OrganizationPlan = {
  organizationId: string;
  plan: 'free' | 'pro';
  expiresAt: string | null;
  willRenew: boolean | null;
  store: string | null;
  isPurchaser: boolean;
};

export type OrganizationRole = {
  id: string;
  organizationId: string;
  createdBy: string;
  title: string;
  description: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssignedRole = {
  roleId: string;
  organizationId: string;
  organizationName: string;
  title: string;
  description: string;
  servicePeriod: string;
};

export type HandoffStage = 'capture' | 'review' | 'preflight' | 'preview' | 'published';
export type HandoffStatus = 'draft' | 'published' | 'archived';

export type Handoff = {
  id: string;
  organizationId: string;
  roleId: string;
  createdBy: string;
  servicePeriod: string;
  status: HandoffStatus;
  stage: HandoffStage;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationInput = {
  name: string;
  institution: string;
  description: string;
  logo?: { uri: string; mimeType?: string | null };
};

export type RoleInput = {
  organizationId: string;
  title: string;
  description: string;
};

export type HandoffInput = {
  organizationId: string;
  roleId: string;
  servicePeriod: string;
};

export const KNOWLEDGE_TYPES = [
  'process',
  'contact',
  'rule_deadline',
  'access_resource',
  'warning_lesson',
] as const;

export const LEGACY_KNOWLEDGE_TYPES = [
  'responsibility', 'deadline', 'warning', 'resource', 'lesson',
] as const;

export const ALL_KNOWLEDGE_TYPES = [
  ...KNOWLEDGE_TYPES,
  ...LEGACY_KNOWLEDGE_TYPES,
] as const;

export type BroadKnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type KnowledgeType = (typeof ALL_KNOWLEDGE_TYPES)[number];

export function broadKnowledgeType(type: KnowledgeType): BroadKnowledgeType {
  if (type === 'responsibility') return 'process';
  if (type === 'deadline') return 'rule_deadline';
  if (type === 'warning' || type === 'lesson') return 'warning_lesson';
  if (type === 'resource') return 'access_resource';
  return type;
}
export type SourceKind = 'typed_text' | 'voice' | 'document';
export type SourceProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';
export type SourceStructuringStatus = 'not_started' | 'processing' | 'ready' | 'failed';

export type HandoffSource = {
  id: string;
  organizationId: string;
  handoffId: string;
  createdBy: string;
  kind: SourceKind;
  title: string;
  textContent: string | null;
  storagePath: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  processingStatus: SourceProcessingStatus;
  failureReason: string | null;
  structuringStatus: SourceStructuringStatus;
  structuringFailureReason: string | null;
  structuredAt: string | null;
  structuredProposalCount: number | null;
  contentHash: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HandoffCapture = {
  id: string;
  organizationId: string;
  handoffId: string;
  createdBy: string;
  title: string;
  textContent: string | null;
  promptId: string | null;
  submittedAt: string;
  structuringStatus: SourceStructuringStatus;
  structuringFailureReason: string | null;
  structuredAt: string | null;
  structuredProposalCount: number | null;
  attachments: HandoffSource[];
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeStatus = 'proposed' | 'approved' | 'rejected' | 'accepted' | 'retired';
export type KnowledgeOrigin = 'manual' | 'ai' | 'inherited';
export type KnowledgeProposalAction = 'create' | 'update' | 'retire';

export type KnowledgeItem = {
  id: string;
  organizationId: string;
  handoffId: string;
  createdBy: string;
  knowledgeType: KnowledgeType;
  title: string;
  content: string;
  status: KnowledgeStatus;
  origin: KnowledgeOrigin;
  uncertaintyNote: string | null;
  sortOrder: number;
  lineageId: string;
  inheritedFromServicePeriod: string | null;
  proposalAction: KnowledgeProposalAction;
  proposalTargetId: string | null;
  captureId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeProvenance = {
  knowledgeItemId: string;
  sourceId: string;
  sourceTitle: string;
  sourceExcerpt: string | null;
  sourceLocator: string | null;
};

export type DocumentSourceInput = {
  organizationId: string;
  handoffId: string;
  kind: 'document';
  title: string;
  file: {
    uri: string;
    name: string;
    mimeType: string;
    size?: number | null;
  };
  captureId: string;
  capturePosition?: number;
};

export type SourceUploadResult =
  | { status: 'created'; sourceId: string }
  | { status: 'duplicate'; sourceId: string; title: string };

export type CaptureAttachmentInput = {
  uri: string;
  name: string;
  mimeType: string;
  size?: number | null;
  title: string;
};

export type DocumentDuplicateCheckInput = {
  organizationId: string;
  handoffId: string;
  file: {
    uri: string;
    name: string;
    size?: number | null;
  };
};

export type DocumentDuplicateCheckResult = {
  contentHash: string;
  duplicate: {
    sourceId: string;
    title: string;
  } | null;
};

export type CaptureInput = {
  captureId?: string | null;
  organizationId: string;
  handoffId: string;
  title: string;
  textContent?: string | null;
  promptId?: string | null;
  retainedAttachmentSourceIds: string[];
  attachments: CaptureAttachmentInput[];
};

export type CaptureSubmitResult = {
  captureId: string;
  duplicateTitles: string[];
};

export type CaptureDraftInput = {
  organizationId: string;
  handoffId: string;
  title: string;
  textContent?: string | null;
  promptId?: string | null;
};

export type GoogleDriveImportStart = {
  authUrl: string;
};

export type VoiceRecordingInput = {
  organizationId: string;
  handoffId: string;
  file: {
    uri: string;
    name: string;
    mimeType: string;
    size?: number | null;
  };
};

export type VoiceTranscriptPreview = {
  organizationId: string;
  handoffId: string;
  transcript: string;
  providerReference: string | null;
};

export type KnowledgeItemUpdateInput = {
  knowledgeType: KnowledgeType;
  title: string;
  content: string;
};

export type PreflightRunStatus = 'processing' | 'ready' | 'failed' | 'stale';
export type PreflightFindingType = 'missing' | 'ambiguous' | 'incomplete' | 'contradiction';
export type PreflightSeverity = 'critical' | 'optional';
export type PreflightFindingStatus = 'open' | 'resolved' | 'skipped' | 'unknown';

export type PreflightRun = {
  id: string;
  organizationId: string;
  handoffId: string;
  createdBy: string;
  status: PreflightRunStatus;
  failureReason: string | null;
  findingCount: number | null;
  criticalAcknowledgedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PreflightFinding = {
  id: string;
  runId: string;
  organizationId: string;
  handoffId: string;
  findingType: PreflightFindingType;
  severity: PreflightSeverity;
  title: string;
  question: string;
  explanation: string;
  suggestedKnowledgeType: KnowledgeType | null;
  primaryKnowledgeItemId: string | null;
  status: PreflightFindingStatus;
  resolutionKnowledgeItemId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PreflightEvidence = {
  id: string;
  findingId: string;
  runId: string;
  evidenceKind: 'knowledge' | 'source';
  knowledgeItemId: string | null;
  sourceId: string | null;
  label: string;
  excerpt: string;
  locator: string | null;
};

export type PreflightResolutionInput = {
  findingId: string;
  handoffId: string;
  knowledgeItemId?: string | null;
  knowledgeType: KnowledgeType;
  title: string;
  content: string;
};

export type PublishedHandoffItem = {
  id: string;
  knowledgeType: KnowledgeType;
  title: string;
  content: string;
  sortOrder: number;
};

export type HandoffPublication = {
  id: string;
  organizationId: string;
  handoffId: string;
  accessToken: string;
  status: 'active' | 'revoked';
  organizationName: string;
  organizationInstitution: string;
  roleTitle: string;
  roleDescription: string;
  servicePeriod: string;
  publishedAt: string;
  revokedAt: string | null;
};

export type SharedHandoff = {
  publicationId: string;
  organizationName: string;
  organizationInstitution: string;
  roleTitle: string;
  roleDescription: string;
  servicePeriod: string;
  publishedAt: string;
  items: PublishedHandoffItem[];
};

export type MemoryRole = {
  organizationId: string;
  organizationName: string;
  roleId: string;
  roleTitle: string;
  publishedHandoffCount: number;
  latestServicePeriod: string;
};

export type MemorySnapshot = {
  id: string;
  sourceKnowledgeItemId: string;
  knowledgeType: KnowledgeType;
  title: string;
  content: string;
  citationSources: { label: string; locator: string | null }[];
};

export type RoleMemoryComparison = {
  id: string;
  organizationId: string;
  roleId: string;
  previousPublicationId: string;
  currentPublicationId: string;
  previousServicePeriod: string;
  currentServicePeriod: string;
  status: 'processing' | 'ready' | 'failed';
  failureReason: string | null;
  materialChangeCount: number | null;
  completedAt: string | null;
};

export type MemoryReasonCategory =
  | 'policy_driven'
  | 'lesson_driven'
  | 'leadership_preference'
  | 'contact_resource'
  | 'unknown';

export type RoleMemoryChange = {
  id: string;
  comparisonId: string;
  changeType: 'added' | 'changed' | 'retired';
  title: string;
  summary: string;
  reasonCategory: MemoryReasonCategory;
  reasonExplanation: string;
  beforeSnapshot: MemorySnapshot | null;
  afterSnapshot: MemorySnapshot | null;
  supportingProvenance: { label: string; locator: string | null }[];
  humanConfirmed: boolean;
};

export type AskRelayCitation = {
  ref: string;
  title: string;
  knowledgeType: KnowledgeType;
  sources: { label: string; locator: string | null }[];
};

export type AskRelayAnswer = {
  status: 'answered' | 'unsupported' | 'conflict';
  answer: string;
  citations: AskRelayCitation[];
  remaining: number;
};
