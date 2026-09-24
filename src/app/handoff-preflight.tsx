import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import {
  useAdvanceHandoffToPreview,
  useDecidePreflightFinding,
  useHandoff,
  useKnowledgeItems,
  usePreflightEvidence,
  usePreflightFindings,
  usePreflightRun,
  useRole,
  useRunPreflight,
} from '@/features/relay/queries';
import type { PreflightEvidence, PreflightFinding } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

const FINDING_META = {
  missing: { label: 'Missing information', icon: 'help-box-outline' as const },
  ambiguous: { label: 'Ambiguous', icon: 'message-question-outline' as const },
  incomplete: { label: 'Incomplete instruction', icon: 'puzzle-outline' as const },
  contradiction: { label: 'Contradiction', icon: 'compare-horizontal' as const },
};

function EvidenceList({ evidence }: { evidence: PreflightEvidence[] }) {
  if (!evidence.length) return null;
  return (
    <View style={styles.evidenceList}>
      {evidence.map((item) => (
        <View key={item.id} style={styles.evidenceCard}>
          <View style={styles.evidenceHeading}>
            <MaterialCommunityIcons
              color={colors.moss}
              name={item.evidenceKind === 'knowledge' ? 'check-decagram-outline' : 'file-document-outline'}
              size={17}
            />
            <AppText variant="caption" color={colors.moss} style={styles.flex}>
              {item.label}{item.locator ? ` · ${item.locator}` : ''}
            </AppText>
          </View>
          <AppText variant="caption" color={colors.inkMuted}>“{item.excerpt}”</AppText>
        </View>
      ))}
    </View>
  );
}

function FindingCard({
  finding,
  evidence,
  interactive,
  pending,
  onDecide,
}: {
  finding: PreflightFinding;
  evidence: PreflightEvidence[];
  interactive: boolean;
  pending: boolean;
  onDecide: (decision: 'skipped' | 'unknown') => void;
}) {
  const meta = FINDING_META[finding.findingType];
  const resolved = finding.status === 'resolved';
  return (
    <View style={[
      styles.findingCard,
      finding.severity === 'critical' && styles.criticalCard,
      resolved && styles.resolvedCard,
    ]}>
      <View style={styles.findingHeader}>
        <View style={styles.typeBadge}>
          <MaterialCommunityIcons
            color={finding.severity === 'critical' ? colors.emergency : colors.saffron}
            name={meta.icon}
            size={18}
          />
          <AppText variant="caption" color={colors.ink}>{meta.label.toUpperCase()}</AppText>
        </View>
        <AppText variant="caption" color={finding.severity === 'critical' ? colors.emergency : colors.inkMuted}>
          {finding.severity === 'critical' ? 'Critical' : 'Optional'}
        </AppText>
      </View>
      <AppText variant="heading">{finding.title}</AppText>
      <AppText variant="label">{finding.question}</AppText>
      <AppText color={colors.inkMuted}>{finding.explanation}</AppText>
      <EvidenceList evidence={evidence} />

      {finding.status !== 'open' ? (
        <View style={styles.decisionState}>
          <MaterialCommunityIcons
            color={resolved ? colors.moss : colors.saffron}
            name={resolved ? 'check-circle-outline' : finding.status === 'unknown' ? 'help-circle-outline' : 'clock-outline'}
            size={20}
          />
          <AppText variant="caption" color={colors.inkMuted} style={styles.flex}>
            {resolved ? 'Resolved with approved knowledge.' : finding.status === 'unknown' ? 'Marked unknown.' : 'Skipped for now.'}
          </AppText>
        </View>
      ) : null}

      {interactive && !resolved ? (
        <View style={styles.actions}>
          <Button
            disabled={pending}
            icon="check-circle-outline"
            label="Resolve"
            onPress={() => router.push((
              `/preflight-resolve?handoffId=${finding.handoffId}&runId=${finding.runId}&findingId=${finding.id}`
            ) as Href)}
          />
          {finding.primaryKnowledgeItemId ? (
            <Button
              disabled={pending}
              icon="pencil-outline"
              label="Edit the instruction"
              tone="secondary"
              onPress={() => router.push((
                `/knowledge/${finding.primaryKnowledgeItemId}?returnTo=preflight&findingId=${finding.id}&runId=${finding.runId}`
              ) as Href)}
            />
          ) : null}
          <View style={styles.inlineActions}>
            <Button
              disabled={pending}
              icon="help-circle-outline"
              label="I don't know"
              tone="ghost"
              style={styles.flex}
              onPress={() => onDecide('unknown')}
            />
            <Button
              disabled={pending}
              icon="clock-outline"
              label="Skip for now"
              tone="ghost"
              style={styles.flex}
              onPress={() => onDecide('skipped')}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function HandoffPreflightScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const knowledgeQuery = useKnowledgeItems(handoffId);
  const runQuery = usePreflightRun(handoffId);
  const runId = runQuery.data?.id;
  const findingsQuery = usePreflightFindings(runId);
  const evidenceQuery = usePreflightEvidence(runId);
  const runMutation = useRunPreflight();
  const decisionMutation = useDecidePreflightFinding();
  const advanceMutation = useAdvanceHandoffToPreview();

  const pending = handoffQuery.isPending
    || knowledgeQuery.isPending
    || runQuery.isPending
    || (handoffQuery.data && roleQuery.isPending)
    || (runId && (findingsQuery.isPending || evidenceQuery.isPending));
  const error = handoffQuery.error
    ?? roleQuery.error
    ?? knowledgeQuery.error
    ?? runQuery.error
    ?? findingsQuery.error
    ?? evidenceQuery.error;

  if (!handoffId) return <Screen><MessageState icon="shield-alert-outline" title="Choose a handoff first" body="The handoff check must belong to a handoff." /></Screen>;
  if (pending) return <Screen><LoadingState label="Opening handoff check…" /></Screen>;
  if (error || !handoffQuery.data || !roleQuery.data || !knowledgeQuery.data) {
    return <Screen><MessageState icon="shield-alert-outline" title="Handoff check unavailable" body={error?.message ?? 'This handoff could not be checked.'} /></Screen>;
  }

  const approved = knowledgeQuery.data.filter((item) => item.status === 'approved');
  const proposed = knowledgeQuery.data.filter((item) => item.status === 'proposed');
  const run = runQuery.data;
  const findings = findingsQuery.data ?? [];
  const evidence = evidenceQuery.data ?? [];
  const criticalUnresolved = findings.filter((finding) => finding.severity === 'critical' && finding.status !== 'resolved');
  const optionalUnresolved = findings.filter((finding) => finding.severity === 'optional' && finding.status !== 'resolved');
  const resolved = findings.filter((finding) => finding.status === 'resolved');
  const canInteract = run?.status === 'ready';

  async function startPreflight() {
    await runMutation.mutateAsync({ handoffId });
  }

  function decide(finding: PreflightFinding, decision: 'skipped' | 'unknown') {
    decisionMutation.mutate({ id: finding.id, runId: finding.runId, decision });
  }

  async function continueToPreview(acknowledgeCritical: boolean) {
    await advanceMutation.mutateAsync({ handoffId, acknowledgeCritical });
    router.replace((`/handoff/${handoffId}`) as Href);
  }

  function confirmPreview() {
    if (!criticalUnresolved.length) {
      void continueToPreview(false);
      return;
    }
    Alert.alert(
      'Continue with critical questions?',
      `${criticalUnresolved.length} critical ${criticalUnresolved.length === 1 ? 'finding remains' : 'findings remain'} unresolved. The next leader may have to guess. Continuing records your acknowledgement; it does not mark these questions resolved.`,
      [
        { text: 'Go back', style: 'cancel' },
        { text: 'Acknowledge and continue', style: 'destructive', onPress: () => void continueToPreview(true) },
      ],
    );
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{roleQuery.data.title.toUpperCase()}</AppText>
        <AppText variant="display">Could someone take over without guessing?</AppText>
        <AppText color={colors.inkMuted}>Relay checks what you added for meaningful missing detail, ambiguity, incomplete instructions, and contradictions. It never invents the answer.</AppText>
      </View>

      {proposed.length ? (
        <View style={styles.noticeCard}>
          <MaterialCommunityIcons color={colors.saffron} name="clipboard-text-clock-outline" size={27} />
          <View style={styles.flex}>
            <AppText variant="label">Finish Review first</AppText>
            <AppText variant="caption" color={colors.inkMuted}>{proposed.length} proposed {proposed.length === 1 ? 'item still needs' : 'items still need'} a decision.</AppText>
          </View>
          <Button label="Review" tone="ghost" onPress={() => router.replace((`/handoff-review?handoffId=${handoffId}`) as Href)} />
        </View>
      ) : null}

      {!run ? (
        <View style={styles.startCard}>
          <View style={styles.startIcon}><MaterialCommunityIcons color={colors.moss} name="shield-check-outline" size={34} /></View>
          <AppText variant="heading">Check your handoff</AppText>
          <AppText color={colors.inkMuted}>Relay will check {approved.length} approved {approved.length === 1 ? 'item' : 'items'} against the available source evidence.</AppText>
          <Button
            disabled={!approved.length || proposed.length > 0 || runMutation.isPending}
            icon="shield-check-outline"
            label={runMutation.isPending ? 'Checking the handoff…' : 'Try check again'}
            onPress={() => void startPreflight()}
          />
        </View>
      ) : null}

      {run?.status === 'processing' ? (
        <View style={styles.startCard}>
          <LoadingState label="Checking approved knowledge and source evidence…" />
          <AppText variant="caption" color={colors.inkMuted}>You can leave this screen. Relay will retain the run status.</AppText>
        </View>
      ) : null}

      {run?.status === 'failed' || run?.status === 'stale' ? (
        <View style={run.status === 'failed' ? styles.failureCard : styles.noticeCard}>
          <MaterialCommunityIcons color={run.status === 'failed' ? colors.emergency : colors.saffron} name={run.status === 'failed' ? 'alert-circle-outline' : 'refresh-circle'} size={27} />
          <View style={styles.flex}>
            <AppText variant="label">{run.status === 'failed' ? 'The handoff check needs attention' : 'The handoff changed after this check'}</AppText>
            <AppText variant="caption" color={colors.inkMuted}>
              {run.failureReason ?? 'Check the handoff again so readiness reflects the current information.'}
            </AppText>
          </View>
          <Button
            disabled={runMutation.isPending}
            icon="refresh"
            label={runMutation.isPending ? 'Rerunning…' : 'Run again'}
            tone="ghost"
            onPress={() => void startPreflight()}
          />
        </View>
      ) : null}

      {run && run.status !== 'processing' && findings.length ? (
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>PREFLIGHT FINDINGS</AppText>
            <AppText variant="heading">Questions to settle</AppText>
            <AppText color={colors.inkMuted}>Resolve the important gaps, or deliberately mark what is unknown or being left for later.</AppText>
          </View>
          <View style={styles.list}>
            {findings.map((finding) => (
              <FindingCard
                evidence={evidence.filter((item) => item.findingId === finding.id)}
                finding={finding}
                interactive={canInteract}
                key={finding.id}
                pending={decisionMutation.isPending}
                onDecide={(decision) => decide(finding, decision)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {run?.status === 'ready' ? (
        <View style={styles.readinessCard}>
          <View style={styles.readinessHeading}>
            <View style={styles.startIcon}><MaterialCommunityIcons color={colors.moss} name="clipboard-check-outline" size={28} /></View>
            <View style={styles.flex}>
              <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>READINESS</AppText>
              <AppText variant="heading">{criticalUnresolved.length ? 'Important questions remain' : 'Ready for exact preview'}</AppText>
            </View>
          </View>
          <View style={styles.metrics}>
            <View style={styles.metric}><AppText variant="title">{approved.length}</AppText><AppText variant="caption" color={colors.inkMuted}>approved</AppText></View>
            <View style={styles.metric}><AppText variant="title" color={criticalUnresolved.length ? colors.emergency : colors.moss}>{criticalUnresolved.length}</AppText><AppText variant="caption" color={colors.inkMuted}>critical unresolved</AppText></View>
            <View style={styles.metric}><AppText variant="title">{optionalUnresolved.length}</AppText><AppText variant="caption" color={colors.inkMuted}>optional</AppText></View>
            <View style={styles.metric}><AppText variant="title">{resolved.length}</AppText><AppText variant="caption" color={colors.inkMuted}>resolved</AppText></View>
          </View>
          <AppText variant="caption" color={colors.inkMuted}>
            Optional findings do not block Preview. Critical unresolved findings require an explicit acknowledgement and remain visibly unresolved.
          </AppText>
          <Button
            disabled={advanceMutation.isPending}
            icon="arrow-right"
            label={advanceMutation.isPending
              ? 'Opening Preview…'
              : criticalUnresolved.length ? 'Review acknowledgement and continue' : 'Continue to Preview'}
            onPress={confirmPreview}
          />
        </View>
      ) : null}

      {runMutation.error || decisionMutation.error || advanceMutation.error ? (
        <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.emergency}>
          {(runMutation.error ?? decisionMutation.error ?? advanceMutation.error)?.message}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.1 },
  flex: { flex: 1 },
  startCard: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  startIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.saffronSoft },
  failureCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: '#FFF1EE' },
  section: { gap: spacing.md, marginTop: spacing.xl },
  sectionHeading: { gap: spacing.xs },
  list: { gap: spacing.md },
  findingCard: { gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: '#EACB95', borderRadius: radii.lg, backgroundColor: '#FFFBF4' },
  criticalCard: { borderColor: '#E8B5AC', backgroundColor: '#FFF8F6' },
  resolvedCard: { borderColor: colors.line, backgroundColor: colors.surface },
  findingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  evidenceList: { gap: spacing.xs },
  evidenceCard: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  evidenceHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  decisionState: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  actions: { gap: spacing.xs, marginTop: spacing.xs },
  inlineActions: { flexDirection: 'row', gap: spacing.xs },
  readinessCard: { gap: spacing.md, marginTop: spacing.xl, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  readinessHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { minWidth: 115, flexGrow: 1, gap: spacing.xxs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surface },
});
