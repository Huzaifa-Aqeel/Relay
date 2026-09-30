import { describe, expect, it } from 'vitest';

import {
  captureReviewSummary,
  handoffStageIndex,
  HANDOFF_STAGES,
  isPublicRootSegment,
} from '@/features/relay/shell-model';

describe('Relay shell boundaries', () => {
  it('allows public recipient, legal, and sign-in invitation landing routes', () => {
    expect(isPublicRootSegment('shared')).toBe(true);
    expect(isPublicRootSegment('legal')).toBe(true);
    expect(isPublicRootSegment('assignment')).toBe(true);
    expect(isPublicRootSegment('role-assignment')).toBe(false);
    expect(isPublicRootSegment('ownership-transfer')).toBe(false);
    expect(isPublicRootSegment('organization')).toBe(false);
    expect(isPublicRootSegment('handoff')).toBe(false);
    expect(isPublicRootSegment(undefined)).toBe(false);
  });

  it('preserves the required handoff progression', () => {
    expect(HANDOFF_STAGES).toEqual(['Capture', 'Review', 'Preview', 'Published']);
    expect(handoffStageIndex('preview')).toBe(2);
  });

  it('shows the live Capture review state instead of the historical Organize count', () => {
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 6 }))
      .toBe('6 things to review');
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 5 }))
      .toBe('5 things to review');
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 0 }))
      .toBeNull();
    expect(captureReviewSummary({ structuredProposalCount: 0, pendingProposalCount: 0 }))
      .toBe('Checked · no new or changed handoff knowledge found');
  });

  it('surfaces a skipped suggestion without telling the user to repeat an already-repaired run', () => {
    expect(captureReviewSummary({ structuredProposalCount: 4, pendingProposalCount: 4, droppedCount: 1 }))
      .toBe('4 things to review — 1 suggestion matched what you already have.');
    expect(captureReviewSummary({ structuredProposalCount: 0, pendingProposalCount: 0, droppedCount: 2 }))
      .toBe('Checked · no new or changed handoff knowledge found — 2 suggestions matched what you already have.');
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 0, droppedCount: 1 }))
      .toBe('1 suggestion matched what you already have.');
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 0, droppedCount: 0 }))
      .toBeNull();
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 0, droppedCount: null }))
      .toBeNull();
  });
});
