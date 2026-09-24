import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { useBilling } from '@/features/billing/billing-provider';
import { useOrganizationPlan, useOrganizations } from '@/features/relay/queries';
import type { Organization } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

function OrganizationPlanStatus({ organization }: { organization: Organization }) {
  const plan = useOrganizationPlan(organization.id);
  const label = plan.isPending
    ? 'Checking…'
    : plan.data?.plan === 'pro'
      ? 'Relay Pro'
      : plan.error
        ? 'Unavailable'
        : 'Free';
  const isPro = plan.data?.plan === 'pro';
  return (
    <View style={styles.planStatusRow}>
      <AppText variant="label" style={styles.rowCopy} numberOfLines={1}>{organization.name}</AppText>
      <View style={[styles.planStatusBadge, isPro && styles.planStatusBadgePro]}>
        <AppText variant="caption" color={isPro ? colors.moss : colors.inkMuted}>{label}</AppText>
      </View>
    </View>
  );
}

function SettingRow({
  icon,
  title,
  detail,
  onPress,
  destructive,
}: {
  icon: IconName;
  title: string;
  detail?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}>
      <View style={styles.rowIcon}>
        <MaterialCommunityIcons color={destructive ? colors.emergency : colors.moss} name={icon} size={21} />
      </View>
      <View style={styles.rowCopy}>
        <AppText variant="label" color={destructive ? colors.emergency : colors.ink}>{title}</AppText>
        {detail ? <AppText variant="caption" color={colors.inkMuted}>{detail}</AppText> : null}
      </View>
      {onPress ? <MaterialCommunityIcons color={colors.inkMuted} name="chevron-right" size={22} /> : null}
    </Pressable>
  );
}

export default function SettingsScreen() {
  const auth = useAuth();
  const billing = useBilling();
  const organizations = useOrganizations();
  const [showDelete, setShowDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const displayName = auth.session?.user.user_metadata.display_name as string | undefined;
  const email = auth.session?.user.email;
  const canManagePlan = organizations.data?.some(
    (organization) => organization.createdBy === auth.session?.user.id,
  ) || billing.subscription?.isActive === true;

  async function signOut() {
    if (auth.status === 'demo') {
      router.push('/auth/welcome');
      return;
    }
    setBusy(true);
    setAccountError(null);
    try {
      await auth.signOut();
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Sign-out did not complete.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    setBusy(true);
    setAccountError(null);
    try {
      await auth.deleteAccount();
      setShowDelete(false);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : 'Account deletion did not complete.');
      setShowDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Screen safeTop>
        <View style={styles.headingBlock}>
          <AppText variant="display">Settings</AppText>
          <AppText color={colors.inkMuted}>Your account, plan, and privacy.</AppText>
        </View>

        <Pressable onPress={() => router.push('/paywall')} style={({ pressed }) => [styles.planCard, pressed && styles.pressed]}>
          <View style={styles.planBadge}>
            <MaterialCommunityIcons color={colors.moss} name="star-four-points-outline" size={18} />
            <AppText variant="caption" color={colors.moss}>ORGANIZATION PLAN</AppText>
          </View>
          <AppText variant="heading">Organization plans</AppText>
          <AppText color={colors.inkMuted}>
            Relay Pro is shared by authorized Role Holders in your organization.
          </AppText>
          {organizations.data?.length ? (
            <View style={styles.planStatuses}>
              {organizations.data.map((organization) => (
                <OrganizationPlanStatus key={organization.id} organization={organization} />
              ))}
            </View>
          ) : null}
          <View style={styles.planLink}>
            <AppText variant="label" color={colors.moss}>{canManagePlan ? 'Manage plan' : 'View plan'}</AppText>
            <MaterialCommunityIcons color={colors.moss} name="arrow-right" size={20} />
          </View>
        </Pressable>

        <AppText variant="caption" color={colors.inkMuted} style={styles.sectionLabel}>ACCOUNT</AppText>
        <View style={styles.group}>
          <SettingRow
            icon="account-outline"
            title={displayName || (auth.status === 'demo' ? 'Local preview' : 'Relay member')}
            detail={email || (auth.status === 'demo' ? 'Cloud account not connected' : undefined)}
          />
          <SettingRow icon="logout" title={busy ? 'Working…' : 'Sign out'} onPress={busy ? undefined : () => void signOut()} />
        </View>

        <AppText variant="caption" color={colors.inkMuted} style={styles.sectionLabel}>SUPPORT & PRIVACY</AppText>
        <View style={styles.group}>
          <SettingRow icon="file-document-outline" title="Privacy policy" onPress={() => router.push('/legal/privacy')} />
          <SettingRow icon="file-sign" title="Terms of use" onPress={() => router.push('/legal/terms')} />
          <SettingRow
            destructive
            icon="delete-outline"
            title="Delete account"
            onPress={auth.status === 'authenticated' ? () => setShowDelete(true) : undefined}
          />
        </View>

        {accountError ? (
          <View style={styles.errorBanner}>
            <AppText variant="caption" color={colors.emergency}>{accountError}</AppText>
          </View>
        ) : null}
      </Screen>

      <Modal animationType="fade" onRequestClose={() => setShowDelete(false)} transparent visible={showDelete}>
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.modalCard}>
            <View style={styles.deleteIcon}>
              <MaterialCommunityIcons color={colors.emergency} name="delete-alert-outline" size={30} />
            </View>
            <AppText variant="heading">Delete your Relay account?</AppText>
            <AppText color={colors.inkMuted}>
              This permanently removes your account and personal data. An organization with other members must have another owner before its creator can leave.
            </AppText>
            <View style={styles.modalActions}>
              <Button disabled={busy} label={busy ? 'Deleting…' : 'Delete account'} tone="emergency" onPress={() => void deleteAccount()} />
              <Button disabled={busy} label="Keep my account" tone="secondary" onPress={() => setShowDelete(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  headingBlock: { marginBottom: spacing.lg, gap: spacing.xxs },
  planCard: {
    gap: spacing.xs, padding: spacing.md + spacing.xxs / 2, borderRadius: radii.lg,
    backgroundColor: colors.mossSoft, borderWidth: 1, borderColor: '#BED1C3',
  },
  planBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  planStatuses: { gap: spacing.xs, marginTop: spacing.xs },
  planStatusRow: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surface,
  },
  planStatusBadge: {
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
    borderRadius: radii.pill, backgroundColor: colors.canvas,
  },
  planStatusBadgePro: { backgroundColor: colors.mossSoft },
  planLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  sectionLabel: { marginTop: spacing.xl, marginBottom: spacing.xs, letterSpacing: 1.2 },
  group: {
    overflow: 'hidden', borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  row: {
    minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  rowIcon: {
    width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  rowCopy: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.75 },
  errorBanner: {
    marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md,
    borderWidth: 1, borderColor: '#E4B5AE', backgroundColor: '#FFF5F2',
  },
  modalBackdrop: {
    flex: 1, justifyContent: 'center', padding: spacing.lg,
    backgroundColor: 'rgba(22,20,17,0.48)',
  },
  modalCard: {
    width: '100%', maxWidth: 520, alignSelf: 'center', gap: spacing.md,
    padding: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  deleteIcon: {
    width: 58, height: 58, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: '#F6DDD9',
  },
  modalActions: { gap: spacing.sm, marginTop: spacing.sm },
});
