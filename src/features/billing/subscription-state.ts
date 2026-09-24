import type { CustomerInfo } from 'react-native-purchases';

export type StoreSubscriptionState = {
  isActive: boolean;
  willRenew: boolean;
  expirationDate: string | null;
  managementUrl: string | null;
  store: string;
  unsubscribeDetectedAt: string | null;
};

export function subscriptionStateFromCustomerInfo(
  customerInfo: CustomerInfo,
  entitlementId: string,
): StoreSubscriptionState | null {
  const entitlement = customerInfo.entitlements.all[entitlementId];
  if (!entitlement) return null;
  return {
    isActive: entitlement.isActive,
    willRenew: entitlement.willRenew,
    expirationDate: entitlement.expirationDate,
    managementUrl: customerInfo.managementURL,
    store: entitlement.store,
    unsubscribeDetectedAt: entitlement.unsubscribeDetectedAt,
  };
}
