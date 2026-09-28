import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import {
  useCompareRoleHandoffs,
  useOrganization,
  useRole,
  useRolePublications,
  useOrganizationPlan,
  useRoleMemoryChanges,
  useRoleMemoryComparison,
} from '@/features/relay/queries';
import {
  NO_MATERIAL_MEMORY_CHANGES,
  organizationMemoryCardModel,
} from '@/features/relay/organization-memory-display';
import type { RoleMemoryChange } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

function ChangeCard({
  change,
  previousServicePeriod,
  currentServicePeriod,
}: {
  change: RoleMemoryChange;
  previousServicePeriod: string;
  currentServicePeriod: string;
}) {
  const card = organizationMemoryCardModel(change, {
    previous: previousServicePeriod,
    current: currentServicePeriod,
  });
  const icon = card.changeType === 'added'
    ? 'plus-circle-outline'
    : card.changeType === 'retired' ? 'archive-arrow-down-outline' : 'swap-horizontal';
  const reasonDocumented = card.reasonText !== 'Reason not documented.';
  return (
    <View style={styles.changeCard}>
      <View style={styles.changeHeading}>
        <View style={styles.changeBadge}>
          <MaterialCommunityIcons color={card.changeType === 'retired' ? colors.emergency : colors.moss} name={icon} size={18} />
          <AppText variant="caption" color={card.changeType === 'retired' ? colors.emergency : colors.moss}>
            {card.changeType.toUpperCase()}
          </AppText>
        </View>
        <AppText variant="heading" style={styles.copy}>{card.title}</AppText>
      </View>

      {card.before || card.after ? (
        <View style={styles.snapshotGrid}>
          {card.before ? (
            <View style={styles.snapshot}>
              <AppText variant="caption" color={colors.inkMuted}>BEFORE</AppText>
              <AppText variant="caption" color={colors.inkMuted}>{card.before.content}</AppText>
            </View>
          ) : null}
          {card.after ? (
            <View style={styles.snapshot}>
              <AppText variant="caption" color={colors.moss}>AFTER</AppText>
              <AppText variant="caption" color={colors.inkMuted}>{card.after.content}</AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.reason, !reasonDocumented && styles.unknownReason]}>
        <MaterialCommunityIcons color={reasonDocumented ? colors.moss : colors.saffron} name="source-branch" size={19} />
        <View style={styles.copy}>
          <AppText variant="label">{card.reasonText}</AppText>
        </View>
      </View>

      {card.sources.length ? (
        <View style={styles.provenance}>
          <AppText variant="caption" color={colors.moss}>SOURCE</AppText>
          {card.sources.map((source, index) => (
            <AppText key={`${source.label}:${source.locator ?? ''}:${index}`} variant="caption" color={colors.inkMuted}>
              {source.label}{source.locator ? ` · ${source.locator}` : ''}
            </AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function OrganizationMemoryScreen() {
  const { roleId } = useLocalSearchParams<{ roleId: string }>();
  const roleQuery = useRole(roleId);
  const organizationQuery = useOrganization(roleQuery.data?.organizationId);
  const handoffsQuery = useRolePublications(roleId);
  const plan = useOrganizationPlan(roleQuery.data?.organizationId);
  const comparisonQuery = useRoleMemoryComparison(roleId);
  const changesQuery = useRoleMemoryChanges(comparisonQuery.data?.id);
  const compareMutation = useCompareRoleHandoffs();
  const changesEnabled = Boolean(comparisonQuery.data?.id);
  const pending = roleQuery.isPending || handoffsQuery.isPending || comparisonQuery.isPending
    || (roleQuery.data && organizationQuery.isPending)
    || (changesEnabled && changesQuery.isPending);
  const error = roleQuery.error ?? organizationQuery.error ?? handoffsQuery.error
    ?? comparisonQuery.error ?? (changesEnabled ? changesQuery.error : null);

  if (pending) return <Screen><LoadingState label="Opening role memory…" /></Screen>;
  if (error || !roleQuery.data || !organizationQuery.data) {
    return <Screen><MessageState icon="book-alert-outline" title="Role memory unavailable" body={error?.message ?? 'This role could not be opened.'} /></Screen>;
  }
  const published = handoffsQuery.data ?? [];
  const comparison = comparisonQuery.data;
  const changes = changesQuery.data ?? [];

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{organizationQuery.data.name.toUpperCase()}</AppText>
        <AppText variant="display">What changed since the previous {roleQuery.data.title}?</AppText>
        <AppText color={colors.inkMuted}>Compare the latest adjacent published handoffs for this same role.</AppText>
      </View>

      <View style={styles.historyCard}>
        <AppText variant="heading">Published handoffs</AppText>
        <AppText variant="caption" color={colors.inkMuted}>Open any preserved handoff to inspect its full approved snapshot.</AppText>
        <View style={styles.historyList}>
          {published.map((handoff) => (
            <Pressable
              accessibilityRole="button"
              key={handoff.id}
              onPress={() => router.push((`/published-history?handoffId=${handoff.handoffId}`) as Href)}
              style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}>
              <View style={styles.copy}>
                <AppText variant="label">{handoff.servicePeriod}</AppText>
                <AppText variant="caption" color={colors.inkMuted}>Published {handoff.publishedAt ? new Date(handoff.publishedAt).toLocaleDateString() : ''}</AppText>
              </View>
              <MaterialCommunityIcons color={colors.inkMuted} name="chevron-right" size={21} />
            </Pressable>
          ))}
        </View>
      </View>

      {plan.data?.plan !== 'pro' ? <Button label="Organization Memory requires Relay Pro" tone="secondary" onPress={() => router.push(`/paywall?organizationId=${roleQuery.data.organizationId}` as Href)} /> : null}
      {published.length < 2 ? (
        <MessageState
          icon="compare-horizontal"
          title="One more published period is needed"
          body="Relay compares adjacent published handoffs for this same role after a second service period is intentionally published."
        />
      ) : !comparison ? (
        <View style={styles.emptyComparison}>
          <MaterialCommunityIcons color={colors.moss} name="compare-horizontal" size={32} />
          <AppText variant="heading">Compare the latest adjacent periods</AppText>
          <AppText color={colors.inkMuted}>Relay shows material additions, changes, and retirements. Wording-only and uncertain differences stay hidden.</AppText>
          <Button disabled={compareMutation.isPending || plan.data?.plan !== 'pro'} icon="creation-outline" label={compareMutation.isPending ? 'Comparing…' : 'Find material changes'} onPress={() => compareMutation.mutate({ roleId })} />
        </View>
      ) : (
        <View style={styles.comparisonSection}>
          <View style={styles.comparisonHeading}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>ORGANIZATION MEMORY</AppText>
            <AppText variant="heading">{comparison.previousServicePeriod} → {comparison.currentServicePeriod}</AppText>
            <AppText color={colors.inkMuted}>
              {comparison.status === 'ready'
                ? `${changes.length} material ${changes.length === 1 ? 'change' : 'changes'}`
                : comparison.failureReason ?? 'Comparison is still processing.'}
            </AppText>
          </View>
          {comparison.status === 'ready' && changes.length ? (
            <View style={styles.changeList}>
              {changes.map((change) => (
                <ChangeCard
                  change={change}
                  currentServicePeriod={comparison.currentServicePeriod}
                  key={change.id}
                  previousServicePeriod={comparison.previousServicePeriod}
                />
              ))}
            </View>
          ) : comparison.status === 'ready' ? (
            <View style={styles.noChanges}>
              <AppText variant="label">{NO_MATERIAL_MEMORY_CHANGES}</AppText>
            </View>
          ) : null}
          <Button disabled={compareMutation.isPending || plan.data?.plan !== 'pro'} icon="refresh" label={compareMutation.isPending ? 'Comparing…' : 'Re-run latest comparison'} tone="secondary" onPress={() => compareMutation.mutate({ roleId })} />
        </View>
      )}

      {compareMutation.error ? <AppText variant="caption" color={colors.emergency}>{compareMutation.error.message}</AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.1 },
  copy: { flex: 1, gap: spacing.xxs },
  historyCard: { gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  historyList: { gap: spacing.xs },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  emptyComparison: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, padding: spacing.xl, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  comparisonSection: { gap: spacing.md, marginTop: spacing.xl },
  comparisonHeading: { gap: spacing.xxs },
  changeList: { gap: spacing.md },
  changeCard: { gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  changeHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  changeBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  snapshotGrid: { gap: spacing.xs },
  snapshot: { gap: spacing.xxs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  unknownReason: { backgroundColor: colors.saffronSoft },
  provenance: { gap: spacing.xxs, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  noChanges: { gap: spacing.xxs, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  pressed: { opacity: 0.72 },
});
