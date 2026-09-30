import { describe, expect, it } from 'vitest';

import {
  normalizeMemoryClaimOutput,
  storedClaimsToEvidence,
  type ClaimSourceItem,
  type StoredMemoryClaim,
} from '../../../supabase/functions/_shared/organization-memory-claims';
import {
  createMemoryMatchingPlan,
  deterministicMemoryChanges,
  type PublicationMemoryItem,
} from '../../../supabase/functions/_shared/organization-memory';

function source(overrides: Partial<ClaimSourceItem> & Pick<ClaimSourceItem, 'id' | 'ref' | 'period' | 'publication_id'>): ClaimSourceItem {
  return {
    source_knowledge_item_id: `${overrides.id}-knowledge`,
    knowledge_lineage_id: `${overrides.id}-item-lineage`,
    knowledge_type: 'process',
    title: 'Operational requirement',
    content: 'Complete the requirement before the activity.',
    citation_sources: [{ label: `${overrides.period} approved guide`, locator: null }],
    ...overrides,
  };
}

describe('Organization Memory atomic claim indexing', () => {
  it('preserves one topic across renamed and split approved Knowledge Items', () => {
    const sources = [
      source({
        id: 'previous-item', ref: 'P1', period: 'previous', publication_id: 'previous-publication',
        title: 'Room limits and layout',
        content: 'The room holds 200 people. Put registration by the east entrance.',
      }),
      source({
        id: 'current-capacity', ref: 'C1', period: 'current', publication_id: 'current-publication',
        title: 'Attendance limit',
        content: 'The approved room limit is 160 people.',
      }),
      source({
        id: 'current-layout', ref: 'C2', period: 'current', publication_id: 'current-publication',
        title: 'Registration placement',
        content: 'Put registration by the north entrance.',
      }),
    ];
    const claims = normalizeMemoryClaimOutput({
      sources,
      publicationIds: { previous: 'previous-publication', current: 'current-publication' },
      priorTopics: [],
      value: {
        claims: [
          {
            publication: 'previous', topic_key: 'room.capacity', prior_topic_ref: null,
            knowledge_type: 'rule_deadline', title: 'Room capacity', content: 'The room holds 200 people.',
            comparison_value: 'maximum capacity 200 people', claim_state: 'active', source_refs: ['P1'],
          },
          {
            publication: 'current', topic_key: 'room.capacity', prior_topic_ref: null,
            knowledge_type: 'rule_deadline', title: 'Room capacity', content: 'The room holds 160 people.',
            comparison_value: 'maximum capacity 160 people', claim_state: 'active', source_refs: ['C1'],
          },
          {
            publication: 'previous', topic_key: 'room.registration_location', prior_topic_ref: null,
            knowledge_type: 'process', title: 'Registration location', content: 'Put registration by the east entrance.',
            comparison_value: 'registration at east entrance', claim_state: 'active', source_refs: ['P1'],
          },
          {
            publication: 'current', topic_key: 'room.registration_location', prior_topic_ref: null,
            knowledge_type: 'process', title: 'Registration location', content: 'Put registration by the north entrance.',
            comparison_value: 'registration at north entrance', claim_state: 'active', source_refs: ['C2'],
          },
        ],
      },
    });

    expect(claims).toHaveLength(4);
    expect(claims.filter((claim) => claim.topicKey === 'room.capacity')
      .map((claim) => claim.topicGroup)).toEqual(['pair:room.capacity', 'pair:room.capacity']);
    expect(claims.filter((claim) => claim.topicKey === 'room.registration_location')
      .map((claim) => claim.primaryPublicationItemId)).toEqual(['previous-item', 'current-layout']);
  });

  it('merges duplicate support for the same fact instead of producing duplicate Memory cards', () => {
    const sources = [
      source({ id: 'current-a', ref: 'C1', period: 'current', publication_id: 'current-publication' }),
      source({ id: 'current-b', ref: 'C2', period: 'current', publication_id: 'current-publication' }),
    ];
    const common = {
      publication: 'current', topic_key: 'approval.lead_time', prior_topic_ref: null,
      knowledge_type: 'rule_deadline', title: 'Approval lead time',
      content: 'Submit approval at least six weeks before the activity.',
      comparison_value: 'submit approval at least 6 weeks before activity', claim_state: 'active',
    };
    const claims = normalizeMemoryClaimOutput({
      sources,
      publicationIds: { previous: 'previous-publication', current: 'current-publication' },
      priorTopics: [],
      value: { claims: [{ ...common, source_refs: ['C1'] }, { ...common, source_refs: ['C2'] }] },
    });

    expect(claims).toHaveLength(1);
    expect(claims[0].sourcePublicationItemIds).toEqual(['current-a', 'current-b']);
    expect(claims[0].citationSources).toHaveLength(1);
  });

  it('persists a suppression marker when same-period approved sources conflict', () => {
    const sources = [
      source({ id: 'current-a', ref: 'C1', period: 'current', publication_id: 'current-publication' }),
      source({ id: 'current-b', ref: 'C2', period: 'current', publication_id: 'current-publication' }),
    ];
    const base = {
      publication: 'current', topic_key: 'submission.lead_time', prior_topic_ref: null,
      knowledge_type: 'rule_deadline', title: 'Submission lead time', claim_state: 'active',
    };
    const claims = normalizeMemoryClaimOutput({
      sources,
      publicationIds: { previous: 'previous-publication', current: 'current-publication' },
      priorTopics: [],
      value: { claims: [
        { ...base, content: 'Submit four weeks ahead.', comparison_value: '4 weeks before', source_refs: ['C1'] },
        { ...base, content: 'Submit six weeks ahead.', comparison_value: '6 weeks before', source_refs: ['C2'] },
      ] },
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      claimState: 'uncertain',
      sourcePublicationItemIds: ['current-a', 'current-b'],
    });
  });

  it('hides annual date rollovers when the indexed operational value is unchanged', () => {
    const publicationItems: PublicationMemoryItem[] = [
      {
        id: 'previous-item', source_knowledge_item_id: 'previous-knowledge', knowledge_lineage_id: null,
        knowledge_type: 'rule_deadline', title: 'Submission timing', content: 'Due February 20.', citation_sources: [],
      },
      {
        id: 'current-item', source_knowledge_item_id: 'current-knowledge', knowledge_lineage_id: null,
        knowledge_type: 'rule_deadline', title: 'Submission timing', content: 'Due February 18.', citation_sources: [],
      },
    ];
    const claims: StoredMemoryClaim[] = [
      {
        id: 'previous-claim', publication_id: 'previous-publication', topic_id: 'stable-topic',
        knowledge_type: 'rule_deadline', title: 'Submission lead time',
        content: 'Submit at least eight weeks before the activity.',
        comparison_value: 'submit at least 8 weeks before activity', claim_state: 'active',
        primary_publication_item_id: 'previous-item', source_publication_item_ids: ['previous-item'], citation_sources: [],
      },
      {
        id: 'current-claim', publication_id: 'current-publication', topic_id: 'stable-topic',
        knowledge_type: 'rule_deadline', title: 'Submission lead time',
        content: 'Submit at least eight weeks before the activity.',
        comparison_value: 'submit at least 8 weeks before activity', claim_state: 'active',
        primary_publication_item_id: 'current-item', source_publication_item_ids: ['current-item'], citation_sources: [],
      },
    ];
    const evidence = storedClaimsToEvidence({ claims, publicationItems, previousPublicationId: 'previous-publication' });
    const plan = createMemoryMatchingPlan(evidence);
    expect(deterministicMemoryChanges(new Map(evidence.map((item) => [item.ref, item])), plan)).toEqual([]);
  });

  it('omits both sides of a topic marked uncertain', () => {
    const publicationItems: PublicationMemoryItem[] = [
      {
        id: 'previous-item', source_knowledge_item_id: 'previous-knowledge', knowledge_lineage_id: null,
        knowledge_type: 'rule_deadline', title: 'Submission lead time', content: 'Submit four weeks ahead.', citation_sources: [],
      },
      {
        id: 'current-item', source_knowledge_item_id: 'current-knowledge', knowledge_lineage_id: null,
        knowledge_type: 'rule_deadline', title: 'Submission lead time', content: 'Current sources conflict.', citation_sources: [],
      },
    ];
    const claims: StoredMemoryClaim[] = [
      {
        id: 'previous-claim', publication_id: 'previous-publication', topic_id: 'timing-topic',
        knowledge_type: 'rule_deadline', title: 'Submission lead time', content: 'Submit four weeks ahead.',
        comparison_value: '4 weeks before', claim_state: 'active', primary_publication_item_id: 'previous-item',
        source_publication_item_ids: ['previous-item'], citation_sources: [],
      },
      {
        id: 'current-claim', publication_id: 'current-publication', topic_id: 'timing-topic',
        knowledge_type: 'rule_deadline', title: 'Submission lead time', content: 'Current sources conflict.',
        comparison_value: 'uncertain', claim_state: 'uncertain', primary_publication_item_id: 'current-item',
        source_publication_item_ids: ['current-item'], citation_sources: [],
      },
    ];
    expect(storedClaimsToEvidence({
      claims, publicationItems, previousPublicationId: 'previous-publication',
    })).toEqual([]);
  });

  it('deterministically returns Changed and Added from claim lineage without a comparison-model response', () => {
    const publicationItems: PublicationMemoryItem[] = [
      {
        id: 'previous-item', source_knowledge_item_id: 'previous-knowledge', knowledge_lineage_id: null,
        knowledge_type: 'rule_deadline', title: 'Operating limit', content: 'The limit is 200.', citation_sources: [],
      },
      {
        id: 'current-item', source_knowledge_item_id: 'current-knowledge', knowledge_lineage_id: null,
        knowledge_type: 'rule_deadline', title: 'Operating limit', content: 'The limit is 160.', citation_sources: [],
      },
      {
        id: 'new-item', source_knowledge_item_id: 'new-knowledge', knowledge_lineage_id: null,
        knowledge_type: 'process', title: 'New approval', content: 'Obtain approval first.', citation_sources: [],
      },
    ];
    const claims: StoredMemoryClaim[] = [
      {
        id: 'previous-claim', publication_id: 'previous-publication', topic_id: 'limit-topic',
        knowledge_type: 'rule_deadline', title: 'Operating limit', content: 'The limit is 200.',
        comparison_value: 'maximum 200', claim_state: 'active', primary_publication_item_id: 'previous-item',
        source_publication_item_ids: ['previous-item'], citation_sources: [],
      },
      {
        id: 'current-claim', publication_id: 'current-publication', topic_id: 'limit-topic',
        knowledge_type: 'rule_deadline', title: 'Operating limit', content: 'The limit is 160.',
        comparison_value: 'maximum 160', claim_state: 'active', primary_publication_item_id: 'current-item',
        source_publication_item_ids: ['current-item'], citation_sources: [],
      },
      {
        id: 'new-claim', publication_id: 'current-publication', topic_id: 'new-topic',
        knowledge_type: 'process', title: 'New approval', content: 'Obtain approval first.',
        comparison_value: 'obtain approval before proceeding', claim_state: 'active', primary_publication_item_id: 'new-item',
        source_publication_item_ids: ['new-item'], citation_sources: [],
      },
    ];
    const evidence = storedClaimsToEvidence({ claims, publicationItems, previousPublicationId: 'previous-publication' });
    const plan = createMemoryMatchingPlan(evidence);
    const changes = deterministicMemoryChanges(new Map(evidence.map((item) => [item.ref, item])), plan);
    expect(changes.map((change) => change.changeType)).toEqual(['changed', 'added']);
  });
});
