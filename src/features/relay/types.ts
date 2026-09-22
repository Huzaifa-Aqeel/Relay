export type Organization = {
  id: string;
  createdBy: string;
  name: string;
  institution: string;
  description: string;
  logoPath: string | null;
  logoUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationPlan = {
  organizationId: string;
  plan: 'free' | 'pro';
  expiresAt: string | null;
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
  'responsibility',
  'deadline',
  'contact',
  'process',
  'warning',
  'resource',
  'lesson',
] as const;

export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];
export type SourceKind = 'typed_text' | 'voice' | 'document';
export type SourceProcessingStatus = 'processing' | 'ready' | 'failed';
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
  normalizedFilename: string | null;
  contentHash: string | null;
  supersedesSourceId: string | null;
  sourceRootId: string | null;
  versionNumber: number;
  isCurrent: boolean;
  versionMatchBasis: 'filename_and_type' | 'human_confirmed' | null;
  deltaStatus: 'not_applicable' | 'pending' | 'processing' | 'ready' | 'failed';
  deltaFailureReason: string | null;
  deltaChangeCount: number | null;
  deltaAnalyzedAt: string | null;
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

export type TypedSourceInput = {
  organizationId: string;
  handoffId: string;
  title: string;
  textContent: string;
};

export type SourceFileInput = {
  organizationId: string;
  handoffId: string;
  kind: 'voice' | 'document';
  title: string;
  file: {
    uri: string;
    name: string;
    mimeType: string;
    size?: number | null;
  };
  versionDecision?: 'new_version' | 'separate';
  supersedesSourceId?: string | null;
};

export type SourceUploadResult =
  | { status: 'created'; sourceId: string }
  | { status: 'duplicate'; sourceId: string; title: string }
  | { status: 'confirmation_required'; sourceId: string; title: string };

export type SourceVersionChange = {
  id: string;
  sourceId: string;
  priorSourceId: string;
  changeType: 'added' | 'changed' | 'removed';
  title: string;
  summary: string;
  oldExcerpt: string | null;
  newExcerpt: string | null;
  affectedKnowledgeItemId: string | null;
  proposalItemId: string | null;
};

export type SourceTextInput = {
  id: string;
  handoffId: string;
  title: string;
  textContent: string;
};

export type KnowledgeItemInput = {
  organizationId: string;
  handoffId: string;
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
  citationSources: Array<{ label: string; locator: string | null }>;
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
  matchBasis: 'same_lineage' | 'strong_semantic' | 'not_applicable';
  reasonCategory: MemoryReasonCategory;
  reasonExplanation: string;
  reasonEvidence: string[];
  beforeSnapshot: MemorySnapshot | null;
  afterSnapshot: MemorySnapshot | null;
  supportingProvenance: Array<{ label: string; locator: string | null }>;
  humanConfirmed: boolean;
};

export type AskRelayCitation = {
  ref: string;
  title: string;
  knowledgeType: KnowledgeType;
  sources: Array<{ label: string; locator: string | null }>;
};

export type AskRelayAnswer = {
  status: 'answered' | 'unsupported';
  answer: string;
  citations: AskRelayCitation[];
  remaining: number;
};
