import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import Purchases from 'react-native-purchases';

import { useAuth } from '@/features/auth/auth-provider';
import { requireSupabase } from '@/lib/supabase';

type BillingStatus = 'loading' | 'ready' | 'unavailable';

type BillingContextValue = {
  status: BillingStatus;
  isPurchaseAvailable: boolean;
  annualPackage: PurchasesPackage | null;
  message: string | null;
  refresh: () => Promise<void>;
  purchase: (selectedPackage: PurchasesPackage, organizationId: string) => Promise<boolean>;
  restore: (organizationId: string) => Promise<boolean>;
};

type ServerEntitlement = {
  hasActiveEntitlement: boolean;
  organizationId: string | null;
  organizationIsPro: boolean;
  expiresAt: string | null;
};

const BillingContext = createContext<BillingContextValue | null>(null);
const ENTITLEMENT_ID = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim() || 'relay_pro';
let configuredUserId: string | null = null;

function platformApiKey() {
  if (Platform.OS === 'android') return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim();
  if (Platform.OS === 'ios') return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim();
  return undefined;
}

function purchaseMessage(error: unknown) {
  const record = error as { userCancelled?: boolean; message?: string } | null;
  if (record?.userCancelled) return null;
  const originalMessage = record?.message ?? '';
  const message = originalMessage.toLocaleLowerCase();
  if (message.includes('already associated') || message.includes('organization owner')) return originalMessage;
  if (message.includes('network')) return 'Check your connection and try again.';
  if (message.includes('not available') || message.includes('configuration')) {
    return 'Relay Pro is not available from this build yet.';
  }
  return 'The purchase could not be completed. No new charge was made.';
}

async function syncServerEntitlement(organizationId?: string): Promise<ServerEntitlement> {
  const result = await requireSupabase().functions.invoke('sync-revenuecat-entitlement', {
    body: { organizationId: organizationId ?? null },
  });
  if (result.error) {
    const context = (result.error as { context?: unknown }).context;
    if (context instanceof Response) {
      const response = await context.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof response?.error === 'string') throw new Error(response.error);
    }
    throw new Error('Relay could not verify your subscription. Please try again.');
  }
  return {
    hasActiveEntitlement: result.data?.hasActiveEntitlement === true,
    organizationId: typeof result.data?.organizationId === 'string' ? result.data.organizationId : null,
    organizationIsPro: result.data?.organizationIsPro === true,
    expiresAt: typeof result.data?.expiresAt === 'string' ? result.data.expiresAt : null,
  };
}

async function requirePurchaseOwner(organizationId: string) {
  const { data, error } = await requireSupabase().rpc('is_organization_admin', { requested_organization_id: organizationId });
  if (error || !data) throw new Error('The Organization Owner must upgrade this Organization.');
}

export function BillingProvider({ children }: PropsWithChildren) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<BillingStatus>('loading');
  const [annualPackage, setAnnualPackage] = useState<PurchasesPackage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const apiKey = platformApiKey();
  const isPurchaseAvailable = Boolean(apiKey && Platform.OS !== 'web');

  const prepareNativeSdk = useCallback(async () => {
    const userId = auth.session?.user.id;
    if (!userId || !apiKey || Platform.OS === 'web') return;
    const configured = await Purchases.isConfigured();
    if (!configured) {
      Purchases.configure({ apiKey, appUserID: userId });
      configuredUserId = userId;
    } else if (configuredUserId !== userId) {
      await Purchases.logIn(userId);
      configuredUserId = userId;
    }
  }, [apiKey, auth.session?.user.id]);

  const refresh = useCallback(async () => {
    if (auth.status !== 'authenticated' || !auth.session?.user.id) {
      setStatus(auth.status === 'loading' ? 'loading' : 'ready');
      setAnnualPackage(null);
      return;
    }
    setMessage(null);
    try {
      await prepareNativeSdk();
      if (isPurchaseAvailable) {
        const offerings = await Purchases.getOfferings();
        setAnnualPackage(offerings.current?.annual ?? null);
      }
      await syncServerEntitlement();
      await queryClient.invalidateQueries({ queryKey: ['relay', 'organization-plan'] });
      setStatus('ready');
    } catch {
      setStatus('unavailable');
      if (isPurchaseAvailable) {
        setMessage('Subscription status could not be refreshed. Organization data remains available.');
      }
    }
  }, [auth.session?.user.id, auth.status, isPurchaseAvailable, prepareNativeSdk, queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (auth.status !== 'anonymous' || !configuredUserId || !isPurchaseAvailable) return;
    configuredUserId = null;
    void Purchases.logOut().catch(() => undefined);
  }, [auth.status, isPurchaseAvailable]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const listener = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void refresh();
    });
    return () => listener.remove();
  }, [refresh]);

  const purchase = useCallback(async (selectedPackage: PurchasesPackage, organizationId: string) => {
    setMessage(null);
    if (!isPurchaseAvailable) {
      setMessage('Open Relay on Android or iOS to purchase Relay Pro.');
      return false;
    }
    let storePurchaseIsActive = false;
    try {
      await requirePurchaseOwner(organizationId);
      await prepareNativeSdk();
      const result = await Purchases.purchasePackage(selectedPackage);
      const hasActiveEntitlement = Boolean(result.customerInfo.entitlements.active[ENTITLEMENT_ID]);
      if (!hasActiveEntitlement) throw new Error('Relay Pro entitlement is not active for this purchase.');
      storePurchaseIsActive = true;
      const server = await syncServerEntitlement(organizationId);
      if (!server.organizationIsPro) throw new Error('Relay Pro could not be associated with this organization.');
      await queryClient.invalidateQueries({ queryKey: ['relay', 'organization-plan'] });
      setStatus('ready');
      return true;
    } catch (error) {
      const safeMessage = purchaseMessage(error);
      if (safeMessage) {
        const associationConflict = safeMessage.toLocaleLowerCase().includes('already associated');
        setMessage(storePurchaseIsActive && !associationConflict
          ? 'Your store purchase is active, but Relay could not connect it to this organization. Try Restore purchases.'
          : safeMessage);
      }
      return false;
    }
  }, [isPurchaseAvailable, prepareNativeSdk, queryClient]);

  const restore = useCallback(async (organizationId: string) => {
    setMessage(null);
    if (!isPurchaseAvailable) {
      setMessage('Open Relay on Android or iOS to restore purchases.');
      return false;
    }
    try {
      await prepareNativeSdk();
      await requirePurchaseOwner(organizationId);
      const customerInfo = await Purchases.restorePurchases();
      const hasActiveEntitlement = Boolean(customerInfo.entitlements.active[ENTITLEMENT_ID]);
      const server = await syncServerEntitlement(organizationId);
      await queryClient.invalidateQueries({ queryKey: ['relay', 'organization-plan'] });
      setStatus('ready');
      if (!hasActiveEntitlement || !server.organizationIsPro) {
        setMessage('No active Relay Pro purchase was found for this organization.');
        return false;
      }
      return true;
    } catch (error) {
      const safeMessage = purchaseMessage(error);
      setMessage(safeMessage?.toLocaleLowerCase().includes('already associated')
        ? safeMessage
        : 'Relay could not restore this organization right now. Check your connection and try again.');
      return false;
    }
  }, [isPurchaseAvailable, prepareNativeSdk, queryClient]);

  const value = useMemo<BillingContextValue>(() => ({
    status,
    isPurchaseAvailable,
    annualPackage,
    message,
    refresh,
    purchase,
    restore,
  }), [
    status,
    isPurchaseAvailable,
    annualPackage,
    message,
    refresh,
    purchase,
    restore,
  ]);

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling() {
  const context = useContext(BillingContext);
  if (!context) throw new Error('useBilling must be used inside BillingProvider.');
  return context;
}
