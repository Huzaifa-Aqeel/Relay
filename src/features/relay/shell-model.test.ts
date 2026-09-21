import { describe, expect, it } from 'vitest';

import {
  HANDOFF_STAGES,
  isPublicRootSegment,
} from '@/features/relay/shell-model';

describe('Relay shell boundaries', () => {
  it('keeps only shared handoffs and legal pages outside the auth gate', () => {
    expect(isPublicRootSegment('shared')).toBe(true);
    expect(isPublicRootSegment('legal')).toBe(true);
    expect(isPublicRootSegment('organization')).toBe(false);
    expect(isPublicRootSegment('handoff')).toBe(false);
    expect(isPublicRootSegment(undefined)).toBe(false);
  });

  it('preserves the required handoff progression', () => {
    expect(HANDOFF_STAGES).toEqual(['Capture', 'Review', 'Preflight', 'Preview', 'Published']);
  });
});
