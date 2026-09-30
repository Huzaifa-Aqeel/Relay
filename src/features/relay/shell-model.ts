export const HANDOFF_STAGES = ['Capture', 'Review', 'Preview', 'Published'] as const;

export function handoffStageIndex(stage: string) {
  return Math.max(0, HANDOFF_STAGES.findIndex((label) => label.toLowerCase() === stage));
}

export function captureReviewSummary({
  structuredProposalCount,
  pendingProposalCount,
  droppedCount,
}: {
  structuredProposalCount: number | null;
  pendingProposalCount: number;
  droppedCount?: number | null;
}) {
  const droppedNote = droppedCount
    ? ` — ${droppedCount} ${droppedCount === 1 ? 'suggestion matched' : 'suggestions matched'} what you already have.`
    : '';
  if (pendingProposalCount > 0) {
    return `${pendingProposalCount} ${pendingProposalCount === 1 ? 'thing' : 'things'} to review${droppedNote}`;
  }
  if (structuredProposalCount === 0) return `Checked · no new or changed handoff knowledge found${droppedNote}`;
  return droppedNote ? droppedNote.replace(/^ — /, '') : null;
}

export function isPublicRootSegment(segment: string | undefined) {
  return segment === 'shared' || segment === 'legal' || segment === 'assignment';
}
