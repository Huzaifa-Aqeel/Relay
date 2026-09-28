import type { MemorySnapshot, RoleMemoryChange } from './types';

export const NO_MATERIAL_MEMORY_CHANGES = 'No material changes were found between these published handoffs.';

export type OrganizationMemoryCardModel = {
  changeType: RoleMemoryChange['changeType'];
  title: string;
  before: MemorySnapshot | null;
  after: MemorySnapshot | null;
  reasonText: string;
  sources: { label: string; locator: string | null }[];
};

/** The complete normal-UI contract; matching/debug metadata is intentionally absent. */
export function organizationMemoryCardModel(
  change: RoleMemoryChange,
  periods: { previous: string; current: string },
): OrganizationMemoryCardModel {
  const sources = change.supportingProvenance.length
    ? change.supportingProvenance
    : [
      ...(change.beforeSnapshot ? [{ label: `Published handoff · ${periods.previous}`, locator: null }] : []),
      ...(change.afterSnapshot ? [{ label: `Published handoff · ${periods.current}`, locator: null }] : []),
    ];
  return {
    changeType: change.changeType,
    title: change.title,
    before: change.beforeSnapshot,
    after: change.afterSnapshot,
    reasonText: change.reasonStatement ? `Reason: ${change.reasonStatement}` : 'Reason not documented.',
    sources,
  };
}
