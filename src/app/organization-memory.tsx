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
  useRoleHandoffs,
  useRoleMemoryChanges,
  useRoleMemoryComparison,
} from '@/features/relay/queries';
import type { MemoryReasonCategory, RoleMemoryChange } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

const REASON_LABELS: Record<MemoryReasonCategory, string> = {
  policy_driven: 'Policy-driven',
  lesson_driven: 'Lesson-driven',
  leadership_preference: 'Leadership preference',
  contact_resource: 'Contact/resource change',
  unknown: 'Unknown / not established',
};

function ChangeCard({ change, roleId }: { change: RoleMemoryChange; roleId: string }) {
  const icon = change.changeType === 'added'
    ? 'plus-circle-outline'
    : change.changeType === 'retired' ? 'archive-arrow-down-outline' : 'swap-horizontal';
  return (
    <View style={styles.changeCard}>
      <View style={styles.changeHeading}>
        <View style={styles.changeBadge}>
          <MaterialCommunityIcons color={change.changeType === 'retired' ? colors.emergency : colors.moss} name={icon} size={18} />
          <AppText variant="caption" color={change.changeType === 'retired' ? colors.emergency : colors.moss}>
            {change.changeType.toUpperCase()}
          </AppText>
        </View>
        <AppText variant="heading" style={styles.copy}>{change.title}</AppText>
      </View>
      <AppText color={colors.inkMuted}>{change.summary}</AppText>

      {change.beforeSnapshot || change.afterSnapshot ? (
        <View style={styles.snapshotGrid}>
          {change.beforeSnapshot ? (
            <View style={styles.snapshot}>
              <AppText variant="caption" color={colors.inkMuted}>BEFORE</AppText>
              <AppText variant="label">{change.beforeSnapshot.title}</AppText>
              <AppText variant="caption" color={colors.inkMuted}>{change.beforeSnapshot.content}</AppText>
            </View>
          ) : null}
          {change.afterSnapshot ? (
            <View style={styles.snapshot}>
              <AppText variant="caption" color={colors.moss}>AFTER</AppText>
              <AppText variant="label">{change.afterSnapshot.title}</AppText>
              <AppText variant="caption" color={colors.inkMuted}>{change.afterSnapshot.content}</AppText>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.reason, change.reasonCategory === 'unknown' && styles.unknownReason]}>
        <MaterialCommunityIcons color={change.reasonCategory === 'unknown' ? colors.saffron : colors.moss} name="source-branch" size={19} />
        <View style={styles.copy}>
          <AppText variant="label">Reason: {REASON_LABELS[change.reasonCategory]}</AppText>
          <AppText variant="caption" color={colors.inkMuted}>{change.reasonExplanation}</AppText>
        </View>
      </View>

      {change.supportingProvenance.length ? (
        <View style={styles.provenance}>
          <AppText variant="caption" color={colors.moss}>SUPPORTING APPROVED PROVENANCE</AppText>
          {change.supportingProvenance.map((source, index) => (
            <AppText key={`${source.label}:${source.locator ?? ''}:${index}`} variant="caption" color={colors.inkMuted}>
              {source.label}{source.locator ? ` · ${source.locator}` : ''}
            </AppText>
          ))}
        </View>
      ) : null}
      <Button
        icon={change.humanConfirmed ? 'check-decagram-outline' : 'account-check-outline'}
        label={change.humanConfirmed ? 'Reason confirmed · edit' : 'Confirm or correct reason'}
        tone="ghost"
        onPress={() => router.push((`/memory-reason?changeId=${change.id}&comparisonId=${change.comparisonId}&roleId=${roleId}`) as Href)}
      />
    </View>
  );
}

export default function OrganizationMemoryScreen() {
  const { roleId } = useLocalSearchParams<{ roleId: string }>();
  const roleQuery = useRole(roleId);
  const organizationQuery = useOrganization(roleQuery.data?.organizationId);
  const handoffsQuery = useRoleHandoffs(roleId);
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
  const published = (handoffsQuery.data ?? []).filter((handoff) => handoff.status === 'published');
  const comparison = comparisonQuery.data;
  const changes = changesQuery.data ?? [];

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{organizationQuery.data.name.toUpperCase()}</AppText>
        <AppText variant="display">{roleQuery.data.title} · What Changed</AppText>
        <AppText color={colors.inkMuted}>Adjacent service periods only. Approved knowledge and immutable publication snapshots are the comparison truth.</AppText>
      </View>

      <View style={styles.historyCard}>
        <AppText variant="heading">Published handoffs</AppText>
        <AppText variant="caption" color={colors.inkMuted}>Open any preserved handoff to inspect its full approved snapshot.</AppText>
        <View style={styles.historyList}>
          {published.map((handoff) => (
            <Pressable
              accessibilityRole="button"
              key={handoff.id}
              onPress={() => router.push((`/handoff/${handoff.id}`) as Href)}
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
          <AppText color={colors.inkMuted}>Low-confidence matches and wording-only differences will be omitted.</AppText>
          <Button disabled={compareMutation.isPending} icon="creation-outline" label={compareMutation.isPending ? 'Comparing…' : 'Find material changes'} onPress={() => compareMutation.mutate({ roleId })} />
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
            <View style={styles.changeList}>{changes.map((change) => <ChangeCard change={change} key={change.id} roleId={roleId} />)}</View>
          ) : comparison.status === 'ready' ? (
            <View style={styles.noChanges}>
              <AppText variant="label">No confidently material changes found</AppText>
              <AppText variant="caption" color={colors.inkMuted}>Relay suppressed unchanged, wording-only, and uncertain differences.</AppText>
            </View>
          ) : null}
          <Button disabled={compareMutation.isPending} icon="refresh" label={compareMutation.isPending ? 'Comparing…' : 'Re-run latest comparison'} tone="secondary" onPress={() => compareMutation.mutate({ roleId })} />
        </View>
      )}

      {compareMutation.error ? <AppText variant="caption" color={colors.emergency}>{compareMutation.error.message}</AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
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
