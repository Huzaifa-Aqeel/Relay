export const HANDOFF_STAGES = ['Capture', 'Review', 'Preflight', 'Preview', 'Published'] as const;

export function isPublicRootSegment(segment: string | undefined) {
  return segment === 'shared' || segment === 'legal' || segment === 'assignment';
}
