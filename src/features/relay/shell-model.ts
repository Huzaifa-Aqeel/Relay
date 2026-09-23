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

export function isPublicRootSegment(segment: string | undefined) {
  return segment === 'shared' || segment === 'legal' || segment === 'assignment' || segment === 'drive-import';
}
