export const HANDOFF_STAGES = ['Capture', 'Review', 'Handoff check', 'Preview', 'Published'] as const;

export function handoffStageIndex(stage: string) {
  const normalized = stage === 'preflight' ? 'handoff check' : stage;
  return Math.max(0, HANDOFF_STAGES.findIndex((label) => label.toLowerCase() === normalized));
}

export function shouldRunHandoffCheck({
  stage,
  proposalCount,
  approvedCount,
  hasRun,
  attempted,
}: {
  stage: string;
  proposalCount: number;
  approvedCount: number;
  hasRun: boolean;
  attempted: boolean;
}) {
  return stage === 'review' && proposalCount === 0 && approvedCount > 0 && !hasRun && !attempted;
}

export function captureReviewSummary({
  structuredProposalCount,
  pendingProposalCount,
}: {
  structuredProposalCount: number | null;
  pendingProposalCount: number;
}) {
  if (pendingProposalCount > 0) {
    return `${pendingProposalCount} ${pendingProposalCount === 1 ? 'thing' : 'things'} to review`;
  }
  return structuredProposalCount === 0 ? 'Checked · nothing new found' : null;
}

export function isPublicRootSegment(segment: string | undefined) {
  return segment === 'shared' || segment === 'legal' || segment === 'assignment' || segment === 'drive-import';
}
