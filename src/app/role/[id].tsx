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
import { useOrganization, useRole, useRoleHandoffs } from '@/features/relay/queries';
import { useContinuity } from '@/features/relay/continuity';
import { colors, radii, spacing } from '@/theme/tokens';

function titleCase(value: string) {
  return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`;
}

export default function RoleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const roleQuery = useRole(id);
  const organizationQuery = useOrganization(roleQuery.data?.organizationId);
  const handoffsQuery = useRoleHandoffs(id);
  const continuity = useContinuity(roleQuery.data?.organizationId);
  const pending = roleQuery.isPending || handoffsQuery.isPending
    || (roleQuery.data && (organizationQuery.isPending || continuity.isPending));
  const error = roleQuery.error ?? organizationQuery.error ?? handoffsQuery.error ?? continuity.error;

  if (pending) return <Screen><LoadingState label="Opening role…" /></Screen>;
  if (error || !roleQuery.data || !organizationQuery.data || !continuity.data) {
    return (
      <Screen>
        <MessageState
          icon="account-alert-outline"
          title="Role unavailable"
          body={error?.message ?? 'This role does not exist or you do not have access.'}
          actionLabel="Back to organizations"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const role = roleQuery.data;
  const organization = organizationQuery.data;
  const overview = continuity.data?.roles.find(r => r.roleId === id);
  const roleAvailableOnPlan = overview?.planAvailable === true;
  if (!roleAvailableOnPlan) {
    const isOwner = organization.createdBy === auth.session?.user.id;
    return (
      <Screen>
        <MessageState
          icon="lock-outline"
          title="Relay Pro required"
          body={isOwner
            ? `Upgrade ${organization.name} to reopen ${role.title} and its private workspace.`
            : `This Role is preserved but currently locked. Ask the Organization Owner to upgrade ${organization.name}.`}
          actionLabel={isOwner ? 'View Relay Pro' : undefined}
          onAction={isOwner ? () => router.push(`/paywall?reason=role&organizationId=${organization.id}` as Href) : undefined}
        />
      </Screen>
    );
  }
  const handoffs = handoffsQuery.data ?? [];
  const current = handoffs[0];
  const canPlanSuccession = Boolean(continuity.data?.isOwner || overview?.assignments[0]?.userId === auth.session?.user.id);
  const canMaintain = (handoffId: string) => overview?.handoffs.some(h => h.id === handoffId && h.canMaintain);
  const publishedCount = overview?.handoffs.filter(h => h.publicationStatus).length ?? 0;
  const refreshing = roleQuery.isRefetching || organizationQuery.isRefetching
    || handoffsQuery.isRefetching || continuity.isRefetching;
  const refresh = () => void Promise.all([
    roleQuery.refetch(), organizationQuery.refetch(), handoffsQuery.refetch(), continuity.refetch(),
  ]);

  return (
    <Screen scrollProps={{ refreshControl: <RefreshControl refreshing={refreshing} tintColor={colors.moss} onRefresh={refresh} /> }}>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{organization.name.toUpperCase()}</AppText>
        <AppText variant="display">{role.title}</AppText>
        <AppText color={colors.inkMuted}>{role.description || 'Role knowledge stays connected across leaders and service periods.'}</AppText>
      </View>

      {current ? (
        <InfoCard eyebrow={current.servicePeriod} title={current.status === 'published' ? 'Published handoff' : 'Handoff in progress'}>
          <InfoRow label="Status" value={titleCase(current.status)} />
          <InfoRow label="Stage" value={titleCase(current.stage)} />
          <InfoRow label="Updated" value={new Date(current.updatedAt).toLocaleDateString()} />
          {continuity.data?.isOwner ? <Button tone="secondary" label="Inspect approved knowledge" onPress={() => router.push(`/approved-knowledge?handoffId=${current.id}` as Href)} /> : null}
          {canMaintain(current.id) ? <Button
            icon="arrow-right"
            label={current.status === 'published' ? 'Open handoff' : 'Continue handoff'}
            onPress={() => router.push((`/handoff/${current.id}`) as Href)}
          /> : <AppText>Working sources are private to the assigned Role Holder.</AppText>}
        </InfoCard>
      ) : (
        <View style={styles.emptyCard}>
          <View style={styles.icon}><MaterialCommunityIcons color={colors.moss} name="file-document-plus-outline" size={34} /></View>
          <AppText variant="heading">No handoff yet</AppText>
          <AppText color={colors.inkMuted} style={styles.center}>Begin a private draft for this role and its current service period.</AppText>
          <AppText>The Organization Owner assigns a Role Holder to start this workspace.</AppText>
        </View>
      )}

      {handoffs.length ? (
        <>
          <View style={styles.sectionHeading}>
            <AppText variant="heading">Handoff history</AppText>
          </View>
          <View style={styles.historyList}>
            {handoffs.map((handoff) => (
              <Pressable
                accessibilityRole="button"
                key={handoff.id}
                disabled={!canMaintain(handoff.id) && !overview?.handoffs.find(h => h.id === handoff.id)?.publicationStatus}
                onPress={() => router.push((canMaintain(handoff.id) ? `/handoff/${handoff.id}` : `/published-history?handoffId=${handoff.id}`) as Href)}
                style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}>
                <View>
                  <AppText variant="label">{handoff.servicePeriod}</AppText>
                  <AppText variant="caption" color={colors.inkMuted}>{titleCase(handoff.stage)} · {titleCase(handoff.status)}</AppText>
                </View>
                <MaterialCommunityIcons color={colors.inkMuted} name="chevron-right" size={22} />
              </Pressable>
            ))}
          </View>
          {publishedCount ? (
            <Button
              icon="book-open-page-variant-outline"
              label={publishedCount > 1 ? 'Open What Changed' : 'Open Organization Memory'}
              tone="ghost"
              onPress={() => router.push((`/organization-memory?roleId=${role.id}`) as Href)}
            />
          ) : null}
        </>
      ) : null}
      {canPlanSuccession ? (
        <Button
          label={overview?.assignments.length ? `Plan next ${role.title}` : `Assign ${role.title}`}
          tone="secondary"
          onPress={() => router.push(`/role-assignment?roleId=${id}` as Href)}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  emptyCard: {
    alignItems: 'center', gap: spacing.sm, padding: spacing.xl,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
  },
  icon: { width: 64, height: 64, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mossSoft },
  center: { textAlign: 'center' },
  sectionHeading: { gap: spacing.xxs, marginTop: spacing.xl, marginBottom: spacing.sm },
  historyList: { gap: spacing.xs, marginBottom: spacing.lg },
  historyRow: {
    minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.md, backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.78 },
});
