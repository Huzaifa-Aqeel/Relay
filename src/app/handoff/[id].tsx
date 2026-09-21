import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { KNOWLEDGE_META, SOURCE_META } from '@/features/relay/knowledge-meta';
import {
  useBeginHandoffReview,
  useGenerateKnowledgeProposals,
  useHandoff,
  useHandoffSources,
  useKnowledgeItems,
  useMoveKnowledgeItem,
  useOrganization,
  useRetrySourceProcessing,
  useRole,
} from '@/features/relay/queries';
import { HANDOFF_STAGES } from '@/features/relay/shell-model';
import type { HandoffSource, KnowledgeItem } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

function sourcePreview(source: HandoffSource) {
  if (!source.textContent) return source.processingStatus === 'failed' ? source.failureReason : 'Original source saved privately.';
  const clean = source.textContent.replace(/\s+/g, ' ').trim();
  return clean.length > 150 ? `${clean.slice(0, 147)}…` : clean;
}

function SourceCard({
  source,
  editable,
  retrying,
  onRetry,
  structuring,
  onStructure,
}: {
  source: HandoffSource;
  editable: boolean;
  retrying: boolean;
  onRetry: () => void;
  structuring: boolean;
  onStructure: () => void;
}) {
  const meta = SOURCE_META[source.kind];
  return (
    <View style={styles.sourceCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open source ${source.title}`}
        onPress={() => router.push((`/source/${source.id}`) as Href)}
        style={({ pressed }) => [styles.sourceMain, pressed && styles.pressed]}>
        <View style={styles.sourceIcon}>
          <MaterialCommunityIcons color={colors.moss} name={meta.icon} size={23} />
        </View>
        <View style={styles.cardCopy}>
          <View style={styles.cardTitleRow}>
            <AppText variant="label" style={styles.cardTitle}>{source.title}</AppText>
            <AppText variant="caption" color={source.processingStatus === 'failed' ? colors.emergency : colors.inkMuted}>
              {source.processingStatus === 'ready' ? 'Ready' : source.processingStatus}
            </AppText>
          </View>
          <AppText variant="caption" color={colors.inkMuted}>{meta.label}</AppText>
          {source.kind === 'document' ? (
            <AppText variant="caption" color={source.isCurrent ? colors.moss : colors.inkMuted}>
              Version {source.versionNumber} · {source.isCurrent ? 'Current' : 'Historical'}
            </AppText>
          ) : null}
          <AppText color={colors.inkMuted} numberOfLines={3}>{sourcePreview(source)}</AppText>
        </View>
        <MaterialCommunityIcons color={colors.inkMuted} name="chevron-right" size={22} />
      </Pressable>
      {editable && source.processingStatus === 'failed' && source.kind !== 'typed_text' ? (
        <View style={styles.sourceRetry}>
          <Button disabled={retrying} icon="refresh" label={retrying ? 'Retrying…' : 'Retry processing'} tone="ghost" onPress={onRetry} />
        </View>
      ) : null}
      {editable && source.isCurrent && source.processingStatus === 'ready' && source.textContent ? (
        <View style={styles.sourceRetry}>
          {source.structuringStatus === 'ready' ? (
            <View style={styles.structureResult}>
              <MaterialCommunityIcons color={colors.moss} name="check-circle-outline" size={19} />
              <AppText variant="caption" color={colors.moss} style={styles.cardCopy}>
                {source.structuredProposalCount
                  ? `${source.structuredProposalCount} ${source.structuredProposalCount === 1 ? 'proposal' : 'proposals'} created from this source`
                  : 'Checked · no new proposals found'}
              </AppText>
            </View>
          ) : (
            <View style={styles.structureAction}>
              {source.structuringFailureReason ? (
                <AppText variant="caption" color={colors.emergency} style={styles.cardCopy}>
                  {source.structuringFailureReason}
                </AppText>
              ) : (
                <AppText variant="caption" color={colors.inkMuted} style={styles.cardCopy}>
                  Turn this evidence into suggestions you can approve, edit, or reject.
                </AppText>
              )}
              <Button
                disabled={structuring || source.structuringStatus === 'processing'}
                icon={source.structuringStatus === 'failed' ? 'refresh' : 'creation-outline'}
                label={structuring || source.structuringStatus === 'processing'
                  ? 'Structuring…'
                  : source.structuringStatus === 'failed' ? 'Retry' : 'Create proposals'}
                tone="ghost"
                onPress={onStructure}
              />
            </View>
          )}
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
  return (
    <View style={[styles.knowledgeCard, item.knowledgeType === 'warning' && styles.warningCard]}>
      <Pressable
        accessibilityRole={editable ? 'button' : undefined}
        accessibilityLabel={editable ? `Edit ${item.title}` : item.title}
        disabled={!editable}
        onPress={editable ? () => router.push((`/knowledge/${item.id}`) as Href) : undefined}
        style={({ pressed }) => [styles.knowledgeMain, pressed && styles.pressed]}>
        <View style={[styles.knowledgeIcon, item.knowledgeType === 'warning' && styles.warningIcon]}>
          <MaterialCommunityIcons
            color={item.knowledgeType === 'warning' ? colors.emergency : colors.moss}
            name={meta.icon}
            size={23}
          />
        </View>
        <View style={styles.cardCopy}>
          <AppText variant="caption" color={item.knowledgeType === 'warning' ? colors.emergency : colors.moss} style={styles.typeLabel}>
            {meta.label}
          </AppText>
          <AppText variant="label">{item.title}</AppText>
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
  const handoffQuery = useHandoff(id);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const organizationQuery = useOrganization(handoffQuery.data?.organizationId);
  const sourcesQuery = useHandoffSources(id);
  const knowledgeQuery = useKnowledgeItems(id);
  const moveMutation = useMoveKnowledgeItem();
  const reviewMutation = useBeginHandoffReview();
  const retryMutation = useRetrySourceProcessing();
  const structureMutation = useGenerateKnowledgeProposals();
  const pending = handoffQuery.isPending
    || sourcesQuery.isPending
    || knowledgeQuery.isPending
    || (handoffQuery.data && (roleQuery.isPending || organizationQuery.isPending));
  const error = handoffQuery.error
    ?? roleQuery.error
    ?? organizationQuery.error
    ?? sourcesQuery.error
    ?? knowledgeQuery.error;

  if (pending) return <Screen><LoadingState label="Opening handoff…" /></Screen>;
  if (error || !handoffQuery.data || !roleQuery.data || !organizationQuery.data || !sourcesQuery.data || !knowledgeQuery.data) {
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
  const role = roleQuery.data;
  const organization = organizationQuery.data;
  const sources = sourcesQuery.data;
  const approvedItems = knowledgeQuery.data.filter((item) => item.status === 'approved');
  const proposedItems = knowledgeQuery.data.filter((item) => item.status === 'proposed');
  const activeStage = Math.max(0, HANDOFF_STAGES.findIndex((stage) => stage.toLowerCase() === handoff.stage));

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
        eyebrow: 'PREFLIGHT',
        title: 'Settle questions before Preview',
        body: 'Review evidence-backed gaps, resolve what you know, and make deliberate decisions about what remains.',
        button: 'Open Preflight',
        icon: 'shield-check-outline' as const,
      }
    : handoff.stage === 'preview'
      ? {
          eyebrow: 'READY FOR PREVIEW',
          title: 'Preflight decisions are recorded',
          body: 'Review exactly what the incoming leader will see, then publish the approved snapshot when it is ready.',
          button: 'Preview recipient view',
          icon: 'eye-check-outline' as const,
        }
      : {
          eyebrow: 'NEXT STEP',
          title: 'Review before Preflight',
          body: 'Confirm every proposed item and check the approved instructions before Relay looks for gaps.',
          button: 'Review knowledge',
          icon: 'arrow-right' as const,
        };

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{organization.name.toUpperCase()}</AppText>
        <AppText variant="display">{role.title} handoff</AppText>
        <AppText color={colors.inkMuted}>{handoff.servicePeriod} · {handoff.status === 'draft' ? 'Private draft' : 'Published snapshot'}</AppText>
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

      <View style={styles.summaryCard}>
        <View style={styles.summaryItem}>
          <AppText variant="title">{sources.length}</AppText>
          <AppText variant="caption" color={colors.inkMuted}>{sources.length === 1 ? 'source' : 'sources'}</AppText>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <AppText variant="title">{approvedItems.length}</AppText>
          <AppText variant="caption" color={colors.inkMuted}>approved</AppText>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <AppText variant="title">{proposedItems.length}</AppText>
          <AppText variant="caption" color={colors.inkMuted}>to review</AppText>
        </View>
      </View>

      {handoff.status === 'draft' ? (
        <>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionTitle}>
              <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>CAPTURE</AppText>
              <AppText variant="heading">Add what only you know</AppText>
            </View>
            <AppText color={colors.inkMuted}>Return throughout the service period to capture new context while keeping evidence separate from approved knowledge.</AppText>
          </View>
          <View style={styles.captureActions}>
            <Button icon="microphone-outline" label="Record voice knowledge" onPress={() => router.push((`/capture-voice?handoffId=${handoff.id}`) as Href)} />
            <Button icon="text-box-plus-outline" label="Type or paste notes" tone="secondary" onPress={() => router.push((`/capture-text?handoffId=${handoff.id}`) as Href)} />
            <Button icon="file-upload-outline" label="Upload a document" tone="secondary" onPress={() => router.push((`/capture-document?handoffId=${handoff.id}`) as Href)} />
            <Button icon="playlist-edit" label="Add approved item manually" tone="ghost" onPress={() => router.push((`/knowledge-new?handoffId=${handoff.id}`) as Href)} />
          </View>
          <View style={styles.capturePrompts}>
            <AppText variant="label">Optional prompts for real-world capture</AppText>
            <AppText variant="caption" color={colors.inkMuted}>Use only what fits this role—these are guidance, not new modules or tasks.</AppText>
            <View style={styles.promptList}>
              {[
                'Role responsibilities', 'Annual registration or training', 'Finances or budget handoff',
                'Recurring events', 'Advisor or vendor contacts', 'Account and tool access',
                'Calendars and deadlines', 'Constitution or policies', 'Lessons and common mistakes',
              ].map((prompt) => (
                <View key={prompt} style={styles.promptChip}>
                  <MaterialCommunityIcons color={colors.moss} name="plus-circle-outline" size={16} />
                  <AppText variant="caption" color={colors.moss}>{prompt}</AppText>
                </View>
              ))}
            </View>
          </View>
        </>
      ) : null}

      <View style={styles.guardrailCard}>
        <MaterialCommunityIcons color={colors.saffron} name="shield-check-outline" size={27} />
        <View style={styles.guardrailCopy}>
          <AppText variant="label">Private by default</AppText>
          <AppText variant="caption" color={colors.inkMuted}>Sources never become recipient-facing knowledge without deliberate human approval and publication.</AppText>
        </View>
      </View>

      <View style={styles.contentSection}>
        <View style={styles.sectionTitle}>
          <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>APPROVED KNOWLEDGE</AppText>
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
              <AppText variant="label">No approved knowledge yet</AppText>
              <AppText color={colors.inkMuted}>Add an item manually now. AI-generated items will always wait for your review here.</AppText>
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
          <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>SOURCE EVIDENCE</AppText>
          <AppText variant="heading">Original material</AppText>
        </View>
        {sources.length ? (
          <View style={styles.list}>
            {sources.map((source) => (
              <SourceCard
                editable={handoff.status === 'draft' && source.isCurrent}
                key={source.id}
                source={source}
                retrying={retryMutation.isPending && retryMutation.variables?.id === source.id}
                structuring={structureMutation.isPending && structureMutation.variables?.sourceId === source.id}
                onRetry={() => retryMutation.mutate({ id: source.id, handoffId: source.handoffId, kind: source.kind as 'voice' | 'document' })}
                onStructure={() => structureMutation.mutate({ sourceId: source.id, handoffId: source.handoffId })}
              />
            ))}
          </View>
        ) : (
          <View style={styles.emptyCard}>
            <MaterialCommunityIcons color={colors.moss} name="tray-arrow-up" size={30} />
            <View style={styles.cardCopy}>
              <AppText variant="label">No sources yet</AppText>
              <AppText color={colors.inkMuted}>Record, type, or upload the first piece of source evidence.</AppText>
            </View>
          </View>
        )}
        {retryMutation.error || structureMutation.error ? (
          <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.emergency}>
            {(retryMutation.error ?? structureMutation.error)?.message}
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
  summaryCard: {
    flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xl,
    padding: spacing.md, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: spacing.xxs },
  summaryDivider: { width: 1, height: 38, backgroundColor: colors.line },
  sectionHeading: { gap: spacing.xs, marginBottom: spacing.md },
  sectionTitle: { gap: spacing.xxs },
  captureActions: { gap: spacing.sm },
  capturePrompts: { gap: spacing.xs, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  promptList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  promptChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.surface },
  guardrailCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    marginTop: spacing.md, padding: spacing.md,
    borderRadius: radii.lg, backgroundColor: colors.saffronSoft,
  },
  guardrailCopy: { flex: 1, gap: spacing.xxs },
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
