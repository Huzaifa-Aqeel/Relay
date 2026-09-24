import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { KNOWLEDGE_META } from '@/features/relay/knowledge-meta';
import { UnifiedCaptureComposer } from '@/features/relay/unified-capture-composer';
import {
  useBeginHandoffReview,
  useGenerateCaptureProposals,
  useHandoff,
  useHandoffCaptures,
  useKnowledgeItems,
  useMoveKnowledgeItem,
  useOrganization,
  useRole,
} from '@/features/relay/queries';
import { captureReviewSummary, handoffStageIndex, HANDOFF_STAGES } from '@/features/relay/shell-model';
import { broadKnowledgeType, type HandoffCapture, type KnowledgeItem } from '@/features/relay/types';
import { checkContinuityError, useContinuity, useContinuityAction } from '@/features/relay/continuity';
import { requireSupabase } from '@/lib/supabase';
import { colors, radii, spacing } from '@/theme/tokens';

function CaptureCard({
  capture,
  editable,
  pendingProposalCount,
  structuring,
  onStructure,
  onEdit,
}: {
  capture: HandoffCapture;
  editable: boolean;
  pendingProposalCount: number;
  structuring: boolean;
  onStructure: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const processing = capture.attachments.some((source) => source.processingStatus === 'processing');
  const failed = capture.attachments.some((source) => source.processingStatus === 'failed');
  const reviewSummary = captureReviewSummary({
    structuredProposalCount: capture.structuredProposalCount,
    pendingProposalCount,
  });
  const summary = [
    capture.attachments.length
      ? `${capture.attachments.length} ${capture.attachments.length === 1 ? 'file' : 'files'}`
      : null,
    capture.textContent ? 'note' : null,
  ].filter(Boolean).join(' · ');
  return (
    <View style={styles.sourceCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} capture ${capture.title}`}
        disabled={!capture.attachments.length}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => [styles.sourceMain, pressed && styles.pressed]}>
        <View style={styles.sourceIcon}>
          <MaterialCommunityIcons color={colors.moss} name={capture.promptId ? 'lightbulb-on-outline' : 'note-edit-outline'} size={23} />
        </View>
        <View style={styles.cardCopy}>
          <View style={styles.cardTitleRow}>
            <AppText variant="label" style={styles.cardTitle}>{capture.title}</AppText>
          </View>
          <AppText variant="caption" color={colors.inkMuted}>{summary || 'Capture'}</AppText>
          {capture.textContent ? <AppText color={colors.inkMuted} numberOfLines={2}>{capture.textContent}</AppText> : null}
        </View>
        {capture.attachments.length ? (
          <MaterialCommunityIcons color={colors.inkMuted} name={expanded ? 'chevron-up' : 'chevron-down'} size={22} />
        ) : null}
      </Pressable>
      {editable ? (
        <View style={styles.captureActions}>
          <Button disabled={structuring || processing} icon="pencil-outline" label="Edit" tone="ghost" onPress={onEdit} />
          <Button
            disabled={structuring || processing}
            icon="creation-outline"
            label={structuring || processing ? 'Organizing…' : capture.structuringStatus === 'ready' ? 'Organize again' : 'Organize'}
            tone="secondary"
            onPress={onStructure}
          />
        </View>
      ) : null}
      {expanded && capture.attachments.length ? (
        <View style={styles.attachmentList}>
          {capture.attachments.map((source) => (
            <View key={source.id} style={styles.attachmentRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push((`/source/${source.id}`) as Href)}
                style={({ pressed }) => [styles.attachmentMain, pressed && styles.pressed]}>
                <MaterialCommunityIcons color={colors.moss} name="file-document-outline" size={20} />
                <View style={styles.cardCopy}>
                  <AppText variant="label">{source.title}</AppText>
                  <AppText variant="caption" color={source.processingStatus === 'failed' ? colors.emergency : colors.inkMuted}>
                    {source.processingStatus === 'pending'
                      ? 'Ready to organize'
                      : source.processingStatus === 'processing'
                        ? 'Preparing document…'
                        : source.processingStatus === 'ready'
                          ? 'Ready'
                          : source.failureReason ?? 'Document processing failed'}
                  </AppText>
                </View>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {editable ? (
        <View style={styles.sourceRetry}>
          {processing ? (
            <View style={styles.structureResult}>
              <MaterialCommunityIcons color={colors.moss} name="file-sync-outline" size={19} />
              <AppText variant="caption" color={colors.inkMuted} style={styles.cardCopy}>Preparing attached files, then Relay will organize this capture…</AppText>
            </View>
          ) : failed ? (
            <AppText variant="caption" color={colors.emergency} style={styles.captureStatus}>
              A file could not be prepared. Choose Organize to try again, or edit this capture.
            </AppText>
          ) : structuring || capture.structuringStatus === 'processing' ? (
            <View style={styles.structureResult}>
              <MaterialCommunityIcons color={colors.moss} name="creation-outline" size={19} />
              <AppText variant="caption" color={colors.inkMuted} style={styles.cardCopy}>Organizing this capture…</AppText>
            </View>
          ) : capture.structuringStatus === 'ready' && reviewSummary ? (
            <View style={styles.structureResult}>
              <MaterialCommunityIcons color={colors.moss} name="check-circle-outline" size={19} />
              <AppText variant="caption" color={colors.moss} style={styles.cardCopy}>
                {reviewSummary}
              </AppText>
            </View>
          ) : capture.structuringStatus === 'failed' ? (
            <AppText variant="caption" color={colors.emergency} style={styles.captureStatus}>
              {capture.structuringFailureReason ?? "We couldn't organize this capture. Choose Organize to try again."}
            </AppText>
          ) : capture.structuringStatus !== 'ready' ? (
            <View style={styles.structureResult}>
              <MaterialCommunityIcons color={colors.moss} name="content-save-check-outline" size={19} />
              <AppText variant="caption" color={colors.inkMuted} style={styles.cardCopy}>Saved · ready to organize</AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function KnowledgeCard({
  item,
  editable,
  index,
  total,
  moving,
  onMove,
}: {
  item: KnowledgeItem;
  editable: boolean;
  index: number;
  total: number;
  moving: boolean;
  onMove: (direction: 'up' | 'down') => void;
}) {
  const meta = KNOWLEDGE_META[item.knowledgeType];
  const warning = broadKnowledgeType(item.knowledgeType) === 'warning_lesson';
  return (
    <View style={[styles.knowledgeCard, warning && styles.warningCard]}>
      <Pressable
        accessibilityRole={editable ? 'button' : undefined}
        accessibilityLabel={editable ? `Edit ${item.title}` : item.title}
        disabled={!editable}
        onPress={editable ? () => router.push((`/knowledge/${item.id}`) as Href) : undefined}
        style={({ pressed }) => [styles.knowledgeMain, pressed && styles.pressed]}>
        <View style={[styles.knowledgeIcon, warning && styles.warningIcon]}>
          <MaterialCommunityIcons
            color={warning ? colors.emergency : colors.moss}
            name={meta.icon}
            size={23}
          />
        </View>
        <View style={styles.cardCopy}>
          <AppText variant="caption" color={warning ? colors.emergency : colors.moss} style={styles.typeLabel}>
            {meta.label}
          </AppText>
          <AppText variant="label">{item.title}</AppText>
          {item.inheritedFromServicePeriod ? <AppText variant="caption">Carried forward from {item.inheritedFromServicePeriod}</AppText> : null}
          <AppText color={colors.inkMuted} numberOfLines={4}>{item.content}</AppText>
        </View>
        {editable ? <MaterialCommunityIcons color={colors.inkMuted} name="chevron-right" size={22} /> : null}
      </Pressable>
      {editable && total > 1 ? (
        <View style={styles.orderActions}>
          <Pressable
            accessibilityLabel={`Move ${item.title} earlier`}
            accessibilityRole="button"
            disabled={index === 0 || moving}
            onPress={() => onMove('up')}
            style={({ pressed }) => [styles.orderButton, (index === 0 || moving) && styles.actionDisabled, pressed && styles.pressed]}>
            <MaterialCommunityIcons color={colors.inkMuted} name="arrow-up" size={18} />
            <AppText variant="caption" color={colors.inkMuted}>Earlier</AppText>
          </Pressable>
          <Pressable
            accessibilityLabel={`Move ${item.title} later`}
            accessibilityRole="button"
            disabled={index === total - 1 || moving}
            onPress={() => onMove('down')}
            style={({ pressed }) => [styles.orderButton, (index === total - 1 || moving) && styles.actionDisabled, pressed && styles.pressed]}>
            <MaterialCommunityIcons color={colors.inkMuted} name="arrow-down" size={18} />
            <AppText variant="caption" color={colors.inkMuted}>Later</AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function HandoffScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [editingCapture, setEditingCapture] = useState<HandoffCapture | null>(null);
  const handoffQuery = useHandoff(id);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const organizationQuery = useOrganization(handoffQuery.data?.organizationId);
  const continuity = useContinuity(handoffQuery.data?.organizationId);
  const reopen = useContinuityAction(async () => {
    const { error } = await requireSupabase().rpc('reopen_handoff_for_revision', { requested_handoff_id: id });
    checkContinuityError(error);
  });
  const capturesQuery = useHandoffCaptures(id);
  const knowledgeQuery = useKnowledgeItems(id);
  const moveMutation = useMoveKnowledgeItem();
  const reviewMutation = useBeginHandoffReview();
  const structureMutation = useGenerateCaptureProposals();
  const pending = handoffQuery.isPending
    || capturesQuery.isPending
    || knowledgeQuery.isPending
    || (handoffQuery.data && (roleQuery.isPending || organizationQuery.isPending));
  const error = handoffQuery.error
    ?? roleQuery.error
    ?? organizationQuery.error
    ?? capturesQuery.error
    ?? knowledgeQuery.error;

  if (pending) return <Screen><LoadingState label="Opening handoff…" /></Screen>;
  if (error || !handoffQuery.data || !roleQuery.data || !organizationQuery.data || !capturesQuery.data || !knowledgeQuery.data) {
    return (
      <Screen>
        <MessageState
          icon="file-document-alert-outline"
          title="Handoff unavailable"
          body={error?.message ?? 'This handoff does not exist or you do not have access.'}
          actionLabel="Back to organizations"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const handoff = handoffQuery.data;
  if (continuity.data && !continuity.data.roles.some(r => r.handoffs.some(h => h.id === id && h.canMaintain))) {
    return <Screen><AppText>This workspace is private to its assigned Role Holder.</AppText><Button label="Open published history" onPress={() => router.replace(`/published-history?handoffId=${id}` as Href)} /></Screen>;
  }
  const role = roleQuery.data;
  const organization = organizationQuery.data;
  const captures = capturesQuery.data;
  const approvedItems = knowledgeQuery.data.filter((item) => item.status === 'approved');
  const proposedItems = knowledgeQuery.data.filter((item) => item.status === 'proposed');
  const activeStage = handoffStageIndex(handoff.stage);

  function move(item: KnowledgeItem, direction: 'up' | 'down') {
    moveMutation.mutate({ id: item.id, handoffId: handoff.id, direction });
  }

  async function openNextStep() {
    if (handoff.stage === 'preview' || handoff.stage === 'published') {
      router.push((`/handoff-preview?handoffId=${handoff.id}`) as Href);
      return;
    }
    if (handoff.stage === 'preflight') {
      router.push((`/handoff-preflight?handoffId=${handoff.id}`) as Href);
      return;
    }
    if (handoff.stage === 'capture') {
      await reviewMutation.mutateAsync({ handoffId: handoff.id });
    }
    router.push((`/handoff-review?handoffId=${handoff.id}`) as Href);
  }

  const nextStepCopy = handoff.stage === 'published'
    ? {
        eyebrow: 'PUBLISHED',
        title: 'Manage recipient access',
        body: 'Open the exact published snapshot to copy, share, show its QR code, revoke access, or replace the link.',
        button: 'Preview & share',
        icon: 'share-variant-outline' as const,
      }
    : handoff.stage === 'preflight'
    ? {
        eyebrow: 'HANDOFF CHECK',
        title: 'Settle the details before Preview',
        body: 'Review evidence-backed gaps, resolve what you know, and make deliberate decisions about what remains.',
        button: 'Open handoff check',
        icon: 'shield-check-outline' as const,
      }
    : handoff.stage === 'preview'
      ? {
          eyebrow: 'READY FOR PREVIEW',
          title: 'Handoff check decisions are recorded',
          body: 'Review exactly what the incoming leader will see, then publish the approved snapshot when it is ready.',
          button: 'Preview recipient view',
          icon: 'eye-check-outline' as const,
        }
      : {
          eyebrow: 'NEXT STEP',
          title: 'Review what Relay found',
          body: 'Choose what belongs in the handoff. Relay checks it automatically when Review is complete.',
          button: 'Review findings',
          icon: 'arrow-right' as const,
        };

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{organization.name.toUpperCase()}</AppText>
        <AppText variant="display">{role.title} handoff</AppText>
        <AppText color={colors.inkMuted}>{handoff.servicePeriod} · {handoff.status === 'draft' ? 'Private draft' : 'Published snapshot'}</AppText>
        <AppText color={colors.inkMuted}>Keep this living workspace current throughout your term. Review and publish when preparing to transfer the Role; routine edits are saved without publishing.</AppText>
        {handoff.status === 'published' ? <Button tone="secondary" label="Resume working draft" disabled={reopen.isPending} onPress={() => reopen.mutate()} /> : null}
        {reopen.error ? <AppText>{reopen.error.message}</AppText> : null}
      </View>

      <View accessibilityLabel={`Handoff stage: ${HANDOFF_STAGES[activeStage]}`} style={styles.stages}>
        {HANDOFF_STAGES.map((stage, index) => {
          const reached = index <= activeStage;
          const active = index === activeStage;
          return (
            <View key={stage} style={styles.stage}>
              <View style={[styles.stageDot, reached && styles.stageDotReached, active && styles.stageDotActive]}>
                {index < activeStage ? (
                  <MaterialCommunityIcons color={colors.white} name="check" size={16} />
                ) : (
                  <AppText variant="caption" color={reached ? colors.white : colors.inkMuted}>{index + 1}</AppText>
                )}
              </View>
              <AppText variant="caption" color={active ? colors.moss : colors.inkMuted}>{stage}</AppText>
            </View>
          );
        })}
      </View>

      {handoff.status === 'draft' ? (
        <UnifiedCaptureComposer
          editingCapture={editingCapture}
          organizationId={handoff.organizationId}
          handoffId={handoff.id}
          onEditComplete={() => setEditingCapture(null)}
        />
      ) : null}

      <View style={styles.contentSection}>
        <View style={styles.sectionTitle}>
          <AppText variant="heading">What the next leader should know</AppText>
        </View>
        {approvedItems.length ? (
          <View style={styles.list}>
            {approvedItems.map((item, index) => (
              <KnowledgeCard
                editable={handoff.status === 'draft'}
                item={item}
                index={index}
                key={item.id}
                moving={moveMutation.isPending}
                total={approvedItems.length}
                onMove={(direction) => move(item, direction)}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons color={colors.moss} name="clipboard-text-outline" size={30} />
            <View style={styles.cardCopy}>
              <AppText variant="label">Nothing added yet</AppText>
              <AppText color={colors.inkMuted}>Organize your captures, then review what belongs in the handoff.</AppText>
            </View>
          </View>
        )}
        {moveMutation.error ? (
          <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.emergency}>{moveMutation.error.message}</AppText>
        ) : null}
      </View>

      {approvedItems.length + proposedItems.length > 0 ? (
        <View style={styles.reviewCard}>
          <View style={styles.reviewCopy}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{nextStepCopy.eyebrow}</AppText>
            <AppText variant="heading">{nextStepCopy.title}</AppText>
            <AppText color={colors.inkMuted}>{nextStepCopy.body}</AppText>
          </View>
          <Button
            disabled={reviewMutation.isPending}
            icon={nextStepCopy.icon}
            label={reviewMutation.isPending ? 'Opening review…' : nextStepCopy.button}
            onPress={() => void openNextStep()}
          />
          {reviewMutation.error ? (
            <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.emergency}>{reviewMutation.error.message}</AppText>
          ) : null}
        </View>
      ) : null}

      <View style={styles.contentSection}>
        <View style={styles.sectionTitle}>
          <AppText variant="heading">Your captures</AppText>
        </View>
        {captures.length ? (
          <View style={styles.list}>
            {captures.map((capture) => (
              <CaptureCard
                capture={capture}
                editable={handoff.status === 'draft'}
                key={capture.id}
                pendingProposalCount={proposedItems.filter((item) => item.captureId === capture.id).length}
                structuring={structureMutation.isPending && structureMutation.variables?.captureId === capture.id}
                onEdit={() => setEditingCapture(capture)}
                onStructure={() => structureMutation.mutate({ captureId: capture.id, handoffId: capture.handoffId })}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons color={colors.moss} name="tray-arrow-up" size={30} />
            <View style={styles.cardCopy}>
              <AppText variant="label">No captures yet</AppText>
              <AppText color={colors.inkMuted}>Write, record, or attach what the next leader should know.</AppText>
            </View>
          </View>
        )}
        {structureMutation.error ? (
          <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.emergency}>
            {structureMutation.error.message}
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.lg },
  eyebrow: { letterSpacing: 1.2 },
  stages: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xxs, marginBottom: spacing.lg, paddingVertical: spacing.sm },
  stage: { flex: 1, alignItems: 'center', gap: spacing.xs },
  stageDot: { width: 30, height: 30, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted },
  stageDotReached: { backgroundColor: '#789786' },
  stageDotActive: { backgroundColor: colors.moss },
  sectionTitle: { gap: spacing.xxs },
  contentSection: { gap: spacing.md, marginTop: spacing.xl },
  reviewCard: {
    gap: spacing.md, marginTop: spacing.xl, padding: spacing.lg,
    borderRadius: radii.lg, backgroundColor: colors.mossSoft,
  },
  reviewCopy: { gap: spacing.xs },
  list: { gap: spacing.sm },
  sourceCard: { overflow: 'hidden', borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  sourceMain: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, padding: spacing.md },
  sourceRetry: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, backgroundColor: colors.canvas },
  captureActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingBottom: spacing.sm,
  },
  captureStatus: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  attachmentList: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  attachmentRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  attachmentMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  structureAction: { gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  structureResult: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.md },
  sourceIcon: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  cardCopy: { flex: 1, gap: spacing.xxs },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: { flex: 1 },
  knowledgeCard: {
    overflow: 'hidden', borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  warningCard: { borderColor: '#E8C0B8' },
  knowledgeMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  knowledgeIcon: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  warningIcon: { backgroundColor: '#F8E5E1' },
  typeLabel: { textTransform: 'uppercase', letterSpacing: 0.8 },
  orderActions: {
    flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line,
    backgroundColor: colors.canvas,
  },
  orderButton: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xxs,
    minHeight: 40, paddingHorizontal: spacing.sm, borderRadius: radii.pill,
  },
  actionDisabled: { opacity: 0.35 },
  emptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderWidth: 1, borderColor: colors.line,
    borderStyle: 'dashed', borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.72 },
});
