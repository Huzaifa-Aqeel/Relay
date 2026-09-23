import { describe, expect, it } from 'vitest';

import {
  buildCaptureProposalMessages,
  buildProposalMessages,
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
      knowledge_type: 'resource',
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

  it('keeps multiple independently evidenced facts from one capture', () => {
    const source = 'Update the budget every Friday. Send it to Dr. Khan for approval.';
    const result = validateProposalOutput({ proposals: [
      proposal({ content: 'Update the budget every Friday.', source_excerpt: 'Update the budget every Friday.' }),
      proposal({
        knowledge_type: 'contact',
        title: 'Budget approver',
        content: 'Send the budget to Dr. Khan for approval.',
        source_excerpt: 'Send it to Dr. Khan for approval.',
      }),
    ] }, source, new Set());
    expect(result).toHaveLength(2);
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

  it('instructs Organize to avoid redundant standalone Lessons without inventing causality', () => {
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
      expect(instructions).toContain('only when each item is independently useful');
      expect(instructions).toContain('instead of also creating a separate Lesson');
      expect(instructions).toContain('Never infer a causal relationship from chronology or nearby sentences');
    }
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
