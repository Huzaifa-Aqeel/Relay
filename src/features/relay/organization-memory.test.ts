import { describe, expect, it } from 'vitest';

import {
  createMemoryMatchingPlan,
  groundedMemoryReason,
  isClearlyEquivalentMemoryContent,
  isMemoryScope,
  validateMemoryChanges,
  type MemoryEvidenceItem,
} from '../../../supabase/functions/_shared/organization-memory';
import { NO_MATERIAL_MEMORY_CHANGES, organizationMemoryCardModel } from './organization-memory-display';

function evidence(overrides: Partial<MemoryEvidenceItem> & Pick<MemoryEvidenceItem, 'ref' | 'period'>): MemoryEvidenceItem {
  return {
    id: `${overrides.ref}-item`,
    source_knowledge_item_id: `${overrides.ref}-knowledge`,
    knowledge_lineage_id: 'lineage-1',
    knowledge_type: 'process',
    title: 'Annual filing',
    content: 'Submit the annual filing by Friday.',
    citation_sources: [{ label: 'Published guide', locator: 'Page 2' }],
    ...overrides,
  };
}

function modelChange(overrides: Record<string, unknown> = {}) {
  return {
    change_type: 'changed',
    previous_ref: 'P1',
    current_ref: 'C1',
    reason_statement: null,
    reason_evidence_ref: null,
    ...overrides,
  };
}

describe('Organization Memory lineage-first matching', () => {
  it('hides an unchanged same-lineage item', () => {
    const plan = createMemoryMatchingPlan([
      evidence({ ref: 'P1', period: 'previous' }),
      evidence({ ref: 'C1', period: 'current' }),
    ]);
    expect(plan.pairs).toEqual([]);
    expect(plan.omittedRefs).toEqual(expect.arrayContaining(['P1', 'C1']));
  });

  it('makes a same-lineage material edit eligible only as Changed', () => {
    const items = [
      evidence({ ref: 'P1', period: 'previous', content: 'Submit the annual filing 30 days before the event.' }),
      evidence({ ref: 'C1', period: 'current', content: 'Submit the annual filing 10 days before the event.' }),
    ];
    const plan = createMemoryMatchingPlan(items);
    expect(plan.pairs).toEqual([{ beforeRef: 'P1', afterRef: 'C1', basis: 'same_lineage' }]);
    const changes = validateMemoryChanges({ changes: [modelChange()] }, new Map(items.map((item) => [item.ref, item])), plan);
    expect(changes[0]).toMatchObject({ changeType: 'changed', matchBasis: 'same_lineage' });
  });

  it('classifies a new lineage as Added', () => {
    const item = evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: 'new-lineage' });
    const plan = createMemoryMatchingPlan([item]);
    expect(plan.addedRefs).toEqual(['C1']);
    const changes = validateMemoryChanges({
      changes: [modelChange({ change_type: 'added', previous_ref: null })],
    }, new Map([[item.ref, item]]), plan);
    expect(changes[0].changeType).toBe('added');
  });

  it('classifies a prior lineage missing from current truth as Retired', () => {
    const item = evidence({ ref: 'P1', period: 'previous', knowledge_lineage_id: 'retired-lineage' });
    const plan = createMemoryMatchingPlan([item]);
    expect(plan.retiredRefs).toEqual(['P1']);
    const changes = validateMemoryChanges({
      changes: [modelChange({ change_type: 'retired', current_ref: null })],
    }, new Map([[item.ref, item]]), plan);
    expect(changes[0].changeType).toBe('retired');
  });

  it('hides wording-only rewrites', () => {
    expect(isClearlyEquivalentMemoryContent(
      { content: 'Submit the report by Friday.' },
      { content: 'The report must be submitted by Friday.' },
    )).toBe(true);
  });

  it('hides punctuation, formatting, and reordered text', () => {
    expect(isClearlyEquivalentMemoryContent(
      { content: 'Keys, badges, and forms.' },
      { content: 'Forms\nkeys; badges!' },
    )).toBe(true);
  });

  it('uses semantic fallback only when both publication items lack lineage', () => {
    const legacy = [
      evidence({
        ref: 'P1', period: 'previous', knowledge_lineage_id: null,
        title: 'Annual registration deadline',
        content: 'Complete annual registration through the portal by September 10.',
      }),
      evidence({
        ref: 'C1', period: 'current', knowledge_lineage_id: null,
        title: 'Annual registration deadline',
        content: 'Complete annual registration through the portal by August 25.',
      }),
    ];
    expect(createMemoryMatchingPlan(legacy).pairs).toEqual([
      { beforeRef: 'P1', afterRef: 'C1', basis: 'strong_semantic' },
    ]);

    const currentData = legacy.map((item, index) => ({ ...item, knowledge_lineage_id: `lineage-${index}` }));
    const currentPlan = createMemoryMatchingPlan(currentData);
    expect(currentPlan.pairs).toEqual([]);
    expect(currentPlan.retiredRefs).toEqual(['P1']);
    expect(currentPlan.addedRefs).toEqual(['C1']);
  });

  it('omits uncertain legacy semantic candidates instead of forcing a relationship', () => {
    const items = [
      evidence({ ref: 'P1', period: 'previous', knowledge_lineage_id: null, title: 'Reserve event venue', content: 'Reserve the main event venue with Facilities.' }),
      evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: null, title: 'Reserve event venue', content: 'Reserve the main event venue with the campus office.' }),
      evidence({ ref: 'C2', period: 'current', knowledge_lineage_id: null, title: 'Reserve event venue', content: 'Reserve the main event venue with the scheduling office.' }),
    ];
    const plan = createMemoryMatchingPlan(items);
    expect(plan.pairs).toEqual([]);
    expect(plan.addedRefs).toEqual([]);
    expect(plan.retiredRefs).toEqual([]);
    expect(plan.omittedRefs).toEqual(expect.arrayContaining(['P1', 'C1', 'C2']));
  });

  it('does not guess Added or Retired for an unmatched missing-lineage snapshot', () => {
    const plan = createMemoryMatchingPlan([
      evidence({ ref: 'P1', period: 'previous', knowledge_lineage_id: null, title: 'Legacy note' }),
    ]);
    expect(plan.addedRefs).toEqual([]);
    expect(plan.retiredRefs).toEqual([]);
    expect(plan.omittedRefs).toEqual(['P1']);
  });

  it('never mutates publication lineage while planning or validating', () => {
    const items = [
      evidence({ ref: 'P1', period: 'previous', knowledge_lineage_id: 'stable-lineage', content: 'File within 30 days.' }),
      evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: 'stable-lineage', content: 'File within 10 days.' }),
    ];
    const original = structuredClone(items);
    const plan = createMemoryMatchingPlan(items);
    validateMemoryChanges({ changes: [modelChange()] }, new Map(items.map((item) => [item.ref, item])), plan);
    expect(items).toEqual(original);
  });
});

describe('Organization Memory scope and reasons', () => {
  it('accepts only the same Organization and Role scope', () => {
    const scope = { organizationId: 'organization-a', roleId: 'role-a' };
    expect(isMemoryScope({ organization_id: 'organization-a', role_id: 'role-a' }, scope)).toBe(true);
    expect(isMemoryScope({ organization_id: 'organization-a', role_id: 'role-b' }, scope)).toBe(false);
    expect(isMemoryScope({ organization_id: 'organization-b', role_id: 'role-a' }, scope)).toBe(false);
  });

  it('allows an explicit evidence-backed reason', () => {
    const item = evidence({
      ref: 'C1',
      period: 'current',
      content: 'The filing window is 10 days because the governing policy shortened the deadline.',
    });
    const result = groundedMemoryReason(
      'The governing policy shortened the filing deadline.',
      'C1',
      new Map([[item.ref, item]]),
    );
    expect(result.statement).toBe('The governing policy shortened the filing deadline.');
    expect(result.evidence?.ref).toBe('C1');
  });

  it('turns an unsupported proposed reason into not documented', () => {
    const item = evidence({ ref: 'C1', period: 'current', content: 'The filing window is 10 days.' });
    expect(groundedMemoryReason('Leadership wanted a faster process.', 'C1', new Map([[item.ref, item]]))).toEqual({
      statement: null,
      evidence: null,
    });
  });

  it('rejects explicit causal evidence about an unrelated published item', () => {
    const before = evidence({ ref: 'P1', period: 'previous', content: 'Submit the annual filing within 30 days.' });
    const after = evidence({ ref: 'C1', period: 'current', content: 'Submit the annual filing within 10 days.' });
    const unrelated = evidence({
      ref: 'C2',
      period: 'current',
      knowledge_lineage_id: 'lineage-2',
      title: 'Equipment booking',
      content: 'Book replacement equipment because the old projector failed.',
    });
    expect(groundedMemoryReason(
      'The old projector failure required replacement equipment.',
      'C2',
      new Map([before, after, unrelated].map((item) => [item.ref, item])),
      [before, after],
    )).toEqual({ statement: null, evidence: null });
  });

  it('never treats chronology alone as a reason', () => {
    const item = evidence({ ref: 'C1', period: 'current', content: 'After the next service period began, the filing window became 10 days.' });
    expect(groundedMemoryReason('The new service period caused the deadline change.', 'C1', new Map([[item.ref, item]]))).toEqual({
      statement: null,
      evidence: null,
    });
  });

  it('does not expose matching or confidence metadata in the normal UI', () => {
    const card = organizationMemoryCardModel({
      id: 'change-1',
      comparisonId: 'comparison-1',
      changeType: 'changed',
      title: 'Annual filing',
      summary: 'Internal summary',
      reasonStatement: null,
      beforeSnapshot: null,
      afterSnapshot: null,
      supportingProvenance: [],
    }, { previous: 'Period A', current: 'Period B' });
    expect(Object.keys(card).sort()).toEqual(['after', 'before', 'changeType', 'reasonText', 'sources', 'title']);
    expect(card.reasonText).toBe('Reason not documented.');
    expect(NO_MATERIAL_MEMORY_CHANGES).toBe('No material changes were found between these published handoffs.');
  });
});
