import { describe, expect, it } from 'vitest';

import {
  buildCaptureProposalMessages,
  normalizeCaptureProposalOutput,
  type CaptureEvidence,
} from '../../../supabase/functions/_shared/organize-proposals';

const NOTE_ID = '22222222-2222-4222-8222-222222222222';
const FILE_ID = '33333333-3333-4333-8333-333333333333';

const evidence: CaptureEvidence[] = [
  {
    sourceId: NOTE_ID,
    label: 'Capture note',
    kind: 'capture_text',
    text: 'Reserve the venue four weeks before the event.',
  },
  {
    sourceId: FILE_ID,
    label: 'Event plan.xlsx',
    kind: 'attachment',
    text: 'Contact Campus Events if the booking remains pending after five days.',
  },
];

describe('simplified Capture Organize contract', () => {
  it('sends all Capture evidence through one prompt without approved knowledge', () => {
    const prompt = buildCaptureProposalMessages({
      roleTitle: 'Events Lead',
      roleDescription: 'Coordinates the annual program.',
      servicePeriod: '2027–2028',
      captureTitle: 'Annual event',
      evidence,
    });
    const userMessage = prompt.messages[1].content;
    expect(userMessage).toContain(NOTE_ID);
    expect(userMessage).toContain(FILE_ID);
    expect(userMessage).toContain('Reserve the venue');
    expect(userMessage).toContain('Contact Campus Events');
    expect(userMessage).not.toContain('APPROVED KNOWLEDGE');
  });

  it('keeps one proposal with provenance from multiple Capture sources', () => {
    const prompt = buildCaptureProposalMessages({ roleTitle: 'Events Lead', evidence });
    const proposals = normalizeCaptureProposalOutput({
      proposals: [{
        knowledge_type: 'process',
        title: 'Plan and follow up on the venue booking',
        content: 'Reserve the venue four weeks before the event and contact Campus Events if it remains pending after five days.',
        uncertainty_note: null,
        citations: [
          { source_id: NOTE_ID, span_ids: ['e1'] },
          { source_id: FILE_ID, span_ids: ['e2'] },
        ],
      }],
    }, prompt.index);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].citations).toHaveLength(2);
    expect(proposals[0].citations.map((citation) => citation.source_id)).toEqual([NOTE_ID, FILE_ID]);
  });

  it('keeps a proposal when span IDs are invalid and falls back to its Capture source', () => {
    const prompt = buildCaptureProposalMessages({ roleTitle: 'Events Lead', evidence });
    const proposals = normalizeCaptureProposalOutput({ proposals: [{
      title: 'Reserve the venue',
      content: 'Reserve the venue four weeks before the event.',
      citations: [{ source_id: NOTE_ID, span_ids: ['missing-span'] }],
    }] }, prompt.index);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].citations).toEqual([{
      source_id: NOTE_ID,
      source_excerpt: null,
      source_locator: null,
    }]);
  });

  it('keeps a useful proposal even when no citation can be resolved', () => {
    const prompt = buildCaptureProposalMessages({ roleTitle: 'Events Lead', evidence });
    const proposals = normalizeCaptureProposalOutput({ proposals: [{
      category: 'deadline',
      content: 'Reserve the venue four weeks before the event.',
      citations: [{ source_id: 'unknown', span_ids: ['bad'] }],
    }] }, prompt.index);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].knowledge_type).toBe('rule_deadline');
    expect(proposals[0].citations).toEqual([]);
  });
});
