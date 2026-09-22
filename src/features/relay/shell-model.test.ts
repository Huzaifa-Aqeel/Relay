import { describe, expect, it } from 'vitest';

import {
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
    expect(HANDOFF_STAGES).toEqual(['Capture', 'Review', 'Preflight', 'Preview', 'Published']);
  });
});
