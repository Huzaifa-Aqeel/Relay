import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { useBilling } from '@/features/billing/billing-provider';
import { OrganizationMark } from '@/features/relay/organization-mark';
import { useOrganizationPlan, useOrganizations } from '@/features/relay/queries';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

type DisplayPlan = 'free' | 'plus';
type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const freeFeatures: Array<{ icon: IconName; label: string }> = [
  { icon: 'account-tie-outline', label: 'One designated Role' },
  { icon: 'file-document-edit-outline', label: 'One current living Handoff' },
  { icon: 'source-branch', label: 'Capture, Review, Handoff check, and Publish' },
  { icon: 'message-question-outline', label: '10 Ask Relay questions per published Handoff each day' },
  { icon: 'archive-check-outline', label: 'Existing knowledge and publications stay preserved' },
];

const plusFeatures: Array<{ icon: IconName; label: string }> = [
  { icon: 'account-group-outline', label: 'Multiple active Roles and authorized Role Holders' },
  { icon: 'bookshelf', label: 'Current and historical Handoffs across the organization' },
  { icon: 'compare-horizontal', label: 'Organization Memory and year-to-year comparison' },
  { icon: 'transit-connection-variant', label: 'Approved knowledge carried into the next service period' },
  { icon: 'database-arrow-up-outline', label: 'Larger document and Ask Relay allowances' },
];

const reasonCopy: Record<string, string> = {
  organization: 'A Free account can create one organization. Upgrade an existing organization to continue with another.',
  role: 'A Free organization includes one active Role. Plus keeps additional Roles moving.',
  handoff: 'A Free organization includes one current Handoff. Plus supports additional Role workspaces without removing existing work.',
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

function PaywallContent({ initialOrganizationId, reason }: {
  initialOrganizationId: string;
  reason?: string;
}) {
  const billing = useBilling();
  const { session } = useAuth();
  const organizationsQuery = useOrganizations();
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(initialOrganizationId);
  const [selectedPlan, setSelectedPlan] = useState<DisplayPlan | null>(reason ? 'plus' : null);
  const [busy, setBusy] = useState<'purchase' | 'restore' | 'refresh' | null>(null);
  const organizations = organizationsQuery.data ?? [];
  const organizationId = organizations.some((candidate) => candidate.id === selectedOrganizationId)
    ? selectedOrganizationId
    : organizations.length === 1
      ? organizations[0].id
      : '';
  const organizationPlanQuery = useOrganizationPlan(organizationId || undefined);
  const selectedPackage = billing.annualPackage;
  const organization = organizations.find((candidate) => candidate.id === organizationId);
  const isOrganizationPlus = organizationPlanQuery.data?.plan === 'pro';
  const displayedPlan: DisplayPlan = selectedPlan ?? (isOrganizationPlus ? 'plus' : 'free');
  const isOwner = Boolean(organization && organization.createdBy === session?.user.id);
  const isPurchaser = organizationPlanQuery.data?.isPurchaser === true;
  const subscription = isPurchaser ? billing.subscription : null;
  const expiration = subscription?.expirationDate ?? organizationPlanQuery.data?.expiresAt;
  const expirationLabel = planDate(expiration);
  const willRenew = subscription?.isActive ? subscription.willRenew : organizationPlanQuery.data?.willRenew;
  const store = subscription?.store ?? organizationPlanQuery.data?.store;
  const testStore = store?.toUpperCase() === 'TEST_STORE' || store?.toLowerCase() === 'test_store';
  const contextCopy = reason ? reasonCopy[reason] : undefined;
  const plusPrice = selectedPackage?.product.priceString;
  const plusCurrency = selectedPackage?.product.currencyCode;

  useEffect(() => {
    setSelectedPlan(reason ? 'plus' : null);
  }, [organizationId, reason]);

  function closePaywall() {
    if (router.canGoBack()) router.back();
    else router.replace('/settings');
  }

  async function purchase() {
    if (!selectedPackage || !organizationId || !organization || organization.createdBy !== session?.user.id) return;
    setBusy('purchase');
    try {
      const succeeded = await billing.purchase(selectedPackage, organizationId);
      if (succeeded) {
        await organizationPlanQuery.refetch();
        setSelectedPlan('plus');
      }
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (!organizationId || !organization || organization.createdBy !== session?.user.id) return;
    setBusy('restore');
    try {
      const succeeded = await billing.restore(organizationId);
      if (succeeded) {
        await organizationPlanQuery.refetch();
        setSelectedPlan('plus');
      }
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
      cancelling ? 'Cancel automatic renewal?' : 'Renew Relay Plus?',
      cancelling
        ? `Relay will open ${storeLabel(store)}. If you cancel renewal there, ${organization?.name ?? 'the organization'} keeps Plus${expirationLabel ? ` until ${expirationLabel}` : ' through the paid period'}.`
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

  const currentPlan = isOrganizationPlus ? 'plus' : 'free';
  const viewingCurrentPlan = displayedPlan === currentPlan;
  const features = displayedPlan === 'plus' ? plusFeatures : freeFeatures;

  return (
    <Screen>
      <View style={styles.hero}>
        <AppText variant="display" style={styles.center}>Organization plan</AppText>
        <AppText color={colors.inkMuted} style={styles.center}>
          Choose the level of continuity your organization needs.
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
            {organizations.map((candidate) => {
              const selected = candidate.id === organizationId;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={candidate.id}
                  onPress={() => setSelectedOrganizationId(candidate.id)}
                  style={({ pressed }) => [
                    styles.organizationOption,
                    selected && styles.organizationOptionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <OrganizationMark name={candidate.name} logoUrl={candidate.logoUrl} size={40} />
                  <View style={styles.flex}>
                    <AppText variant="label">{candidate.name}</AppText>
                    <AppText variant="caption" color={colors.inkMuted}>{candidate.institution || 'Independent organization'}</AppText>
                  </View>
                  <MaterialCommunityIcons
                    color={selected ? colors.moss : colors.inkMuted}
                    name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {organizationsQuery.isPending ? <PlanNotice text="Loading organizations…" /> : null}
      {organizationsQuery.error ? <PlanError text="Organizations could not be loaded. Try this screen again." /> : null}
      {organizationsQuery.data && organizationsQuery.data.length === 0 ? (
        <PlanNotice text="Create an organization before choosing a plan." />
      ) : null}
      {organizationId && organizationPlanQuery.isPending ? <PlanNotice text="Checking this organization’s plan…" /> : null}
      {organizationPlanQuery.error ? <PlanError text="This organization’s plan could not be checked. Try again before purchasing." /> : null}

      {organization && organizationPlanQuery.data ? (
        <>
          <View accessibilityRole="tablist" style={styles.planToggle}>
            {(['free', 'plus'] as const).map((plan) => {
              const selected = displayedPlan === plan;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  key={plan}
                  onPress={() => setSelectedPlan(plan)}
                  style={({ pressed }) => [
                    styles.planToggleOption,
                    selected && styles.planToggleOptionSelected,
                    pressed && styles.pressed,
                  ]}>
                  <AppText variant="label" color={selected ? colors.white : colors.inkMuted}>
                    {plan === 'free' ? 'Free' : 'Plus'}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <View style={[styles.planCard, displayedPlan === 'plus' && styles.plusCard]}>
            <View style={styles.planHeader}>
              <View style={styles.flex}>
                <AppText variant="label" color={colors.moss}>{displayedPlan === 'plus' ? 'PLUS' : 'FREE'}</AppText>
                <AppText variant="display">
                  {displayedPlan === 'plus' ? 'Keep every Role moving' : 'Start with one Role'}
                </AppText>
              </View>
              {viewingCurrentPlan ? (
                <View style={styles.currentBadge}>
                  <MaterialCommunityIcons color={colors.moss} name="check" size={16} />
                  <AppText variant="caption" color={colors.moss}>Current</AppText>
                </View>
              ) : null}
            </View>

            <AppText color={colors.inkMuted}>
              {displayedPlan === 'plus'
                ? 'Preserve knowledge across the whole organization and every leadership transition.'
                : 'Complete one reliable Handoff with Relay’s full Capture, Review, and publishing workflow.'}
            </AppText>

            <View style={styles.priceRow}>
              <AppText style={styles.price}>
                {displayedPlan === 'plus' ? plusPrice ?? '—' : '$0'}
              </AppText>
              <AppText color={colors.inkMuted}>
                {displayedPlan === 'plus' && plusCurrency ? `${plusCurrency} / year` : 'USD / year'}
              </AppText>
            </View>

            {displayedPlan === 'plus' && !plusPrice ? (
              <AppText variant="caption" color={colors.inkMuted}>
                {billing.status === 'loading'
                  ? 'Loading the annual price from RevenueCat…'
                  : 'The annual price is available in the Android or iOS app.'}
              </AppText>
            ) : null}

            {displayedPlan === 'free' ? (
              <Button
                disabled
                label={viewingCurrentPlan ? 'Your current plan' : 'Available when Plus ends'}
                tone="secondary"
              />
            ) : isOrganizationPlus ? (
              <Button disabled label="Your current plan" tone="secondary" />
            ) : isOwner ? (
              <Button
                disabled={!selectedPackage || organizationPlanQuery.isPending || Boolean(busy)}
                label={busy === 'purchase' ? 'Completing purchase…' : `Upgrade ${organization.name}`}
                onPress={() => void purchase()}
              />
            ) : (
              <Button disabled label="Organization Owner upgrades" tone="secondary" />
            )}

            {displayedPlan === 'plus' && isOrganizationPlus ? (
              <View style={styles.planStatus}>
                <AppText variant="label">
                  {willRenew === false ? 'Renewal canceled' : willRenew === true ? 'Active · renews yearly' : 'Active'}
                </AppText>
                {expirationLabel ? (
                  <AppText variant="caption" color={colors.inkMuted}>
                    {willRenew === false ? `Plus remains active until ${expirationLabel}.` : `Current yearly period ends ${expirationLabel}.`}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            <View style={styles.divider} />
            <AppText variant="heading">{displayedPlan === 'plus' ? 'Everything your organization needs' : 'Start with the essentials'}</AppText>
            <View style={styles.featureList}>
              {features.map((feature) => (
                <View key={feature.label} style={styles.featureRow}>
                  <MaterialCommunityIcons color={colors.moss} name={feature.icon} size={22} />
                  <AppText style={styles.flex}>{feature.label}</AppText>
                </View>
              ))}
            </View>
          </View>

          {displayedPlan === 'plus' && isOrganizationPlus ? (
            <View style={styles.managementSection}>
              {isPurchaser && subscription?.managementUrl ? (
                <Button
                  label={willRenew === false ? 'Renew plan' : 'Cancel plan'}
                  tone={willRenew === false ? 'primary' : 'secondary'}
                  onPress={() => openStoreManagement(willRenew === false ? 'renew' : 'cancel')}
                />
              ) : null}
              {isPurchaser && !testStore && !subscription?.managementUrl ? (
                <PlanNotice text="Open Relay on the purchasing device to manage renewal through its store." />
              ) : null}
              {isPurchaser ? (
                <Button
                  disabled={Boolean(busy)}
                  label={busy === 'refresh' ? 'Refreshing…' : 'Refresh plan status'}
                  tone="ghost"
                  onPress={() => void refreshStatus()}
                />
              ) : null}
            </View>
          ) : null}

          {displayedPlan === 'plus' && !isOrganizationPlus && isOwner ? (
            <View style={styles.managementSection}>
              {billing.status === 'loading' ? <PlanNotice text="Checking the yearly Plus plan…" /> : null}
              {!billing.isPurchaseAvailable ? (
                <PlanNotice text="Purchases open in the Android or iOS app. Recipient links remain free." />
              ) : null}
              {billing.message ? <PlanError text={billing.message} /> : null}
              <Button
                disabled={!billing.isPurchaseAvailable || Boolean(busy)}
                label={busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
                tone="ghost"
                onPress={() => void restore()}
              />
            </View>
          ) : null}

          {displayedPlan === 'plus' && !isOrganizationPlus && !isOwner ? (
            <AppText color={colors.inkMuted} style={styles.center}>
            </AppText>
          ) : null}

        </>
      ) : null}

      <Button label="Back to settings" tone="ghost" onPress={closePaywall} />
    </Screen>
  );
}

function PlanNotice({ text }: { text: string }) {
  return <View style={styles.notice}><AppText color={colors.inkMuted}>{text}</AppText></View>;
}

function PlanError({ text }: { text: string }) {
  return <View style={styles.errorNotice}><AppText variant="caption" color={colors.emergency}>{text}</AppText></View>;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
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
  planToggle: {
    flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 360,
    marginBottom: spacing.md, padding: spacing.xxs,
    borderRadius: radii.pill, backgroundColor: colors.surfaceMuted,
  },
  planToggleOption: {
    flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill,
  },
  planToggleOptionSelected: { backgroundColor: colors.moss },
  planCard: {
    gap: spacing.lg, padding: spacing.lg, marginBottom: spacing.md,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg,
    backgroundColor: colors.surface, ...shadow,
  },
  plusCard: { borderColor: colors.moss },
  planHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  currentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xxs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  price: { color: colors.ink, fontSize: 42, lineHeight: 50, fontWeight: '600' },
  planStatus: { gap: spacing.xxs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  divider: { height: 1, backgroundColor: colors.line },
  featureList: { gap: spacing.md },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  managementSection: { gap: spacing.sm, marginBottom: spacing.md },
  notice: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.saffronSoft },
  errorNotice: { padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1' },
  pressed: { opacity: 0.78 },
});
