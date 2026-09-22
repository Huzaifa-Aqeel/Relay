import { describe, expect, it } from 'vitest';

import { assignmentInviteUrl } from '@/features/relay/share-link';

describe('assignment invite links', () => {
  it('opens the installed Relay app at the token-specific assignment route', () => {
    const token = 'a'.repeat(64);
    expect(assignmentInviteUrl(token)).toBe(`relay://assignment/${token}`);
  });

  it('does not create a deep link from an invalid token', () => {
    expect(assignmentInviteUrl('not-a-token')).toBeNull();
  });
});
