import type { MemorySnapshot, RoleMemoryChange } from './types';

export const NO_MATERIAL_MEMORY_CHANGES = 'No material changes were found between these published handoffs.';
export const NO_VERIFIED_MEMORY_REASON = 'No explicit reason was verified in the published handoffs.';

export type OrganizationMemoryCardModel = {
  changeType: RoleMemoryChange['changeType'];
  title: string;
  before: MemorySnapshot | null;
  after: MemorySnapshot | null;
  reasonText: string;
  beforeSources: { label: string; locator: string | null }[];
  afterSources: { label: string; locator: string | null }[];
  reasonSources: { label: string; locator: string | null }[];
};

/** The complete normal-UI contract; matching/debug metadata is intentionally absent. */
export function organizationMemoryCardModel(
  change: RoleMemoryChange,
  periods: { previous: string; current: string },
): OrganizationMemoryCardModel {
  const beforeSources = change.beforeSnapshot?.citationSources.length
    ? change.beforeSnapshot.citationSources
    : change.beforeSnapshot ? [{ label: `Published handoff · ${periods.previous}`, locator: null }] : [];
  const afterSources = change.afterSnapshot?.citationSources.length
    ? change.afterSnapshot.citationSources
    : change.afterSnapshot ? [{ label: `Published handoff · ${periods.current}`, locator: null }] : [];
  return {
    changeType: change.changeType,
    title: change.title,
    before: change.beforeSnapshot,
    after: change.afterSnapshot,
    reasonText: change.reasonStatement ? `Reason: ${change.reasonStatement}` : NO_VERIFIED_MEMORY_REASON,
    beforeSources,
    afterSources,
    reasonSources: change.reasonProvenance,
  };
}
