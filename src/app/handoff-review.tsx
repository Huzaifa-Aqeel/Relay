import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { KNOWLEDGE_META } from '@/features/relay/knowledge-meta';
import {
  useDecideKnowledgeProposal,
  useHandoff,
  useKnowledgeItems,
  useKnowledgeProvenance,
  useReturnHandoffToCapture,
  useRole,
} from '@/features/relay/queries';
import type { KnowledgeItem, KnowledgeProvenance } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

function ApprovedRow({ item }: { item: KnowledgeItem }) {
  const meta = KNOWLEDGE_META[item.knowledgeType];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Edit ${item.title}`}
      onPress={() => router.push((`/knowledge/${item.id}?returnTo=review`) as Href)}
      style={({ pressed }) => [styles.approvedRow, pressed && styles.pressed]}>
      <View style={styles.smallIcon}>
        <MaterialCommunityIcons color={colors.moss} name={meta.icon} size={20} />
      </View>
      <View style={styles.rowCopy}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{meta.label}</AppText>
        <AppText variant="label">{item.title}</AppText>
        <AppText color={colors.inkMuted} numberOfLines={2}>{item.content}</AppText>
      </View>
      <MaterialCommunityIcons color={colors.inkMuted} name="pencil-outline" size={20} />
    </Pressable>
  );
}

function ProposalCard({
  item,
  pending,
  onAccept,
  onReject,
  provenance,
}: {
  item: KnowledgeItem;
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  provenance: KnowledgeProvenance[];
}) {
  const meta = KNOWLEDGE_META[item.knowledgeType];
  return (
    <View style={styles.proposalCard}>
      <View style={styles.proposalHeader}>
        <View style={styles.proposalBadge}>
          <MaterialCommunityIcons color={colors.saffron} name="creation-outline" size={17} />
          <AppText variant="caption" color={colors.ink}>PROPOSED</AppText>
        </View>
        <AppText variant="caption" color={colors.inkMuted}>{meta.label}</AppText>
      </View>
      <AppText variant="heading">{item.title}</AppText>
      <AppText color={colors.inkMuted}>{item.content}</AppText>
      {provenance.map((evidence) => (
        <View key={`${evidence.knowledgeItemId}:${evidence.sourceId}`} style={styles.evidence}>
          <View style={styles.evidenceHeading}>
            <MaterialCommunityIcons color={colors.moss} name="file-check-outline" size={18} />
            <AppText variant="caption" color={colors.moss} style={styles.rowCopy}>
              {evidence.sourceTitle}{evidence.sourceLocator ? ` · ${evidence.sourceLocator}` : ''}
            </AppText>
          </View>
          {evidence.sourceExcerpt ? (
            <AppText variant="caption" color={colors.inkMuted}>“{evidence.sourceExcerpt}”</AppText>
          ) : null}
        </View>
      ))}
      {item.uncertaintyNote ? (
        <View style={styles.uncertainty}>
          <MaterialCommunityIcons color={colors.saffron} name="help-circle-outline" size={20} />
          <AppText variant="caption" color={colors.inkMuted} style={styles.rowCopy}>{item.uncertaintyNote}</AppText>
        </View>
      ) : null}
      <View style={styles.proposalActions}>
        <Button disabled={pending} icon="check" label="Accept" onPress={onAccept} style={styles.flexAction} />
        <Button
          disabled={pending}
          icon="pencil-outline"
          label="Edit"
          tone="secondary"
          onPress={() => router.push((`/knowledge/${item.id}?returnTo=review`) as Href)}
          style={styles.flexAction}
        />
      </View>
      <Button disabled={pending} icon="close" label="Reject proposal" tone="ghost" onPress={onReject} />
    </View>
  );
}

export default function HandoffReviewScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const knowledgeQuery = useKnowledgeItems(handoffId);
  const provenanceQuery = useKnowledgeProvenance(handoffId);
  const decisionMutation = useDecideKnowledgeProposal();
  const captureMutation = useReturnHandoffToCapture();
  const pending = handoffQuery.isPending || knowledgeQuery.isPending || provenanceQuery.isPending || (handoffQuery.data && roleQuery.isPending);
  const error = handoffQuery.error ?? roleQuery.error ?? knowledgeQuery.error ?? provenanceQuery.error;

  if (pending) return <Screen><LoadingState label="Preparing review…" /></Screen>;
  if (error || !handoffQuery.data || !roleQuery.data || !knowledgeQuery.data || !provenanceQuery.data) {
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

  const proposals = knowledgeQuery.data.filter((item) => item.status === 'proposed');
  const approved = knowledgeQuery.data.filter((item) => item.status === 'approved');

  function decide(item: KnowledgeItem, decision: 'approved' | 'rejected') {
    decisionMutation.mutate({ id: item.id, handoffId, decision });
  }
  function reject(item: KnowledgeItem) {
    Alert.alert(
      'Reject this proposal?',
      'It will not appear in the handoff. The original source remains unchanged.',
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
        <AppText variant="display">Review the truth</AppText>
        <AppText color={colors.inkMuted}>AI suggestions are evidence-backed drafts. Nothing becomes approved knowledge until you accept or edit it.</AppText>
      </View>

      <View style={styles.reviewSummary}>
        <View style={styles.summaryIcon}>
          <MaterialCommunityIcons color={proposals.length ? colors.saffron : colors.moss} name={proposals.length ? 'clipboard-text-clock-outline' : 'check-decagram-outline'} size={28} />
        </View>
        <View style={styles.rowCopy}>
          <AppText variant="heading">{proposals.length ? `${proposals.length} to review` : 'Everything reviewed'}</AppText>
          <AppText color={colors.inkMuted}>{approved.length} approved {approved.length === 1 ? 'item' : 'items'} ready for Preflight.</AppText>
        </View>
      </View>

      {proposals.length ? (
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <AppText variant="caption" color={colors.saffron} style={styles.eyebrow}>HUMAN DECISION REQUIRED</AppText>
            <AppText variant="heading">Proposed knowledge</AppText>
          </View>
          <View style={styles.list}>
            {proposals.map((item) => (
              <ProposalCard
                item={item}
                key={item.id}
                pending={decisionMutation.isPending}
                provenance={provenanceQuery.data.filter((evidence) => evidence.knowledgeItemId === item.id)}
                onAccept={() => decide(item, 'approved')}
                onReject={() => reject(item)}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>CANONICAL HANDOFF</AppText>
          <AppText variant="heading">Approved knowledge</AppText>
        </View>
        {approved.length ? (
          <View style={styles.list}>{approved.map((item) => <ApprovedRow item={item} key={item.id} />)}</View>
        ) : (
          <View style={styles.empty}>
            <AppText variant="label">No approved knowledge yet</AppText>
            <AppText color={colors.inkMuted}>Accept a proposal or return to Capture and add an item manually.</AppText>
          </View>
        )}
      </View>

      {!proposals.length && approved.length ? (
        <View style={styles.preflightCard}>
          <View style={styles.sectionHeading}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>REVIEW COMPLETE</AppText>
            <AppText variant="heading">Check whether a successor would have to guess</AppText>
            <AppText color={colors.inkMuted}>Preflight looks for missing, ambiguous, incomplete, or conflicting instructions before anything can be published.</AppText>
          </View>
          <Button
            icon="shield-check-outline"
            label="Continue to Preflight"
            onPress={() => router.push((`/handoff-preflight?handoffId=${handoffId}`) as Href)}
          />
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
  rowCopy: { flex: 1, gap: spacing.xxs },
  section: { gap: spacing.md, marginTop: spacing.xl },
  sectionHeading: { gap: spacing.xxs },
  list: { gap: spacing.sm },
  proposalCard: {
    gap: spacing.sm, padding: spacing.lg,
    borderWidth: 1, borderColor: '#EACB95',
    borderRadius: radii.lg, backgroundColor: '#FFFBF4',
  },
  proposalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  proposalBadge: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xxs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
    borderRadius: radii.pill, backgroundColor: colors.saffronSoft,
  },
  proposalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flexAction: { flex: 1 },
  uncertainty: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.saffronSoft },
  evidence: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  evidenceHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  approvedRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  smallIcon: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  empty: {
    gap: spacing.xs, padding: spacing.lg, borderWidth: 1, borderStyle: 'dashed',
    borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  preflightCard: { gap: spacing.md, marginTop: spacing.xl, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  pressed: { opacity: 0.72 },
});
