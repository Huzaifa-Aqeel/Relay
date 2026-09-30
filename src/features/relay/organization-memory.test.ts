import { describe, expect, it } from 'vitest';

import {
  createMemoryMatchingPlan,
  groundedMemoryReason,
  isGenericResourceScopeChange,
  isClearlyEquivalentMemoryContent,
  isMemoryScope,
  isRoutineAnnualInstanceChange,
  materialMemoryPairPlan,
  memoryCandidatePrompt,
  memoryCandidates,
  organizationMemorySchema,
  validateMemoryChanges,
  type MemoryEvidenceItem,
} from '../../../supabase/functions/_shared/organization-memory';
import {
  NO_MATERIAL_MEMORY_CHANGES,
  NO_VERIFIED_MEMORY_REASON,
  organizationMemoryCardModel,
} from './organization-memory-display';

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

function modelDecision(overrides: Record<string, unknown> = {}) {
  return {
    candidate_id: 'K1',
    include: true,
    change_type: 'changed',
    reason_statement: null,
    reason_support_ref: null,
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
    const changes = validateMemoryChanges({ results: [modelDecision()] }, new Map(items.map((item) => [item.ref, item])), plan);
    expect(changes[0]).toMatchObject({ changeType: 'changed', matchBasis: 'same_lineage' });
  });

  it('classifies a new lineage as Added', () => {
    const item = evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: 'new-lineage' });
    const plan = createMemoryMatchingPlan([item]);
    expect(plan.addedRefs).toEqual(['C1']);
    const changes = validateMemoryChanges({
      results: [modelDecision({ change_type: 'added' })],
    }, new Map([[item.ref, item]]), plan);
    expect(changes[0].changeType).toBe('added');
  });

  it('omits a prior lineage missing from the current handoff', () => {
    const item = evidence({ ref: 'P1', period: 'previous', knowledge_lineage_id: 'retired-lineage' });
    const plan = createMemoryMatchingPlan([item]);
    expect(plan.addedRefs).toEqual([]);
    expect(plan.pairs).toEqual([]);
    expect(plan.omittedRefs).toEqual(['P1']);
    expect(memoryCandidates(plan)).toEqual([]);
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

  it('hides a routine corresponding-year calendar rollover', () => {
    const before = evidence({
      ref: 'P1', period: 'previous', title: 'Annual rehearsal date',
      content: 'Hold the rehearsal on April 12, 2028.',
      comparison_value: 'Hold the rehearsal on April 12, 2028.',
    });
    const after = evidence({
      ref: 'C1', period: 'current', title: 'Annual rehearsal date',
      content: 'Hold the rehearsal on April 11, 2029.',
      comparison_value: 'Hold the rehearsal on April 11, 2029.',
    });
    expect(isRoutineAnnualInstanceChange(before, after)).toBe(true);
    const evidenceByRef = new Map([before, after].map((item) => [item.ref, item]));
    const plan = createMemoryMatchingPlan([before, after]);
    expect(materialMemoryPairPlan(plan, evidenceByRef).pairs).toEqual([]);
  });

  it('keeps an explicitly documented scheduling change', () => {
    const before = evidence({
      ref: 'P1', period: 'previous', title: 'Annual activity date',
      content: 'The activity is scheduled for April 12, 2028.',
    });
    const after = evidence({
      ref: 'C1', period: 'current', title: 'Annual activity date',
      content: 'The activity moved to April 8, 2029 because examinations begin April 10.',
    });
    expect(isRoutineAnnualInstanceChange(before, after)).toBe(false);
  });

  it('hides a generic resource-scope restatement', () => {
    const before = evidence({
      ref: 'P1', period: 'previous', knowledge_type: 'access_resource',
      title: 'Operations guide scope',
      content: 'Use the operations guide to control safety and accessibility requirements.',
    });
    const after = evidence({
      ref: 'C1', period: 'current', knowledge_type: 'access_resource',
      title: 'Operations guide scope',
      content: 'Use the operations guide to control safety, accessibility, and insurance requirements.',
    });
    expect(isGenericResourceScopeChange(before, after)).toBe(true);
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
    expect(currentPlan.addedRefs).toEqual(['C1']);
    expect(currentPlan.omittedRefs).toContain('P1');
  });

  it('does not force Changed when legacy semantic continuity is uncertain', () => {
    const items = [
      evidence({ ref: 'P1', period: 'previous', knowledge_lineage_id: null, title: 'Reserve event venue', content: 'Reserve the main event venue with Facilities.' }),
      evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: null, title: 'Reserve event venue', content: 'Reserve the main event venue with the campus office.' }),
      evidence({ ref: 'C2', period: 'current', knowledge_lineage_id: null, title: 'Reserve event venue', content: 'Reserve the main event venue with the scheduling office.' }),
    ];
    const plan = createMemoryMatchingPlan(items);
    expect(plan.pairs).toEqual([]);
    expect(plan.addedRefs).toEqual(['C1', 'C2']);
    expect(plan.omittedRefs).toEqual(['P1']);
  });

  it('omits an unmatched previous snapshot with missing lineage', () => {
    const plan = createMemoryMatchingPlan([
      evidence({ ref: 'P1', period: 'previous', knowledge_lineage_id: null, title: 'Legacy note' }),
    ]);
    expect(plan.addedRefs).toEqual([]);
    expect(plan.omittedRefs).toEqual(['P1']);
  });

  it('keeps an unmatched missing-lineage snapshot eligible as Added', () => {
    const plan = createMemoryMatchingPlan([
      evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: null, title: 'Imported operational note' }),
    ]);
    expect(plan.addedRefs).toEqual(['C1']);
    expect(plan.omittedRefs).toEqual([]);
  });

  it('keeps unfinished obligations eligible for the normal lineage comparison', () => {
    const plan = createMemoryMatchingPlan([
      evidence({
        ref: 'P1', period: 'previous', knowledge_lineage_id: 'pending-obligation',
        title: 'Confirm pending venue booking',
        content: 'Confirm the pending venue booking by September 12.',
      }),
      evidence({
        ref: 'C1', period: 'current', knowledge_lineage_id: 'pending-obligation',
        title: 'Confirm pending venue booking',
        content: 'Confirm the pending venue booking by September 5.',
      }),
    ]);
    expect(plan.pairs).toEqual([
      { beforeRef: 'P1', afterRef: 'C1', basis: 'same_lineage' },
    ]);
    expect(memoryCandidates(plan)).toEqual([{
      id: 'K1', type: 'changed', beforeRef: 'P1', afterRef: 'C1', basis: 'same_lineage',
    }]);
    expect(memoryCandidatePrompt(plan)).toContain('[K1]\nType: CHANGED_CANDIDATE');
  });

  it('requires one explicit include or exclude decision for every candidate', () => {
    const items = [
      evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: 'current-only' }),
      evidence({ ref: 'C2', period: 'current', knowledge_lineage_id: 'another-current-only' }),
    ];
    const plan = createMemoryMatchingPlan(items);
    expect(() => validateMemoryChanges({
      results: [modelDecision({ candidate_id: 'K1', change_type: 'added' })],
    }, new Map(items.map((item) => [item.ref, item])), plan)).toThrow('Incomplete handoff comparison.');
  });

  it('honors include=false without generating a Memory change', () => {
    const item = evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: 'current-only' });
    const plan = createMemoryMatchingPlan([item]);
    expect(validateMemoryChanges({
      results: [modelDecision({
        include: false, change_type: null, reason_statement: null, reason_support_ref: null,
      })],
    }, new Map([[item.ref, item]]), plan)).toEqual([]);
  });

  it('does not let an Added candidate become another change type', () => {
    const item = evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: 'current-only' });
    const plan = createMemoryMatchingPlan([item]);
    expect(() => validateMemoryChanges({
      results: [modelDecision({ change_type: 'changed' })],
    }, new Map([[item.ref, item]]), plan)).toThrow('Added candidate has an invalid classification.');
  });

  it('uses the candidate-result JSON contract', () => {
    expect(organizationMemorySchema.required).toEqual(['results']);
    expect(organizationMemorySchema.properties.results.items.required).toEqual([
      'candidate_id', 'include', 'change_type', 'reason_statement', 'reason_support_ref',
    ]);
  });

  it('keeps an unmatched current fact as Added and omits the previous-only fact', () => {
    const items = [
      evidence({
        ref: 'P1', period: 'previous', knowledge_lineage_id: 'previous-lineage',
        title: 'Venue operating procedure', content: 'Use the east entrance for vendor load-in.',
      }),
      evidence({
        ref: 'C1', period: 'current', knowledge_lineage_id: 'current-lineage',
        title: 'Vendor entrance instructions', content: 'Use the north entrance for vendor load-in.',
      }),
    ];
    const plan = createMemoryMatchingPlan(items);
    const changes = validateMemoryChanges({
      results: [modelDecision({ candidate_id: 'K1', change_type: 'added' })],
    }, new Map(items.map((item) => [item.ref, item])), plan);

    expect(changes.map((change) => change.changeType)).toEqual(['added']);
    expect(plan.omittedRefs).toContain('P1');
    expect(changes.some((change) => change.changeType === 'changed')).toBe(false);
  });

  it('uses Retired only when current approved evidence explicitly retires a same-lineage practice', () => {
    const items = [
      evidence({ ref: 'P1', period: 'previous', content: 'Submit the paper form to the office.' }),
      evidence({ ref: 'C1', period: 'current', content: 'The paper form is no longer accepted; use the online portal.' }),
    ];
    const plan = createMemoryMatchingPlan(items);
    const changes = validateMemoryChanges({
      results: [modelDecision({ change_type: 'retired' })],
    }, new Map(items.map((item) => [item.ref, item])), plan);
    expect(changes[0].changeType).toBe('retired');
  });

  it('downgrades unsupported Retired to Changed', () => {
    const items = [
      evidence({ ref: 'P1', period: 'previous', content: 'Submit the form within 30 days.' }),
      evidence({ ref: 'C1', period: 'current', content: 'Submit the form within 10 days.' }),
    ];
    const plan = createMemoryMatchingPlan(items);
    const changes = validateMemoryChanges({
      results: [modelDecision({ change_type: 'retired' })],
    }, new Map(items.map((item) => [item.ref, item])), plan);
    expect(changes[0].changeType).toBe('changed');
  });

  it('shows a pending obligation as Resolved only with explicit current closure', () => {
    const items = [
      evidence({ ref: 'P1', period: 'previous', content: 'The venue approval remains pending.' }),
      evidence({ ref: 'C1', period: 'current', content: 'The venue approval was approved and closed.' }),
    ];
    const plan = createMemoryMatchingPlan(items);
    const changes = validateMemoryChanges({
      results: [modelDecision({ change_type: 'resolved' })],
    }, new Map(items.map((item) => [item.ref, item])), plan);
    expect(changes[0].changeType).toBe('resolved');
  });

  it('never mutates publication lineage while planning or validating', () => {
    const items = [
      evidence({ ref: 'P1', period: 'previous', knowledge_lineage_id: 'stable-lineage', content: 'File within 30 days.' }),
      evidence({ ref: 'C1', period: 'current', knowledge_lineage_id: 'stable-lineage', content: 'File within 10 days.' }),
    ];
    const original = structuredClone(items);
    const plan = createMemoryMatchingPlan(items);
    validateMemoryChanges({ results: [modelDecision()] }, new Map(items.map((item) => [item.ref, item])), plan);
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

  it('accepts the prompt example when a faithful paraphrase shares the explicit causal clause', () => {
    const item = evidence({
      ref: 'C1',
      period: 'current',
      content: 'The planning window increased to 16 weeks because university examinations begin April 16.',
    });
    const result = groundedMemoryReason(
      'Campus scheduling required the event to occur before the examination period.',
      'C1',
      new Map([[item.ref, item]]),
      [item],
    );
    expect(result.statement).toBe('Campus scheduling required the event to occur before the examination period.');
  });

  it('falls back to the approved causal clause when a model paraphrase introduces unsupported wording', () => {
    const item = evidence({
      ref: 'C1',
      period: 'current',
      content: 'The planning window increased to 16 weeks because university examinations begin April 16.',
    });
    const result = groundedMemoryReason(
      'A new government policy forced the schedule change.',
      'C1',
      new Map([[item.ref, item]]),
      [item],
    );
    expect(result.statement).toBe('Because university examinations begin April 16.');
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
      reasonProvenance: [],
    }, { previous: 'Period A', current: 'Period B' });
    expect(Object.keys(card).sort()).toEqual([
      'after', 'afterSources', 'before', 'beforeSources', 'changeType', 'reasonSources', 'reasonText', 'title',
    ]);
    expect(card.reasonText).toBe(NO_VERIFIED_MEMORY_REASON);
    expect(NO_VERIFIED_MEMORY_REASON).toBe('No explicit reason was verified in the published handoffs.');
    expect(NO_MATERIAL_MEMORY_CHANGES).toBe('No material changes were found between these published handoffs.');
  });
});
