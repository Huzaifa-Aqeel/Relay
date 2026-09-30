import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
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
  NO_VERIFIED_MEMORY_REASON,
  organizationMemoryCardModel,
} from '@/features/relay/organization-memory-display';
import type { RoleMemoryChange } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

type MemoryFilter = 'all' | RoleMemoryChange['changeType'];

const CHANGE_META: Record<RoleMemoryChange['changeType'], {
  label: string;
  shortLabel: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  backgroundColor: string;
}> = {
  added: { label: 'Added', shortLabel: 'Added', icon: 'plus-circle-outline', color: colors.moss, backgroundColor: colors.mossSoft },
  changed: { label: 'Changed', shortLabel: 'Changed', icon: 'swap-horizontal', color: colors.moss, backgroundColor: colors.mossSoft },
  resolved: { label: 'Resolved', shortLabel: 'Resolved', icon: 'check-circle-outline', color: colors.moss, backgroundColor: colors.mossSoft },
  retired: { label: 'Retired', shortLabel: 'Retired', icon: 'archive-arrow-down-outline', color: colors.emergency, backgroundColor: '#F8E5E1' },
};

function SnapshotSources({
  period,
  sources,
}: {
  period: string;
  sources: { label: string; locator: string | null }[];
}) {
  return (
    <View style={styles.snapshotSources}>
      {sources.map((source, index) => (
        <AppText key={`${source.label}:${source.locator ?? ''}:${index}`} variant="caption" color={colors.inkMuted}>
          {period} · {source.label}{source.locator ? ` · ${source.locator}` : ''}
        </AppText>
      ))}
    </View>
  );
}

function ChangeCard({
  change,
  previousServicePeriod,
  currentServicePeriod,
}: {
  change: RoleMemoryChange;
  previousServicePeriod: string;
  currentServicePeriod: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const card = organizationMemoryCardModel(change, {
    previous: previousServicePeriod,
    current: currentServicePeriod,
  });
  const meta = CHANGE_META[card.changeType];
  const reasonDocumented = card.reasonText !== NO_VERIFIED_MEMORY_REASON;
  return (
    <View style={styles.changeCard}>
      <Pressable
        accessibilityLabel={`${meta.label}: ${card.title}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.changeHeading, pressed && styles.pressed]}>
        <View style={[styles.changeBadge, { backgroundColor: meta.backgroundColor }]}>
          <MaterialCommunityIcons color={meta.color} name={meta.icon} size={18} />
          <AppText variant="caption" color={meta.color}>{meta.shortLabel.toUpperCase()}</AppText>
        </View>
        <AppText variant="heading" style={styles.copy}>{card.title}</AppText>
        <MaterialCommunityIcons color={colors.inkMuted} name={expanded ? 'chevron-up' : 'chevron-down'} size={22} />
      </Pressable>

      {expanded && (card.before || card.after) ? (
        <View style={styles.snapshotGrid}>
          {card.before ? (
            <View style={styles.snapshot}>
              <AppText variant="caption" color={colors.inkMuted}>BEFORE · {previousServicePeriod}</AppText>
              <AppText color={colors.inkMuted}>{card.before.content}</AppText>
              <SnapshotSources period={previousServicePeriod} sources={card.beforeSources} />
            </View>
          ) : null}
          {card.after ? (
            <View style={styles.snapshot}>
              <AppText variant="caption" color={colors.moss}>AFTER · {currentServicePeriod}</AppText>
              <AppText color={colors.inkMuted}>{card.after.content}</AppText>
              <SnapshotSources period={currentServicePeriod} sources={card.afterSources} />
            </View>
          ) : null}
        </View>
      ) : null}

      {expanded ? (
        <View style={[styles.reason, !reasonDocumented && styles.unknownReason]}>
          <MaterialCommunityIcons color={reasonDocumented ? colors.moss : colors.saffron} name="source-branch" size={18} />
          <View style={styles.copy}>
            <AppText variant="caption">{card.reasonText}</AppText>
            {reasonDocumented && card.reasonSources.length ? (
              <SnapshotSources period={currentServicePeriod} sources={card.reasonSources} />
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function OrganizationMemoryScreen() {
  const { roleId } = useLocalSearchParams<{ roleId: string }>();
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const roleQuery = useRole(roleId);
  const organizationQuery = useOrganization(roleQuery.data?.organizationId);
  const handoffsQuery = useRolePublications(roleId);
  const plan = useOrganizationPlan(roleQuery.data?.organizationId);
  const comparisonQuery = useRoleMemoryComparison(roleId);
  const changesQuery = useRoleMemoryChanges(comparisonQuery.data?.id, comparisonQuery.data?.runStatus === 'processing', comparisonQuery.data?.completedAt);
  const compareMutation = useCompareRoleHandoffs();
  const changesEnabled = Boolean(comparisonQuery.data?.id);
  const pending = roleQuery.isPending || handoffsQuery.isPending || comparisonQuery.isPending
    || (roleQuery.data && organizationQuery.isPending)
    || (changesEnabled && changesQuery.isPending);
  const error = roleQuery.error ?? organizationQuery.error ?? handoffsQuery.error
    ?? comparisonQuery.error ?? (changesEnabled ? changesQuery.error : null);
  const published = handoffsQuery.data ?? [];
  const comparison = comparisonQuery.data;
  const changes = useMemo(() => changesQuery.data ?? [], [changesQuery.data]);
  const filterOptions = useMemo(() => {
    const order: RoleMemoryChange['changeType'][] = [
      'changed', 'added', 'resolved', 'retired',
    ];
    return order.flatMap((changeType) => {
      const count = changes.filter((change) => change.changeType === changeType).length;
      return count ? [{ changeType, count }] : [];
    });
  }, [changes]);
  const visibleChanges = filter === 'all'
    ? changes
    : changes.filter((change) => change.changeType === filter);

  if (pending) return <Screen><LoadingState label="Opening role memory…" /></Screen>;
  if (error || !roleQuery.data || !organizationQuery.data) {
    return <Screen><MessageState icon="book-alert-outline" title="Role memory unavailable" body={error?.message ?? 'This role could not be opened.'} /></Screen>;
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{organizationQuery.data.name.toUpperCase()}</AppText>
        <AppText variant="display">What changed since the previous {roleQuery.data.title}?</AppText>
        <AppText color={colors.inkMuted}>Compare the latest adjacent published handoffs for this same role.</AppText>
      </View>

      <View style={styles.historyCard}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: historyExpanded }}
          onPress={() => setHistoryExpanded((current) => !current)}
          style={({ pressed }) => [styles.historyHeading, pressed && styles.pressed]}>
          <View style={styles.copy}>
            <AppText variant="heading">Published handoffs</AppText>
            <AppText variant="caption" color={colors.inkMuted}>{published.length} preserved {published.length === 1 ? 'period' : 'periods'}</AppText>
          </View>
          <MaterialCommunityIcons color={colors.inkMuted} name={historyExpanded ? 'chevron-up' : 'chevron-down'} size={22} />
        </Pressable>
        {historyExpanded ? (
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
        ) : null}
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
          <AppText color={colors.inkMuted}>Relay compares approved operational facts across the two handoffs. Duplicate wording, routine yearly date shifts, and uncertain relationships stay hidden.</AppText>
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
            <>
              <View accessibilityRole="tablist" style={styles.filters}>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: filter === 'all' }}
                  onPress={() => setFilter('all')}
                  style={({ pressed }) => [styles.filter, filter === 'all' && styles.filterSelected, pressed && styles.pressed]}>
                  <AppText variant="caption" color={filter === 'all' ? colors.white : colors.ink}>All · {changes.length}</AppText>
                </Pressable>
                {filterOptions.map(({ changeType, count }) => (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: filter === changeType }}
                    key={changeType}
                    onPress={() => setFilter(changeType)}
                    style={({ pressed }) => [styles.filter, filter === changeType && styles.filterSelected, pressed && styles.pressed]}>
                    <AppText variant="caption" color={filter === changeType ? colors.white : colors.ink}>
                      {CHANGE_META[changeType].shortLabel} · {count}
                    </AppText>
                  </Pressable>
                ))}
              </View>
              <View style={styles.changeList}>
              {visibleChanges.map((change) => (
                <ChangeCard
                  change={change}
                  currentServicePeriod={comparison.currentServicePeriod}
                  key={change.id}
                  previousServicePeriod={comparison.previousServicePeriod}
                />
              ))}
              </View>
            </>
          ) : comparison.status === 'ready' ? (
            <View style={styles.noChanges}>
              <AppText variant="label">{comparison.coveredItemCount < comparison.totalItemCount ? 'No verified changes in the compared portion.' : NO_MATERIAL_MEMORY_CHANGES}</AppText>
            </View>
          ) : null}
          {comparison.runStatus === 'processing' ? <AppText>Comparing published knowledge…</AppText> : null}
          {comparison.status === 'ready' && comparison.coveredItemCount < comparison.totalItemCount ? <AppText>Partial comparison: compared {comparison.coveredItemCount} of {comparison.totalItemCount} items. New topics are hidden until coverage is complete.</AppText> : null}
          {comparison.omittedChangeCount > 0 ? <AppText>+{comparison.omittedChangeCount} more changes. Showing the 100 highest-priority changes.</AppText> : null}
          {(comparison.runStatus === 'failed' || comparison.pipelineVersion !== 3 || comparison.coveredItemCount < comparison.totalItemCount) ? <Button disabled={compareMutation.isPending || comparison.runStatus === 'processing' || plan.data?.plan !== 'pro'} icon="refresh" label="Retry comparison" tone="secondary" onPress={() => compareMutation.mutate({ roleId })} /> : null}
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
  historyCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  historyHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  historyList: { gap: spacing.xs },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  emptyComparison: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, padding: spacing.xl, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  comparisonSection: { gap: spacing.md, marginTop: spacing.xl },
  comparisonHeading: { gap: spacing.xxs },
  changeList: { gap: spacing.md },
  changeCard: { overflow: 'hidden', gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  changeHeading: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  changeBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  snapshotGrid: { gap: spacing.xs },
  snapshot: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  snapshotSources: { gap: spacing.xxs, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  unknownReason: { backgroundColor: colors.saffronSoft },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  filter: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radii.pill, backgroundColor: colors.surface },
  filterSelected: { borderColor: colors.moss, backgroundColor: colors.moss },
  noChanges: { gap: spacing.xxs, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  pressed: { opacity: 0.72 },
});
