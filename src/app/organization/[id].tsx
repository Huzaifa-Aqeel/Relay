import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { InfoCard, InfoRow } from '@/components/ui/info-card';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { OrganizationMark } from '@/features/relay/organization-mark';
import { useContinuity } from '@/features/relay/continuity';
import { useOrganization, useOrganizationHandoffs, useRoles } from '@/features/relay/queries';
import type { Handoff } from '@/features/relay/types';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

export default function OrganizationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const organizationQuery = useOrganization(id);
  const continuity = useContinuity(id);
  const rolesQuery = useRoles(id);
  const handoffsQuery = useOrganizationHandoffs(id);
  const pending = organizationQuery.isPending || rolesQuery.isPending || handoffsQuery.isPending;
  const error = organizationQuery.error ?? rolesQuery.error ?? handoffsQuery.error;

  if (pending) return <Screen><LoadingState label="Opening organization…" /></Screen>;
  if (error || !organizationQuery.data) {
    return (
      <Screen>
        <MessageState
          icon="office-building-remove-outline"
          title="Organization unavailable"
          body={error?.message ?? 'This organization does not exist or you do not have access.'}
          actionLabel="Back to organizations"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const organization = organizationQuery.data;
  const roles = rolesQuery.data ?? [];
  const handoffs = handoffsQuery.data ?? [];
  const latestByRole = new Map<string, Handoff>();
  for (const handoff of handoffs) if (!latestByRole.has(handoff.roleId)) latestByRole.set(handoff.roleId, handoff);
  const drafts = handoffs.filter((handoff) => handoff.status === 'draft').length;
  const published = handoffs.filter((handoff) => handoff.status === 'published').length;
  const refreshing = organizationQuery.isRefetching || rolesQuery.isRefetching || handoffsQuery.isRefetching;
  const refresh = () => void Promise.all([organizationQuery.refetch(), rolesQuery.refetch(), handoffsQuery.refetch()]);

  return (
    <Screen scrollProps={{ refreshControl: <RefreshControl refreshing={refreshing} tintColor={colors.moss} onRefresh={refresh} /> }}>
      <View style={styles.headingRow}>
        <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} size={72} />
        <View style={styles.headingCopy}>
          <AppText variant="display">{organization.name}</AppText>
          <AppText color={colors.inkMuted}>{organization.institution || 'Independent organization'}</AppText>
        </View>
      </View>
      {organization.description ? <AppText color={colors.inkMuted} style={styles.description}>{organization.description}</AppText> : null}

      <InfoCard eyebrow="At a glance" title="Leadership continuity">
        <InfoRow label="Roles" value={String(roles.length)} />
        <InfoRow label="Current drafts" value={String(drafts)} />
        <InfoRow label="Published" value={String(published)} />
      </InfoCard>

      <View style={styles.sectionHeadingRow}>
        <View style={styles.sectionHeadingCopy}>
          <AppText variant="heading">Roles</AppText>
          <AppText color={colors.inkMuted}>Each role keeps its handoff history across service periods.</AppText>
        </View>
        {roles.length && continuity.data?.isOwner ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add role"
            onPress={() => router.push((`/role-new?organizationId=${organization.id}`) as Href)}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons color={colors.moss} name="plus" size={23} />
          </Pressable>
        ) : null}
      </View>

      {roles.length ? (
        <View style={styles.roleList}>
          {roles.map((role) => {
            const latest = latestByRole.get(role.id);
            const overview = continuity.data?.roles.find(r => r.roleId === role.id);
            const holder = overview?.assignments[0];
            const canOpenRole = Boolean(
              continuity.data?.isOwner
              || overview?.assignments.some(assignment => assignment.userId === auth.session?.user.id),
            );
            return (
              <Pressable
                accessibilityRole={canOpenRole ? 'button' : undefined}
                disabled={!canOpenRole}
                key={role.id}
                onPress={canOpenRole ? () => router.push((`/role/${role.id}`) as Href) : undefined}
                style={({ pressed }) => [styles.roleCard, canOpenRole && pressed && styles.pressed]}>
                <View style={styles.roleIcon}><MaterialCommunityIcons color={colors.moss} name="account-tie-outline" size={25} /></View>
                <View style={styles.roleCopy}>
                  <AppText variant="heading">{role.title}</AppText>
                  <AppText variant="caption" color={colors.inkMuted}>{latest?.servicePeriod ?? 'No handoff yet'}</AppText>
                  <AppText variant="caption">{holder?.name || 'No assigned holder'}</AppText>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}><MaterialCommunityIcons color={colors.moss} name="account-tie-outline" size={34} /></View>
          <AppText variant="heading">Add the first role</AppText>
          <AppText color={colors.inkMuted} style={styles.center}>Start with a position whose knowledge should survive its current leader.</AppText>
          {continuity.data?.isOwner ? <Button icon="plus" label="Add role" onPress={() => router.push((`/role-new?organizationId=${organization.id}`) as Href)} /> : null}
        </View>
      )}
      {continuity.data?.isOwner || continuity.data?.pendingTransfer ? <Button tone="secondary" label="Organization ownership" onPress={() => router.push(`/ownership-transfer?organizationId=${id}` as Href)} /> : null}
      {continuity.error ? <AppText>{continuity.error.message}</AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headingCopy: { flex: 1, gap: spacing.xxs },
  description: { marginTop: spacing.sm, marginBottom: spacing.lg },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, marginBottom: spacing.sm },
  sectionHeadingCopy: { flex: 1, gap: spacing.xxs },
  addButton: {
    width: 46, height: 46, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  roleList: { gap: spacing.sm },
  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, borderRadius: radii.lg, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.surface, ...shadow,
  },
  roleIcon: { width: 48, height: 48, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mossSoft },
  roleCopy: { flex: 1, gap: spacing.xxs },
  emptyCard: {
    alignItems: 'center', gap: spacing.sm, padding: spacing.xl,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  emptyIcon: { width: 64, height: 64, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mossSoft },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
