import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useBilling } from '@/features/billing/billing-provider';
import { useAuth } from '@/features/auth/auth-provider';
import { OrganizationMark } from '@/features/relay/organization-mark';
import { useOrganizationPlan, useOrganizations } from '@/features/relay/queries';
import { colors, radii, spacing } from '@/theme/tokens';

const benefits = [
  'Create multiple active roles and handoffs',
  'Keep past handoffs available as institutional history',
  'Use larger document and Ask Relay allowances',
  'Carry approved knowledge across leadership years',
];

const reasonCopy: Record<string, string> = {
  organization: 'A Free account can create one organization. Upgrade an existing organization to continue with another.',
  role: 'A Free organization includes one active role. Upgrade this organization to keep more roles moving.',
  handoff: 'A Free organization includes one current handoff. Upgrade it to create another without removing existing work.',
};

function planDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function storeLabel(store: string | null | undefined) {
  switch (store?.toUpperCase()) {
    case 'PLAY_STORE': return 'Google Play';
    case 'APP_STORE': return 'the App Store';
    case 'TEST_STORE': return 'RevenueCat Test Store';
    default: return 'your store';
  }
}

export default function PaywallScreen() {
  const params = useLocalSearchParams<{ reason?: string; organizationId?: string }>();
  const initialOrganizationId = typeof params.organizationId === 'string' ? params.organizationId : '';
  const reason = typeof params.reason === 'string' ? params.reason : undefined;
  return (
    <PaywallContent
      initialOrganizationId={initialOrganizationId}
      key={`${initialOrganizationId}:${reason ?? ''}`}
      reason={reason}
    />
  );
}

function PaywallContent({
  initialOrganizationId,
  reason,
}: {
  initialOrganizationId: string;
  reason?: string;
}) {
  const billing = useBilling();
  const { session } = useAuth();
  const organizationsQuery = useOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(initialOrganizationId);
  const organizations = organizationsQuery.data ?? [];
  const organizationId = organizations.some((candidate) => candidate.id === selectedOrganizationId)
    ? selectedOrganizationId
    : organizations.length === 1
      ? organizations[0].id
      : '';
  const [busy, setBusy] = useState<'purchase' | 'restore' | 'refresh' | null>(null);
  const organizationPlanQuery = useOrganizationPlan(organizationId || undefined);
  const selectedPackage = billing.annualPackage;
  const contextCopy = reason ? reasonCopy[reason] : undefined;
  const organization = organizationsQuery.data?.find((candidate) => candidate.id === organizationId);
  const isOrganizationPro = organizationPlanQuery.data?.plan === 'pro';
  const isOwner = Boolean(organization && organization.createdBy === session?.user.id);
  const isPurchaser = organizationPlanQuery.data?.isPurchaser === true;
  const subscription = isPurchaser ? billing.subscription : null;
  const expiration = subscription?.expirationDate ?? organizationPlanQuery.data?.expiresAt;
  const expirationLabel = planDate(expiration);
  const willRenew = subscription?.isActive
    ? subscription.willRenew
    : organizationPlanQuery.data?.willRenew;
  const store = subscription?.store ?? organizationPlanQuery.data?.store;
  const testStore = store?.toUpperCase() === 'TEST_STORE' || store?.toLowerCase() === 'test_store';

  function closePaywall() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  async function purchase() {
    if (!selectedPackage || !organizationId || !organization || organization.createdBy !== session?.user.id) return;
    setBusy('purchase');
    try {
      const succeeded = await billing.purchase(selectedPackage, organizationId);
      if (succeeded) await organizationPlanQuery.refetch();
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (!organizationId || !organization || organization.createdBy !== session?.user.id) return;
    setBusy('restore');
    try {
      const succeeded = await billing.restore(organizationId);
      if (succeeded) await organizationPlanQuery.refetch();
    } finally {
      setBusy(null);
    }
  }

  async function refreshStatus() {
    setBusy('refresh');
    try {
      await billing.refresh();
      await organizationPlanQuery.refetch();
    } finally {
      setBusy(null);
    }
  }

  function openStoreManagement(action: 'cancel' | 'renew') {
    const url = subscription?.managementUrl;
    if (!url) return;
    const cancelling = action === 'cancel';
    Alert.alert(
      cancelling ? 'Cancel automatic renewal?' : 'Renew Relay Pro?',
      cancelling
        ? `Relay will open ${storeLabel(store)}. If you cancel renewal there, ${organization?.name ?? 'the organization'} keeps Relay Pro${expirationLabel ? ` until ${expirationLabel}` : ' through the paid period'}.`
        : `Relay will open ${storeLabel(store)} so you can turn automatic renewal back on.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: cancelling ? 'Open subscriptions' : 'Open store',
          onPress: () => void Linking.openURL(url),
        },
      ],
    );
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.mark}>
          <MaterialCommunityIcons color={colors.moss} name="source-branch" size={34} />
        </View>
        <AppText variant="display" style={styles.center}>
          Organization plan
        </AppText>
        <AppText color={colors.inkMuted} style={styles.center}>
          View access, renewal, and store billing for Relay Pro.
        </AppText>
      </View>

      {contextCopy ? (
        <View style={styles.contextNotice}>
          <MaterialCommunityIcons color={colors.moss} name="information-outline" size={20} />
          <AppText style={styles.flex}>{contextCopy}</AppText>
        </View>
      ) : null}

      {organizationsQuery.data && organizationsQuery.data.length > 1 ? (
        <View style={styles.organizationSection}>
          <AppText variant="caption" color={colors.inkMuted} style={styles.sectionLabel}>SELECT ORGANIZATION</AppText>
          <View accessibilityRole="radiogroup" style={styles.organizationList}>
            {organizationsQuery.data.map((candidate) => {
              const isSelected = candidate.id === organizationId;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  key={candidate.id}
                  onPress={() => setSelectedOrganizationId(candidate.id)}
                  style={({ pressed }) => [
                    styles.organizationOption,
                    isSelected && styles.organizationOptionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <OrganizationMark name={candidate.name} logoUrl={candidate.logoUrl} size={40} />
                  <View style={styles.flex}>
                    <AppText variant="label">{candidate.name}</AppText>
                    <AppText variant="caption" color={colors.inkMuted}>{candidate.institution || 'Independent organization'}</AppText>
                  </View>
                  <MaterialCommunityIcons
                    color={isSelected ? colors.moss : colors.inkMuted}
                    name={isSelected ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {organizationsQuery.isPending ? (
        <View style={styles.notice}><AppText color={colors.inkMuted}>Loading organizations…</AppText></View>
      ) : null}
      {organizationsQuery.error ? (
        <View style={styles.errorNotice}>
          <AppText variant="caption" color={colors.emergency}>Organizations could not be loaded. Try this screen again.</AppText>
        </View>
      ) : null}
      {organizationsQuery.data && organizationsQuery.data.length === 0 ? (
        <View style={styles.notice}><AppText color={colors.inkMuted}>Create an organization before choosing Relay Pro.</AppText></View>
      ) : null}
      {organizationId && organizationPlanQuery.isPending ? (
        <View style={styles.notice}><AppText color={colors.inkMuted}>Checking this organization’s plan…</AppText></View>
      ) : null}
      {organizationPlanQuery.error ? (
        <View style={styles.errorNotice}>
          <AppText variant="caption" color={colors.emergency}>This organization’s plan could not be checked. Try again before purchasing.</AppText>
        </View>
      ) : null}

      {organization && organizationPlanQuery.data ? (
        <View style={styles.currentPlan}>
          <View style={styles.currentPlanHeader}>
            <View style={styles.flex}>
              <AppText variant="caption" color={colors.inkMuted}>CURRENT PLAN</AppText>
              <AppText variant="heading">{organization.name}</AppText>
            </View>
            <View style={[styles.statusBadge, isOrganizationPro && styles.statusBadgePro]}>
              <AppText variant="caption" color={isOrganizationPro ? colors.moss : colors.inkMuted}>
                {isOrganizationPro ? 'Relay Pro' : 'Free'}
              </AppText>
            </View>
          </View>
          {isOrganizationPro ? (
            <>
              <AppText variant="label">
                {willRenew === false ? 'Renewal canceled' : willRenew === true ? 'Active · renews automatically' : 'Active'}
              </AppText>
              {expirationLabel ? (
                <AppText color={colors.inkMuted}>
                  {willRenew === false ? `Relay Pro remains active until ${expirationLabel}.` : `Current period ends ${expirationLabel}.`}
                </AppText>
              ) : null}
            </>
          ) : (
            <AppText color={colors.inkMuted}>
              {expirationLabel ? `The previous Relay Pro period ended ${expirationLabel}.` : 'This organization currently uses the Free plan.'}
            </AppText>
          )}
        </View>
      ) : null}

      {isOrganizationPro && organization ? (
        <View style={styles.managementSection}>
          {isPurchaser && subscription?.managementUrl ? (
            <Button
              label={willRenew === false ? 'Renew plan' : 'Cancel plan'}
              tone={willRenew === false ? 'primary' : 'secondary'}
              onPress={() => openStoreManagement(willRenew === false ? 'renew' : 'cancel')}
            />
          ) : null}
          {isPurchaser && testStore ? (
            <View style={styles.notice}>
              <AppText variant="label">Test subscription</AppText>
              <AppText variant="caption" color={colors.inkMuted}>
                RevenueCat Test Store renews annual test plans on an accelerated schedule and expires them automatically. It does not provide a store page for manually cancelling or reactivating renewal.
              </AppText>
            </View>
          ) : null}
          {isPurchaser && !testStore && !subscription?.managementUrl ? (
            <View style={styles.notice}>
              <AppText color={colors.inkMuted}>Open Relay on the purchasing device to manage renewal through its store.</AppText>
            </View>
          ) : null}
          {!isPurchaser ? (
            <View style={styles.notice}>
              <AppText variant="label">Billing stays with the purchaser</AppText>
              <AppText variant="caption" color={colors.inkMuted}>
                The store account that purchased Relay Pro controls cancellation and renewal. Organization ownership does not transfer that billing account.
              </AppText>
            </View>
          ) : null}
          {isPurchaser ? (
            <Button
              disabled={Boolean(busy)}
              label={busy === 'refresh' ? 'Refreshing…' : 'Refresh plan status'}
              tone="ghost"
              onPress={() => void refreshStatus()}
            />
          ) : null}
          <Button label="Back to settings" tone="ghost" onPress={closePaywall} />
        </View>
      ) : null}

      {organization && organizationPlanQuery.data && !isOrganizationPro && !isOwner ? (
        <View style={styles.managementSection}>
          <View style={styles.notice}>
            <AppText variant="label">The Organization Owner manages Relay Pro</AppText>
            <AppText variant="caption" color={colors.inkMuted}>All authorized Role Holders benefit after the Owner upgrades this organization.</AppText>
          </View>
          <Button label="Back to settings" tone="ghost" onPress={closePaywall} />
        </View>
      ) : null}

      {organization && organizationPlanQuery.data && !isOrganizationPro && isOwner ? <View style={styles.benefits}>
        {benefits.map((benefit) => (
          <View key={benefit} style={styles.benefit}>
            <View style={styles.check}>
              <MaterialCommunityIcons color={colors.moss} name="check" size={18} />
            </View>
            <AppText style={styles.flex}>{benefit}</AppText>
          </View>
        ))}
      </View> : null}

      {organization && organizationPlanQuery.data && !isOrganizationPro && isOwner ? <View style={[styles.plan, !selectedPackage && styles.planUnavailable]}>
        <View style={styles.annualIcon}>
          <MaterialCommunityIcons color={colors.moss} name="calendar-check-outline" size={22} />
        </View>
        <View style={styles.flex}>
          <AppText variant="caption" color={colors.moss} style={styles.annualLabel}>ANNUAL RELAY PRO</AppText>
          <AppText variant="heading">{selectedPackage?.product.priceString ?? 'Annual subscription'}</AppText>
          <AppText variant="caption" color={colors.inkMuted}>One subscription for the full academic year</AppText>
        </View>
      </View> : null}

      {billing.status === 'loading' ? (
        <View style={styles.notice}><AppText color={colors.inkMuted}>Checking available plans…</AppText></View>
      ) : null}
      {!billing.isPurchaseAvailable ? (
        <View style={styles.notice}>
          <AppText variant="label">Purchases open in the Android or iOS app</AppText>
          <AppText variant="caption" color={colors.inkMuted}>
            Recipient links remain free and do not require the Relay app.
          </AppText>
        </View>
      ) : null}
      {billing.message ? (
        <View accessibilityLiveRegion="polite" style={styles.errorNotice}>
          <AppText variant="caption" color={colors.emergency}>{billing.message}</AppText>
        </View>
      ) : null}

      {organization && organizationPlanQuery.data && !isOrganizationPro && isOwner ? <Button
        disabled={
          !organizationId
          || !organization
          || !selectedPackage
          || organizationPlanQuery.isPending
          || organizationPlanQuery.isError
          || Boolean(busy)
        }
        label={busy === 'purchase'
          ? 'Completing purchase…'
          : organizationPlanQuery.data.expiresAt
            ? `Renew ${organization.name} · annual`
            : `Upgrade ${organization.name} · annual`}
        onPress={() => void purchase()}
      /> : null}
      {organization && organizationPlanQuery.data && !isOrganizationPro && isOwner ? <Button
        disabled={!organizationId || !organization || !billing.isPurchaseAvailable || Boolean(busy)}
        label={busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
        tone="ghost"
        onPress={() => void restore()}
      /> : null}
      {organization && organizationPlanQuery.data && !isOrganizationPro && isOwner ? <AppText variant="caption" color={colors.inkMuted} style={styles.center}>
        Existing handoffs are never deleted if Relay Pro ends. Recipients are never paywalled.
      </AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  mark: {
    width: 72, height: 72, alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center', borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  center: { textAlign: 'center' },
  flex: { flex: 1 },
  contextNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginBottom: spacing.md, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  organizationSection: { gap: spacing.xs, marginBottom: spacing.md },
  sectionLabel: { letterSpacing: 1.1 },
  organizationList: { gap: spacing.xs },
  organizationOption: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.md, backgroundColor: colors.surface,
  },
  organizationOptionSelected: { borderColor: colors.moss, backgroundColor: colors.mossSoft },
  currentPlan: {
    gap: spacing.sm, marginBottom: spacing.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  currentPlanHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statusBadge: {
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radii.pill, backgroundColor: colors.canvas,
  },
  statusBadgePro: { backgroundColor: colors.mossSoft },
  managementSection: { gap: spacing.sm },
  benefits: {
    gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  check: {
    width: 34, height: 34, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  plan: {
    minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    marginVertical: spacing.lg,
    padding: spacing.md, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.lg, backgroundColor: colors.mossSoft,
  },
  planUnavailable: { opacity: 0.6 },
  annualIcon: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: colors.surface,
  },
  annualLabel: { letterSpacing: 1.1 },
  notice: { gap: spacing.xs, marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.saffronSoft },
  errorNotice: { marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1' },
  pressed: { opacity: 0.78 },
});
