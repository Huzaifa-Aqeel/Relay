import { describe, expect, it } from 'vitest';

import {
  captureReviewSummary,
  handoffStageIndex,
  HANDOFF_STAGES,
  isPublicRootSegment,
  shouldRunHandoffCheck,
} from '@/features/relay/shell-model';

describe('Relay shell boundaries', () => {
  it('allows public recipient, legal, and sign-in invitation landing routes', () => {
    expect(isPublicRootSegment('shared')).toBe(true);
    expect(isPublicRootSegment('legal')).toBe(true);
    expect(isPublicRootSegment('assignment')).toBe(true);
    expect(isPublicRootSegment('drive-import')).toBe(true);
    expect(isPublicRootSegment('role-assignment')).toBe(false);
    expect(isPublicRootSegment('ownership-transfer')).toBe(false);
    expect(isPublicRootSegment('organization')).toBe(false);
    expect(isPublicRootSegment('handoff')).toBe(false);
    expect(isPublicRootSegment(undefined)).toBe(false);
  });

  it('preserves the required handoff progression', () => {
    expect(HANDOFF_STAGES).toEqual(['Capture', 'Review', 'Handoff check', 'Preview', 'Published']);
    expect(handoffStageIndex('preflight')).toBe(2);
  });

  it('runs the handoff check automatically only after Review is resolved', () => {
    expect(shouldRunHandoffCheck({
      stage: 'review', proposalCount: 0, approvedCount: 2, hasRun: false, attempted: false,
    })).toBe(true);
    expect(shouldRunHandoffCheck({
      stage: 'review', proposalCount: 1, approvedCount: 2, hasRun: false, attempted: false,
    })).toBe(false);
    expect(shouldRunHandoffCheck({
      stage: 'review', proposalCount: 0, approvedCount: 2, hasRun: true, attempted: false,
    })).toBe(false);
  });

  it('shows the live Capture review state instead of the historical Organize count', () => {
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 6 }))
      .toBe('6 things to review');
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 5 }))
      .toBe('5 things to review');
    expect(captureReviewSummary({ structuredProposalCount: 6, pendingProposalCount: 0 }))
      .toBeNull();
    expect(captureReviewSummary({ structuredProposalCount: 0, pendingProposalCount: 0 }))
      .toBe('Checked · nothing new found');
  });
});
