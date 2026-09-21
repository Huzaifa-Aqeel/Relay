import { describe, expect, it } from 'vitest';

import { classifySourceVersion, normalizeSourceFilename } from '@/features/relay/source-versioning';

const current = {
  id: 'source-1',
  title: 'RoboFest Budget',
  normalizedFilename: 'robofest-budget',
  contentHash: 'a'.repeat(64),
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  isCurrent: true,
};

describe('source version detection', () => {
  it('normalizes names without treating punctuation as document identity', () => {
    expect(normalizeSourceFilename('  RoboFest_Budget (Final).XLSX  ')).toBe('robofest-budget-final');
  });

  it('detects identical bytes before any version inference', () => {
    expect(classifySourceVersion('anything.xlsx', current.mimeType!, current.contentHash!, [current])).toEqual({
      kind: 'duplicate', source: current,
    });
  });

  it('links a byte-different upload with the same normalized filename and type', () => {
    expect(classifySourceVersion('RoboFest Budget.xlsx', current.mimeType!, 'b'.repeat(64), [current])).toEqual({
      kind: 'new_version', source: current, basis: 'filename_and_type',
    });
  });

  it('requires confirmation for version-suffixed filename similarity', () => {
    const v1 = { ...current, normalizedFilename: 'robofest-budget-v1' };
    expect(classifySourceVersion('RoboFest Budget v2.xlsx', current.mimeType!, 'b'.repeat(64), [v1])).toEqual({
      kind: 'confirmation_required', source: v1,
    });
  });

  it('does not link unrelated files or non-current historical versions', () => {
    expect(classifySourceVersion('Volunteer Roster.xlsx', current.mimeType!, 'b'.repeat(64), [
      { ...current, isCurrent: false },
    ])).toEqual({ kind: 'separate' });
  });
});
