import { describe, expect, it } from 'vitest';

import {
  BM25F_PARAMETERS,
  meaningfulQueryTerms,
  normalizeModelAnswer,
  rankPublicationItemsHybrid,
  rankPublicationItems,
  RRF_K,
  selectEvidence,
  UNSUPPORTED_ANSWER,
  type PublicationItem,
} from '../../../supabase/functions/_shared/ask-relay-logic';

function item(overrides: Partial<PublicationItem> & Pick<PublicationItem, 'id' | 'title' | 'content'>): PublicationItem {
  return {
    source_knowledge_item_id: `${overrides.id}-knowledge`,
    knowledge_type: 'process',
    sort_order: 0,
    citation_sources: [],
    ...overrides,
  };
}

describe('Ask Relay published-knowledge retrieval', () => {
  it('uses deterministic reciprocal-rank fusion parameters', () => {
    expect(RRF_K).toBe(60);
  });

  it('ignores generic question words', () => {
    expect(meaningfulQueryTerms('What should I do with the event budget?')).toEqual(['event', 'budget']);
  });

  it('ranks a relevant voice-derived item above a less-relevant document-derived item', () => {
    const documentItem = item({
      id: 'document',
      title: 'Budget archive',
      content: 'The shared drive contains old event spreadsheets and meeting records.',
      sort_order: 1,
      citation_sources: [{ label: 'Budget handbook.pdf', locator: 'Page 4' }],
    });
    const voiceItem = item({
      id: 'voice',
      title: 'Weekly budget update',
      content: 'Update the event budget spreadsheet every Friday.',
      sort_order: 900,
      citation_sources: [{ label: 'Voice handoff notes', locator: null }],
    });

    const evidence = selectEvidence('When should I update the event budget spreadsheet?', [documentItem, voiceItem]);
    expect(evidence[0].id).toBe('voice');
    expect(evidence[0].sources[0].label).toBe('Voice handoff notes');
  });

  it('ranks text-derived approved knowledge by its content in the same way', () => {
    const documentItem = item({
      id: 'document',
      title: 'General university policy',
      content: 'Keep current organization records in the shared drive.',
      citation_sources: [{ label: 'University policy.pdf', locator: 'Page 2' }],
    });
    const textItem = item({
      id: 'text',
      title: 'Reimbursement approval contact',
      content: 'Send reimbursement requests to the faculty advisor for approval.',
      sort_order: 500,
      citation_sources: [{ label: 'Treasurer working notes', locator: null }],
    });

    const evidence = selectEvidence('Who handles reimbursement approval?', [documentItem, textItem]);
    expect(evidence[0].id).toBe('text');
  });

  it('ranks a direct content answer above a weaker title match', () => {
    const directAnswer = item({
      id: 'direct',
      title: 'Weekly finance routine',
      content: 'Update the event budget spreadsheet every Friday.',
      sort_order: 500,
    });
    const titleMatch = item({
      id: 'title',
      title: 'Budget responsibilities',
      content: 'The Treasurer oversees financial planning for the organization.',
      sort_order: 1,
    });

    const evidence = selectEvidence('When should I update the budget?', [titleMatch, directAnswer]);
    expect(evidence[0].id).toBe('direct');
  });

  it('does not let a strong title with weak content outrank directly relevant content', () => {
    const directAnswer = item({
      id: 'direct',
      title: 'Annual paperwork',
      content: 'Submit the registration through the Student Affairs portal.',
      sort_order: 500,
    });
    const titleMatch = item({
      id: 'title',
      title: 'Registration submission process',
      content: 'The organization completes this work annually.',
      sort_order: 1,
    });

    const evidence = selectEvidence('How do I submit the registration?', [titleMatch, directAnswer]);
    expect(evidence[0].id).toBe('direct');
  });

  it('ranks strong title and content agreement highly', () => {
    const strong = item({
      id: 'strong',
      title: 'Reimbursement form',
      content: 'Complete the reimbursement form in the shared drive.',
    });
    const weak = item({
      id: 'weak',
      title: 'Finance resources',
      content: 'Financial materials are retained for the next Treasurer.',
    });

    expect(rankPublicationItems('Where is the reimbursement form?', [weak, strong])[0].item.id).toBe('strong');
  });

  it('ranks an exact answer in content highly even when its title uses different wording', () => {
    const directAnswer = item({
      id: 'direct',
      title: 'Friday closeout',
      content: 'Update the event budget spreadsheet every Friday.',
      sort_order: 500,
    });
    const titleMatch = item({
      id: 'title',
      title: 'Budget update',
      content: 'The Treasurer manages organizational finances.',
      sort_order: 1,
    });

    const evidence = selectEvidence('When should I update the budget?', [titleMatch, directAnswer]);
    expect(evidence[0].id).toBe('direct');
  });

  it('uses direct content coverage to order items sharing the same keyword', () => {
    const directAnswer = item({
      id: 'direct',
      title: 'Expense workflow',
      content: 'Submit the reimbursement request to the faculty advisor.',
      sort_order: 500,
    });
    const broadMatch = item({
      id: 'broad',
      title: 'Reimbursement overview',
      content: 'Reimbursement is one of the Treasurer responsibilities.',
      sort_order: 1,
    });

    const evidence = selectEvidence('How do I submit a reimbursement request to the advisor?', [broadMatch, directAnswer]);
    expect(evidence[0].id).toBe('direct');
  });

  it('keeps multiple complementary relevant items available for one grounded answer', () => {
    const evidence = selectEvidence('How do I submit a reimbursement request?', [
      item({ id: 'form', title: 'Reimbursement form', content: 'Complete the reimbursement form in the shared drive.' }),
      item({ id: 'approval', title: 'Reimbursement approval', content: 'Send the completed request to the faculty advisor.' }),
      item({ id: 'venue', title: 'Venue booking', content: 'Reserve Engineering Hall before RoboFest.' }),
    ]);
    expect(new Set(evidence.slice(0, 2).map(({ id }) => id))).toEqual(new Set(['form', 'approval']));

    expect(normalizeModelAnswer({
      status: 'answered',
      has_material_conflict: false,
      answer: 'Complete the shared-drive form, then send it to the faculty advisor.',
      citation_refs: ['E1', 'E2'],
    }, new Set(['E1', 'E2', 'E3']))).toMatchObject({ status: 'answered', citationRefs: ['E1', 'E2'] });
  });

  it('retrieves a semantically related published entry when the wording differs', () => {
    const venue = item({
      id: 'venue',
      title: 'Engineering Hall reservation',
      content: 'Reserve Engineering Hall through the university facilities portal.',
      knowledge_type: 'process',
      sort_order: 50,
    });
    const finance = item({
      id: 'finance',
      title: 'Weekly budget update',
      content: 'Send the spreadsheet to the faculty advisor every Friday.',
      knowledge_type: 'process',
      sort_order: 1,
    });

    const ranked = rankPublicationItemsHybrid(
      'Where should I arrange the gathering location?',
      [finance, venue],
      ['venue', 'finance'],
    );

    expect(ranked[0].item.id).toBe('venue');
  });

  it('keeps exact names and numbers strong through BM25F inside hybrid retrieval', () => {
    const general = item({
      id: 'general',
      title: 'Expense overview',
      content: 'Follow the organization finance process.',
      sort_order: 1,
    });
    const exact = item({
      id: 'exact',
      title: 'Large reimbursement approval',
      content: 'Dr. Maya Khan must approve reimbursements over $500 before purchase.',
      sort_order: 50,
    });

    const ranked = rankPublicationItemsHybrid(
      'Who approves reimbursements over $500?',
      [general, exact],
      ['general', 'exact'],
    );

    expect(ranked[0].item.id).toBe('exact');
  });

  it('requires both conflicting evidence references instead of choosing one', () => {
    const result = normalizeModelAnswer({
      status: 'conflict',
      has_material_conflict: true,
      answer: 'The handoff contains conflicting information about this. One item says Friday and another says Monday.',
      citation_refs: ['E1', 'E2'],
    }, new Set(['E1', 'E2']));
    expect(result).toMatchObject({ status: 'conflict', citationRefs: ['E1', 'E2'] });
    expect(() => normalizeModelAnswer({
      status: 'conflict',
      has_material_conflict: true,
      answer: 'The handoff contains conflicting information about this.',
      citation_refs: ['E1'],
    }, new Set(['E1', 'E2']))).toThrow();
  });

  it('normalizes a no-evidence model decision to the fixed unsupported response', () => {
    expect(normalizeModelAnswer({
      status: 'unsupported',
      has_material_conflict: false,
      answer: 'Anything the model wrote is replaced.',
      citation_refs: [],
    }, new Set(['E1']))).toEqual({
      status: 'unsupported',
      answer: UNSUPPORTED_ANSWER,
      citationRefs: [],
    });
  });
});

describe('Ask Relay BM25F retrieval regressions', () => {
  it('uses the documented conservative field parameters', () => {
    expect(BM25F_PARAMETERS).toEqual({
      k1: 1.2,
      titleWeight: 1,
      contentWeight: 1.15,
      titleLengthNormalization: 0.75,
      contentLengthNormalization: 0.75,
    });
  });

  it('ranks a strong content match above a weak title-only match', () => {
    const evidence = selectEvidence('When should I submit the RoboFest venue request?', [
      item({
        id: 'title-only',
        title: 'RoboFest venue',
        content: 'The committee keeps general event records.',
        sort_order: 1,
      }),
      item({
        id: 'content-answer',
        title: 'Annual event routine',
        content: 'Submit the RoboFest venue request sixteen weeks before the event.',
        sort_order: 50,
      }),
    ]);

    expect(evidence[0].id).toBe('content-answer');
  });

  it('uses a strong title when short content answers with pronouns', () => {
    const evidence = selectEvidence('What is the RoboFest venue booking deadline?', [
      item({
        id: 'weak-content',
        title: 'Annual calendar',
        content: 'Venue arrangements are recorded here.',
        sort_order: 1,
      }),
      item({
        id: 'strong-title',
        title: 'RoboFest venue booking deadline',
        content: 'Submit it sixteen weeks before the event.',
        sort_order: 50,
      }),
    ]);

    expect(evidence[0].id).toBe('strong-title');
  });

  it('rewards several distinct query terms over one repeated keyword', () => {
    const repeatedInsurance = Array.from({ length: 20 }, () => 'insurance').join(' ');
    const evidence = selectEvidence('RoboFest insurance waiver advisor approval', [
      item({
        id: 'repeated',
        title: 'Insurance notes',
        content: repeatedInsurance,
        sort_order: 1,
      }),
      item({
        id: 'distinct',
        title: 'Event paperwork',
        content: 'The RoboFest insurance waiver requires advisor approval.',
        sort_order: 50,
      }),
    ]);

    expect(evidence[0].id).toBe('distinct');
  });

  it('normalizes field length instead of favoring a long item with the same matches', () => {
    const filler = Array.from({ length: 80 }, () => 'general organization background').join(' ');
    const evidence = selectEvidence('Where is the reimbursement form?', [
      item({
        id: 'long',
        title: 'Expense resource',
        content: `${filler} The reimbursement form is available.`,
        sort_order: 1,
      }),
      item({
        id: 'concise',
        title: 'Expense resource',
        content: 'Use the reimbursement form.',
        sort_order: 50,
      }),
    ]);

    expect(evidence[0].id).toBe('concise');
  });

  it('gives a rare domain-specific term more discriminative value', () => {
    const commonItems = Array.from({ length: 6 }, (_, index) => item({
      id: `common-${index}`,
      title: 'Routine finance file',
      content: 'Use the budget form for routine records.',
      sort_order: index + 10,
    }));
    const evidence = selectEvidence('Where is the budget indemnity form?', [
      item({
        id: 'common-match',
        title: 'Finance files',
        content: 'The budget form is stored in the shared drive.',
        sort_order: 1,
      }),
      item({
        id: 'rare-match',
        title: 'Risk paperwork',
        content: 'Ask Risk Management for the indemnity certificate.',
        sort_order: 50,
      }),
      ...commonItems,
    ]);

    expect(evidence[0].id).toBe('rare-match');
  });

  it('keeps several genuinely relevant Knowledge Items at the top', () => {
    const evidence = selectEvidence('How do I submit the RoboFest reimbursement?', [
      item({ id: 'form', title: 'RoboFest reimbursement form', content: 'Complete it in the shared drive.' }),
      item({ id: 'submit', title: 'Expense submission', content: 'Submit the reimbursement through the finance portal.' }),
      item({ id: 'approval', title: 'Advisor approval', content: 'The RoboFest reimbursement requires faculty approval.' }),
      item({ id: 'history', title: 'RoboFest history', content: 'Photos are stored in the archive.' }),
      item({ id: 'venue', title: 'Venue booking', content: 'Reserve Engineering Hall for the event.' }),
    ]);

    expect(new Set(evidence.slice(0, 3).map(({ id }) => id)))
      .toEqual(new Set(['form', 'submit', 'approval']));
  });

  it('ranks an unrelated item sharing a common word below the direct answer', () => {
    const evidence = selectEvidence('Which reimbursement form should I send to the advisor?', [
      item({
        id: 'common-word',
        title: 'Advisor relationships',
        content: 'The advisor attends weekly meetings and social events.',
        sort_order: 1,
      }),
      item({
        id: 'direct',
        title: 'Expense submission',
        content: 'Send the reimbursement form to the faculty advisor.',
        sort_order: 50,
      }),
    ]);

    expect(evidence[0].id).toBe('direct');
  });
});
