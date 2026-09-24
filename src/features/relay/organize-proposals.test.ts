import { describe, expect, it } from 'vitest';

import {
  buildCaptureProposalMessages,
  buildProposalMessages,
  captureProposalSchema,
  ORGANIZE_KNOWLEDGE_TYPES,
  resolveSourceExcerpt,
  validateCaptureProposalOutput,
  validateProposalOutput,
  type CaptureEvidence,
  type Proposal,
} from '../../../supabase/functions/_shared/organize-proposals';
import {
  completeDocumentText,
  DocumentTextLimitError,
} from '../../../supabase/functions/_shared/document-text';

const APPROVED_ID = '11111111-1111-4111-8111-111111111111';
const TEXT_SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const FILE_SOURCE_ID = '33333333-3333-4333-8333-333333333333';

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    proposal_action: 'create',
    target_knowledge_item_id: null,
    knowledge_type: 'process',
    title: 'Update the event budget',
    content: 'Update the event budget spreadsheet every Friday.',
    uncertainty_note: null,
    source_excerpt: 'Update the event budget spreadsheet every Friday.',
    source_locator: null,
    ...overrides,
  };
}

const CAPTURE_EVIDENCE: CaptureEvidence[] = [
  {
    sourceId: TEXT_SOURCE_ID,
    label: 'Capture note',
    kind: 'capture_text',
    text: 'Update the event budget spreadsheet every Friday.',
  },
  {
    sourceId: FILE_SOURCE_ID,
    label: 'Budget 2027.xlsx',
    kind: 'attachment',
    text: 'Faculty advisor approval is required for reimbursements over $500.',
  },
];

function captureProposal(overrides: Record<string, unknown> = {}) {
  return {
    ...proposal(),
    evidence_source_id: TEXT_SOURCE_ID,
    ...overrides,
  };
}

describe('Organize proposal contract', () => {
  it('resolves harmless pasted line wrapping to the exact original Source substring', () => {
    const source = 'The Events Lead should begin planning sixteen\n  weeks before the event.';
    const supplied = 'The Events Lead should begin planning sixteen weeks before the event.';
    const exactOriginalPassage = 'The Events Lead should begin planning sixteen\n  weeks before the event';
    expect(resolveSourceExcerpt(source, supplied)).toBe(exactOriginalPassage);
    expect(validateProposalOutput({ proposals: [proposal({
      content: supplied,
      source_excerpt: supplied,
    })] }, source, new Set())[0].source_excerpt).toBe(exactOriginalPassage);
  });

  it('ignores punctuation and capitalization but not changed facts', () => {
    const source = 'Update the budget every Friday.';
    expect(resolveSourceExcerpt(source, 'update the budget every Friday!')).toBe('Update the budget every Friday');
    expect(resolveSourceExcerpt(source, 'Update the budget every Monday.')).toBeNull();
    expect(resolveSourceExcerpt(source, 'Update the budget every Friday at noon.')).toBeNull();
  });

  it('expands ordered exact paragraph fragments back to one exact contiguous provenance span', () => {
    const source = 'Reserve Engineering Hall through the facilities portal.\n\nUnrelated budget detail.\n\nEmail Mike when the reservation is submitted.';
    const supplied = 'Reserve Engineering Hall through the facilities portal.\n\nEmail Mike when the reservation is submitted.';
    expect(resolveSourceExcerpt(source, supplied)).toBe(source.slice(0, -1));
  });

  it('accepts new operational knowledge as a create proposal', () => {
    const source = 'Update the event budget spreadsheet every Friday.';
    const result = validateProposalOutput({ proposals: [proposal()] }, source, new Set());
    expect(result).toMatchObject([{ proposal_action: 'create', knowledge_type: 'process' }]);
  });

  it('accepts a correction only as an update targeting approved knowledge', () => {
    const source = 'Mike now handles Engineering Hall facilities requests.';
    const result = validateProposalOutput({ proposals: [proposal({
      proposal_action: 'update',
      target_knowledge_item_id: APPROVED_ID,
      knowledge_type: 'contact',
      title: 'Engineering Hall facilities contact',
      content: 'Mike handles Engineering Hall facilities requests.',
      source_excerpt: source,
    })] }, source, new Set([APPROVED_ID]));
    expect(result[0]).toMatchObject({ proposal_action: 'update', target_knowledge_item_id: APPROVED_ID });
  });

  it('accepts an explicit retirement only when it targets approved knowledge', () => {
    const source = 'The old reimbursement form is retired and must no longer be used.';
    const result = validateProposalOutput({ proposals: [proposal({
      proposal_action: 'retire',
      target_knowledge_item_id: APPROVED_ID,
      knowledge_type: 'access_resource',
      title: 'Old reimbursement form',
      content: 'Use the old reimbursement form.',
      source_excerpt: source,
    })] }, source, new Set([APPROVED_ID]));
    expect(result[0].proposal_action).toBe('retire');
  });

  it('accepts zero proposals when a capture adds no new information', () => {
    expect(validateProposalOutput({ proposals: [] }, 'This repeats the approved process.', new Set([APPROVED_ID])))
      .toEqual([]);
  });

  it('accepts one grounded item for steps and approval details in the same operational unit', () => {
    const source = 'Submit RoboFest reimbursements through the online reimbursement portal. Expenses over $500 require approval from Dr. Maya Khan before purchase.';
    const result = validateProposalOutput({ proposals: [proposal({
      title: 'RoboFest reimbursement process',
      content: 'Submit RoboFest reimbursements through the online reimbursement portal. Expenses over $500 require approval from Dr. Maya Khan before purchase.',
      source_excerpt: source,
    })] }, source, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      knowledge_type: 'process',
      title: 'RoboFest reimbursement process',
      source_excerpt: source,
    });
  });

  it('consolidates AV testing and its explicit projector-failure consequence into one context-rich entry', () => {
    const source = 'Test the projector, microphones, and presentation laptop before attendees arrive. Last year the projector failed and delayed the opening by about 20 minutes.';
    const result = validateProposalOutput({ proposals: [proposal({
      title: 'Test AV equipment before RoboFest',
      content: 'Test the projector, microphones, and presentation laptop before attendees arrive. Last year the projector failed and delayed the opening by about 20 minutes.',
      knowledge_type: 'warning_lesson',
      source_excerpt: source,
    })] }, source, new Set());

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      knowledge_type: 'warning_lesson',
      title: 'Test AV equipment before RoboFest',
    });
    expect(result).toHaveLength(1);
  });

  it('keeps why and when inside an independently useful contact entry', () => {
    const source = 'Mike Torres handles Engineering Hall reservation and AV issues for RoboFest. Email mike@example.edu when there is a problem with the venue.';
    const result = validateProposalOutput({ proposals: [proposal({
      knowledge_type: 'contact',
      title: 'Mike Torres — Engineering Hall Facilities',
      content: source,
      source_excerpt: source,
    })] }, source, new Set());

    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('reservation and AV issues');
    expect(result[0].content).toContain('when there is a problem with the venue');
  });

  it('keeps genuinely independent operational units as separate items', () => {
    const source = 'Update the budget every Friday. Run attendee check-in through the registration tablet.';
    const result = validateProposalOutput({ proposals: [
      proposal({ content: 'Update the budget every Friday.', source_excerpt: 'Update the budget every Friday.' }),
      proposal({
        knowledge_type: 'process',
        title: 'Run attendee check-in',
        content: 'Run attendee check-in through the registration tablet.',
        source_excerpt: 'Run attendee check-in through the registration tablet.',
      }),
    ] }, source, new Set());
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.knowledge_type === 'process')).toBe(true);
  });

  it('keeps a mismatched prompt chip out of evidence and classification', () => {
    const messages = buildCaptureProposalMessages({
      roleTitle: 'Treasurer',
      evidence: CAPTURE_EVIDENCE,
      approvedKnowledge: [],
    });
    const payload = messages.map(({ content }) => content).join('\n');
    expect(payload).not.toContain('Constitution or policies');
    expect(payload).toContain('EVIDENCE LABEL (LABEL ONLY): Capture note');
    expect(payload).toContain('EVIDENCE LABEL (LABEL ONLY)');
    expect(validateCaptureProposalOutput({ proposals: [captureProposal()] }, CAPTURE_EVIDENCE, new Set())[0].knowledge_type).toBe('process');
  });

  it('defines independent operational units instead of extracting one item per fact', () => {
    const captureInstructions = buildCaptureProposalMessages({
      roleTitle: 'Events Lead',
      evidence: CAPTURE_EVIDENCE,
      approvedKnowledge: [],
    })[0].content;
    const legacyInstructions = buildProposalMessages({
      roleTitle: 'Events Lead',
      sourceTitle: 'Capture note',
      sourceText: CAPTURE_EVIDENCE[0].text,
      approvedKnowledge: [],
    })[0].content;
    for (const instructions of [captureInstructions, legacyInstructions]) {
      expect(instructions).toContain('smallest independently useful piece of operational knowledge, not the smallest extractable fact');
      expect(instructions).toContain('Determine Knowledge Item boundaries before choosing any knowledge_type');
      expect(instructions).toContain('Never classify extracted facts into types first');
      expect(instructions).toContain('(1) extract grounded facts');
      expect(instructions).toContain('Do not output the intermediate extracted facts');
      expect(instructions).toContain('Consolidation changes item boundaries; it must not discard useful grounded facts');
      expect(instructions).toContain('a step in another process');
      expect(instructions).toContain('a contact specifically supporting another task');
      expect(instructions).toContain('whether B would still be independently useful to the successor without A');
      expect(instructions).toContain('Never use different apparent types as a reason to split');
      expect(instructions).toContain('do not merge unrelated workflows');
      expect(instructions).toContain('one exact contiguous excerpt from one selected evidence source supports every fact');
      expect(instructions).toContain('Never infer a causal relationship from chronology or nearby sentences');
      expect(instructions).toContain('Use only these broad primary categories');
      expect(instructions).toContain('One piece of knowledge gets one primary category');
      expect(instructions).toContain('mentioned only to execute one captured workflow as dependent');
      expect(instructions).toContain('If removing a proposed item would lose no independently actionable guidance');
      expect(instructions).toContain('never emit only a name, email address, or phone number');
      expect(instructions).toContain('must produce exactly one context-rich warning_lesson entry');
      expect(instructions).toContain('one focused process entry');
      expect(instructions).toContain('MANDATORY BOUNDARY AND COVERAGE AUDIT');
      expect(instructions).toContain('compare every proposed pair');
      expect(instructions).toContain('temporarily remove it');
      expect(instructions).toContain('restore any useful grounded fact accidentally omitted');
      expect(instructions).toContain('Do not retain duplicate cross-category entries');
      expect(instructions).toContain('source_excerpt is a provenance quote, not a summary');
      expect(instructions).toContain('one literal contiguous substring');
      expect(instructions).toContain('verify character-for-character');
    }
    const proposalItem = captureProposalSchema.properties.proposals.items;
    expect(proposalItem.properties.content.description).toContain('one literal contiguous source_excerpt');
    expect(proposalItem.properties.source_excerpt.description).toContain('Never paraphrase');
    expect(proposalItem.properties.source_excerpt.description).toContain('concatenate non-adjacent passages');
    expect(proposalItem.properties.knowledge_type.enum).toEqual(ORGANIZE_KNOWLEDGE_TYPES);
  });

  it('validates Capture-text and attachment evidence against the exact selected source', () => {
    const result = validateCaptureProposalOutput({ proposals: [
      captureProposal(),
      captureProposal({
        title: 'Large reimbursement approval',
        content: 'The faculty advisor must approve reimbursements over $500.',
        evidence_source_id: FILE_SOURCE_ID,
        source_excerpt: 'Faculty advisor approval is required for reimbursements over $500.',
      }),
    ] }, CAPTURE_EVIDENCE, new Set());
    expect(result.map((item) => item.evidence_source_id)).toEqual([TEXT_SOURCE_ID, FILE_SOURCE_ID]);
    expect(() => validateCaptureProposalOutput({ proposals: [captureProposal({
      evidence_source_id: FILE_SOURCE_ID,
      source_excerpt: 'Update the event budget spreadsheet every Friday.',
    })] }, CAPTURE_EVIDENCE, new Set())).toThrow('original source');
  });

  it('uses the same Capture-text evidence model for typed and voice-produced text', () => {
    const text = 'Book Engineering Hall sixteen weeks before RoboFest.';
    const typed = [{ ...CAPTURE_EVIDENCE[0], text }];
    const transcribedVoice = [{ ...CAPTURE_EVIDENCE[0], text }];
    expect(buildCaptureProposalMessages({ roleTitle: 'Events Lead', evidence: typed, approvedKnowledge: [] }))
      .toEqual(buildCaptureProposalMessages({ roleTitle: 'Events Lead', evidence: transcribedVoice, approvedKnowledge: [] }));
  });

  it('fails explicitly instead of silently truncating document text', () => {
    expect(completeDocumentText(['abc', 'def'], 8)).toBe('abc\n\ndef');
    expect(() => completeDocumentText(['123456789'], 8)).toThrow(DocumentTextLimitError);
  });

  it('retains the audited 100-approved-item context ceiling', () => {
    const approvedKnowledge = Array.from({ length: 101 }, (_, index) => ({
      id: `item-${index + 1}`,
      knowledge_type: 'process',
      title: `Process ${index + 1}`,
      content: `Instruction ${index + 1}`,
    }));
    const messages = buildProposalMessages({
      roleTitle: 'Treasurer',
      sourceTitle: 'New note',
      sourceText: 'A new supported fact.',
      approvedKnowledge,
    });
    expect(messages[1].content).toContain('ID item-100');
    expect(messages[1].content).not.toContain('ID item-101');
  });

  it('fails instead of silently dropping proposals beyond the 30-proposal limit', () => {
    const source = 'Update the event budget spreadsheet every Friday.';
    expect(() => validateProposalOutput({
      proposals: Array.from({ length: 31 }, (_, index) => proposal({ title: `Proposal ${index + 1}` })),
    }, source, new Set())).toThrow('too many suggestions');
  });
});
