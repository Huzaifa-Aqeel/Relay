import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useBilling } from '@/features/billing/billing-provider';
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

export default function PaywallScreen() {
  const params = useLocalSearchParams<{ reason?: string; organizationId?: string }>();
  const billing = useBilling();
  const organizationsQuery = useOrganizations();
  const [organizationId, setOrganizationId] = useState(
    typeof params.organizationId === 'string' ? params.organizationId : '',
  );
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const organizationPlanQuery = useOrganizationPlan(organizationId || undefined);
  const selectedPackage = billing.annualPackage;
  const contextCopy = typeof params.reason === 'string' ? reasonCopy[params.reason] : undefined;
  const organization = organizationsQuery.data?.find((candidate) => candidate.id === organizationId);
  const isOrganizationPro = organizationPlanQuery.data?.plan === 'pro';

  useEffect(() => {
    const organizations = organizationsQuery.data;
    if (!organizations?.length) return;
    const requested = typeof params.organizationId === 'string' ? params.organizationId : '';
    if (requested && organizations.some((candidate) => candidate.id === requested)) {
      setOrganizationId(requested);
      return;
    }
    if (organizations.length === 1) setOrganizationId(organizations[0].id);
    else if (organizationId && !organizations.some((candidate) => candidate.id === organizationId)) setOrganizationId('');
  }, [organizationId, organizationsQuery.data, params.organizationId]);
  async function purchase() {
    if (!selectedPackage || !organizationId || !organization) return;
    setBusy('purchase');
    const succeeded = await billing.purchase(selectedPackage, organizationId);
    if (succeeded) await organizationPlanQuery.refetch();
    setBusy(null);
    if (succeeded) router.back();
  }

  async function restore() {
    if (!organizationId || !organization) return;
    setBusy('restore');
    const succeeded = await billing.restore(organizationId);
    if (succeeded) await organizationPlanQuery.refetch();
    setBusy(null);
    if (succeeded) router.back();
  }

  if (isOrganizationPro && organization) {
    return (
      <Screen contentStyle={styles.completedScreen}>
        <View style={styles.mark}><MaterialCommunityIcons color={colors.moss} name="check-decagram" size={34} /></View>
        <AppText variant="display" style={styles.center}>{organization.name} has Relay Pro</AppText>
        <AppText color={colors.inkMuted} style={styles.center}>
          Multiple roles, handoffs, history, and larger Relay allowances are active for this organization.
        </AppText>
        <Button label="Continue" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.mark}>
          <MaterialCommunityIcons color={colors.moss} name="source-branch" size={34} />
        </View>
        <AppText variant="display" style={styles.center}>
          {organization ? `Upgrade ${organization.name} to Relay Pro` : 'Choose an organization for Relay Pro'}
        </AppText>
        <AppText color={colors.inkMuted} style={styles.center}>
          Preserve your organization’s knowledge for the academic year.
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
          <AppText variant="caption" color={colors.inkMuted} style={styles.sectionLabel}>UPGRADE THIS ORGANIZATION</AppText>
          <View accessibilityRole="radiogroup" style={styles.organizationList}>
            {organizationsQuery.data.map((candidate) => {
              const isSelected = candidate.id === organizationId;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  key={candidate.id}
                  onPress={() => setOrganizationId(candidate.id)}
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
        <View style={styles.notice}><AppText color={colors.inkMuted}>Checking this organization's plan…</AppText></View>
      ) : null}
      {organizationPlanQuery.error ? (
        <View style={styles.errorNotice}>
          <AppText variant="caption" color={colors.emergency}>This organization's plan could not be checked. Try again before purchasing.</AppText>
        </View>
      ) : null}

      <View style={styles.benefits}>
        {benefits.map((benefit) => (
          <View key={benefit} style={styles.benefit}>
            <View style={styles.check}>
              <MaterialCommunityIcons color={colors.moss} name="check" size={18} />
            </View>
            <AppText style={styles.flex}>{benefit}</AppText>
          </View>
        ))}
      </View>

      <View style={[styles.plan, !selectedPackage && styles.planUnavailable]}>
        <View style={styles.annualIcon}>
          <MaterialCommunityIcons color={colors.moss} name="calendar-check-outline" size={22} />
        </View>
        <View style={styles.flex}>
          <AppText variant="caption" color={colors.moss} style={styles.annualLabel}>ANNUAL RELAY PRO</AppText>
          <AppText variant="heading">{selectedPackage?.product.priceString ?? 'Annual subscription'}</AppText>
          <AppText variant="caption" color={colors.inkMuted}>One subscription for the full academic year</AppText>
        </View>
      </View>

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

      <Button
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
          : organization ? `Upgrade ${organization.name} · annual` : 'Choose an organization'}
        onPress={() => void purchase()}
      />
      <Button
        disabled={!organizationId || !organization || !billing.isPurchaseAvailable || Boolean(busy)}
        label={busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
        tone="ghost"
        onPress={() => void restore()}
      />
      <AppText variant="caption" color={colors.inkMuted} style={styles.center}>
        Existing handoffs are never deleted if Relay Pro ends. Recipients are never paywalled.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  completedScreen: { justifyContent: 'center', gap: spacing.md },
  hero: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.lg },
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
