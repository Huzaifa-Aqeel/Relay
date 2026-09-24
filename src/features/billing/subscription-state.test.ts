import { describe, expect, it } from 'vitest';
import type { CustomerInfo } from 'react-native-purchases';

import { subscriptionStateFromCustomerInfo } from '@/features/billing/subscription-state';

function customerInfo(overrides: Record<string, unknown> = {}) {
  return {
    managementURL: 'https://play.google.com/store/account/subscriptions',
    entitlements: {
      all: {
        relay_pro: {
          isActive: true,
          willRenew: true,
          expirationDate: '2027-09-24T00:00:00.000Z',
          store: 'PLAY_STORE',
          unsubscribeDetectedAt: null,
          ...overrides,
        },
      },
    },
  } as unknown as CustomerInfo;
}

describe('subscriptionStateFromCustomerInfo', () => {
  it('reports an active auto-renewing subscription', () => {
    expect(subscriptionStateFromCustomerInfo(customerInfo(), 'relay_pro')).toMatchObject({
      isActive: true,
      willRenew: true,
      managementUrl: 'https://play.google.com/store/account/subscriptions',
    });
  });

  it('keeps a cancelled subscription active through its paid expiration', () => {
    expect(subscriptionStateFromCustomerInfo(customerInfo({
      willRenew: false,
      unsubscribeDetectedAt: '2026-09-24T00:00:00.000Z',
    }), 'relay_pro')).toMatchObject({
      isActive: true,
      willRenew: false,
      expirationDate: '2027-09-24T00:00:00.000Z',
    });
  });

  it('returns null when the Relay Pro entitlement has never existed', () => {
    const info = {
      ...customerInfo(),
      entitlements: { all: {}, active: {}, verification: 'NOT_REQUESTED' },
    } as unknown as CustomerInfo;
    expect(subscriptionStateFromCustomerInfo(info, 'relay_pro')).toBeNull();
  });
});
