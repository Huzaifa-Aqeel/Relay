import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { KNOWLEDGE_META } from '@/features/relay/knowledge-meta';
import { shouldRunHandoffCheck } from '@/features/relay/shell-model';
import {
  useDecideKnowledgeProposal,
  useHandoff,
  useHandoffCaptures,
  useKnowledgeItems,
  useKnowledgeProvenance,
  usePreflightRun,
  useReturnHandoffToCapture,
  useRole,
  useRunPreflight,
} from '@/features/relay/queries';
import type { KnowledgeItem, KnowledgeProvenance } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

function ProposalCard({
  item,
  pending,
  onAccept,
  onReject,
  provenance,
  existingItem,
}: {
  item: KnowledgeItem;
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  provenance: KnowledgeProvenance[];
  existingItem: KnowledgeItem | null;
}) {
  const meta = KNOWLEDGE_META[item.knowledgeType];
  const [showSupport, setShowSupport] = useState(false);
  const actionLabel = item.proposalAction === 'update'
    ? 'Apply update'
    : item.proposalAction === 'retire'
      ? 'Retire from handoff'
      : 'Add to handoff';
  return (
    <View style={styles.proposalCard}>
      <View style={styles.proposalHeader}>
        <View style={styles.proposalBadge}>
          <MaterialCommunityIcons color={colors.saffron} name="creation-outline" size={17} />
          <AppText variant="caption" color={colors.ink}>
            {item.proposalAction === 'update' ? 'UPDATE' : item.proposalAction === 'retire' ? 'RETIRE' : 'NEW'}
          </AppText>
        </View>
        <View style={styles.typeLabel}>
          <MaterialCommunityIcons color={colors.moss} name={meta.icon} size={17} />
          <AppText variant="caption" color={colors.moss}>{meta.label}</AppText>
        </View>
      </View>
      <AppText variant="heading">{item.title}</AppText>
      {existingItem ? (
        <View style={styles.changeComparison}>
          <View style={styles.changeBlock}>
            <AppText variant="caption" color={colors.inkMuted} style={styles.eyebrow}>CURRENT</AppText>
            <AppText color={colors.inkMuted}>{existingItem.content}</AppText>
          </View>
          <View style={styles.changeDivider} />
          <View style={styles.changeBlock}>
            <AppText variant="caption" color={item.proposalAction === 'retire' ? colors.emergency : colors.moss} style={styles.eyebrow}>
              {item.proposalAction === 'retire' ? 'REMOVE FROM CURRENT HANDOFF' : 'SUGGESTED CHANGE'}
            </AppText>
            {item.proposalAction !== 'retire' ? <AppText>{item.content}</AppText> : null}
          </View>
          {item.proposalAction === 'retire' ? (
            <AppText variant="caption" color={colors.inkMuted}>Its history and supporting evidence will remain preserved.</AppText>
          ) : null}
        </View>
      ) : <AppText color={colors.inkMuted}>{item.content}</AppText>}
      {item.uncertaintyNote ? (
        <View style={styles.uncertainty}>
          <MaterialCommunityIcons color={colors.saffron} name="help-circle-outline" size={20} />
          <AppText variant="caption" color={colors.inkMuted} style={styles.rowCopy}>{item.uncertaintyNote}</AppText>
        </View>
      ) : null}
      {provenance.length ? (
        <View style={styles.supportSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showSupport }}
            onPress={() => setShowSupport((current) => !current)}
            style={({ pressed }) => [styles.supportToggle, pressed && styles.pressed]}>
            <MaterialCommunityIcons color={colors.moss} name="file-check-outline" size={18} />
            <AppText variant="label" color={colors.moss} style={styles.rowCopy}>
              {showSupport ? 'Hide support' : `View support (${provenance.length})`}
            </AppText>
            <MaterialCommunityIcons color={colors.moss} name={showSupport ? 'chevron-up' : 'chevron-down'} size={20} />
          </Pressable>
          {showSupport ? provenance.map((evidence) => (
            <View key={`${evidence.knowledgeItemId}:${evidence.sourceId}`} style={styles.evidence}>
              <AppText variant="caption" color={colors.moss}>
                {evidence.sourceTitle}{evidence.sourceLocator ? ` · ${evidence.sourceLocator}` : ''}
              </AppText>
              {evidence.sourceExcerpt ? (
                <AppText variant="caption" color={colors.inkMuted}>“{evidence.sourceExcerpt}”</AppText>
              ) : null}
            </View>
          )) : null}
        </View>
      ) : null}
      <View style={styles.proposalActions}>
        <Button disabled={pending} icon="check" label={actionLabel} onPress={onAccept} style={styles.flexAction} />
        <Button
          disabled={pending}
          icon="pencil-outline"
          label="Edit"
          tone="secondary"
          onPress={() => router.push((`/knowledge/${item.id}?returnTo=review`) as Href)}
          style={styles.flexAction}
        />
      </View>
      <Button disabled={pending} icon="close" label="Don&apos;t add" tone="ghost" onPress={onReject} />
    </View>
  );
}

export default function HandoffReviewScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const knowledgeQuery = useKnowledgeItems(handoffId);
  const capturesQuery = useHandoffCaptures(handoffId);
  const provenanceQuery = useKnowledgeProvenance(handoffId);
  const preflightQuery = usePreflightRun(handoffId);
  const decisionMutation = useDecideKnowledgeProposal();
  const captureMutation = useReturnHandoffToCapture();
  const checkMutation = useRunPreflight();
  const checkAttempted = useRef(false);
  const [decisionNotice, setDecisionNotice] = useState<string | null>(null);
  const pending = handoffQuery.isPending || knowledgeQuery.isPending || capturesQuery.isPending
    || provenanceQuery.isPending || preflightQuery.isPending || (handoffQuery.data && roleQuery.isPending);
  const error = handoffQuery.error ?? roleQuery.error ?? knowledgeQuery.error
    ?? capturesQuery.error ?? provenanceQuery.error ?? preflightQuery.error;
  const proposals = knowledgeQuery.data?.filter((item) => item.status === 'proposed') ?? [];
  const approved = knowledgeQuery.data?.filter((item) => item.status === 'approved') ?? [];

  useEffect(() => {
    if (!shouldRunHandoffCheck({
      stage: handoffQuery.data?.stage ?? '',
      proposalCount: proposals.length,
      approvedCount: approved.length,
      hasRun: Boolean(preflightQuery.data),
      attempted: checkAttempted.current,
    })) return;
    checkAttempted.current = true;
    checkMutation.mutate({ handoffId });
  }, [approved.length, handoffId, handoffQuery.data?.stage, preflightQuery.data, proposals.length]);

  if (pending) return <Screen><LoadingState label="Preparing review…" /></Screen>;
  if (error || !handoffQuery.data || !roleQuery.data || !knowledgeQuery.data || !capturesQuery.data || !provenanceQuery.data) {
    return (
      <Screen>
        <MessageState
          icon="clipboard-alert-outline"
          title="Review unavailable"
          body={error?.message ?? 'This handoff could not be opened for review.'}
        />
      </Screen>
    );
  }

  const captureById = new Map(capturesQuery.data.map((capture) => [capture.id, capture]));
  const proposalGroups = [...new Set(proposals.map((item) => item.captureId ?? 'legacy'))].map((captureId) => ({
    captureId,
    title: captureId === 'legacy' ? 'Earlier capture' : captureById.get(captureId)?.title ?? 'Capture',
    proposals: proposals.filter((item) => (item.captureId ?? 'legacy') === captureId),
  }));

  function decide(item: KnowledgeItem, decision: 'approved' | 'rejected') {
    setDecisionNotice(null);
    decisionMutation.mutate(
      { id: item.id, handoffId, decision },
      {
        onSuccess: () => setDecisionNotice(decision === 'approved'
          ? item.proposalAction === 'update'
            ? 'Update applied to the handoff.'
            : item.proposalAction === 'retire'
              ? 'Item retired from the current handoff.'
              : 'Added to the handoff.'
          : 'Suggestion not added.'),
      },
    );
  }
  function reject(item: KnowledgeItem) {
    const message = 'It will not appear in the handoff. Your original capture remains unchanged.';
    if (Platform.OS === 'web') {
      if (window.confirm(`Don't add this?\n\n${message}`)) decide(item, 'rejected');
      return;
    }
    Alert.alert(
      'Don\'t add this?',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => decide(item, 'rejected') },
      ],
    );
  }
  async function returnToCapture() {
    await captureMutation.mutateAsync({ handoffId });
    router.replace((`/handoff/${handoffId}`) as Href);
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{roleQuery.data.title}</AppText>
        <AppText variant="display">Review what Relay found</AppText>
        <AppText color={colors.inkMuted}>Add only what belongs in the handoff. You can edit anything before adding it.</AppText>
      </View>

      <View style={styles.reviewSummary}>
        <View style={styles.summaryIcon}>
          <MaterialCommunityIcons color={proposals.length ? colors.saffron : colors.moss} name={proposals.length ? 'clipboard-text-clock-outline' : 'check-decagram-outline'} size={28} />
        </View>
        <View style={styles.rowCopy}>
          <AppText variant="heading">
            {proposals.length ? `${proposals.length} ${proposals.length === 1 ? 'thing' : 'things'} to review` : 'Everything reviewed'}
          </AppText>
          <AppText color={colors.inkMuted}>{approved.length} {approved.length === 1 ? 'item is' : 'items are'} already in your handoff.</AppText>
        </View>
      </View>

      {decisionNotice ? (
        <View accessibilityLiveRegion="polite" style={styles.decisionNotice}>
          <MaterialCommunityIcons color={colors.moss} name="check-circle-outline" size={20} />
          <AppText variant="label" color={colors.moss} style={styles.rowCopy}>{decisionNotice}</AppText>
        </View>
      ) : null}

      {proposals.length ? (
        <View style={styles.section}>
          {proposalGroups.map((group) => (
            <View key={group.captureId} style={styles.captureGroup}>
              <View style={styles.sectionHeading}>
                <AppText variant="heading">{group.title}</AppText>
                <AppText variant="caption" color={colors.inkMuted}>
                  {group.proposals.length} {group.proposals.length === 1 ? 'suggestion' : 'suggestions'} from this capture
                </AppText>
              </View>
              <View style={styles.list}>
                {group.proposals.map((item) => (
                  <ProposalCard
                    item={item}
                    key={item.id}
                    pending={decisionMutation.isPending}
                    provenance={provenanceQuery.data.filter((evidence) => evidence.knowledgeItemId === item.id)}
                    existingItem={item.proposalTargetId
                      ? approved.find((candidate) => candidate.id === item.proposalTargetId) ?? null
                      : null}
                    onAccept={() => decide(item, 'approved')}
                    onReject={() => reject(item)}
                  />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {!proposals.length && !approved.length ? (
        <View style={styles.empty}>
          <AppText variant="label">Nothing has been added yet</AppText>
          <AppText color={colors.inkMuted}>Return to Capture and add what the next leader should know.</AppText>
        </View>
      ) : null}

      {!proposals.length && approved.length ? (
        <View style={styles.preflightCard}>
          <View style={styles.sectionHeading}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>REVIEW COMPLETE</AppText>
            <AppText variant="heading">
              {checkMutation.isPending
                ? 'Checking your handoff…'
                : preflightQuery.data?.status === 'ready' && !preflightQuery.data.findingCount
                  ? 'Your handoff looks ready.'
                  : preflightQuery.data?.status === 'ready'
                    ? `${preflightQuery.data.findingCount} ${preflightQuery.data.findingCount === 1 ? 'detail needs' : 'details need'} attention`
                    : checkMutation.error || preflightQuery.data?.status === 'failed'
                      ? "We couldn't check your handoff."
                      : 'Checking your handoff…'}
            </AppText>
            <AppText color={colors.inkMuted}>Relay checks for meaningful missing detail, ambiguity, incomplete instructions, and contradictions.</AppText>
          </View>
          {checkMutation.error || preflightQuery.data?.status === 'failed' ? (
            <Button icon="refresh" label="Try check again" onPress={() => checkMutation.mutate({ handoffId })} />
          ) : preflightQuery.data?.status === 'ready' ? (
            <Button icon="shield-check-outline" label="View handoff check" onPress={() => router.push((`/handoff-preflight?handoffId=${handoffId}`) as Href)} />
          ) : null}
        </View>
      ) : null}

      {decisionMutation.error || captureMutation.error ? (
        <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.emergency}>
          {(decisionMutation.error ?? captureMutation.error)?.message}
        </AppText>
      ) : null}

      <Button
        disabled={captureMutation.isPending}
        icon="arrow-left"
        label={captureMutation.isPending ? 'Returning…' : 'Return to Capture'}
        tone="secondary"
        onPress={() => void returnToCapture()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1, textTransform: 'uppercase' },
  reviewSummary: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  summaryIcon: {
    width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  decisionNotice: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    marginTop: spacing.md, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  rowCopy: { flex: 1, gap: spacing.xxs },
  section: { gap: spacing.md, marginTop: spacing.xl },
  captureGroup: {
    gap: spacing.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.lg, backgroundColor: colors.canvas,
  },
  sectionHeading: { gap: spacing.xxs },
  list: { gap: spacing.sm },
  proposalCard: {
    gap: spacing.sm, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  proposalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  proposalBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xxs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
    borderRadius: radii.pill, backgroundColor: colors.saffronSoft,
  },
  typeLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  changeComparison: {
    gap: spacing.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.md, backgroundColor: colors.canvas,
  },
  changeBlock: { gap: spacing.xs },
  changeDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  proposalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flexAction: { flex: 1 },
  uncertainty: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.saffronSoft },
  supportSection: { gap: spacing.xs },
  supportToggle: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  evidence: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  empty: {
    gap: spacing.xs, marginTop: spacing.xl, padding: spacing.lg, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  preflightCard: { gap: spacing.md, marginTop: spacing.xl, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  pressed: { opacity: 0.72 },
});
