import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput, FormSection } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { SOURCE_META } from '@/features/relay/knowledge-meta';
import {
  useHandoffSource,
  useGenerateKnowledgeProposals,
  useRetryDocumentProcessing,
  useSourceVersionChanges,
  useUpdateSourceText,
} from '@/features/relay/queries';
import type { HandoffSource, SourceVersionChange } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

function SourceEditor({ source, versionChanges }: { source: HandoffSource; versionChanges: SourceVersionChange[] }) {
  const [title, setTitle] = useState(source.title);
  const [textContent, setTextContent] = useState(source.textContent ?? '');
  const [localError, setLocalError] = useState<string | null>(null);
  const updateMutation = useUpdateSourceText();
  const retryMutation = useRetryDocumentProcessing();
  const structureMutation = useGenerateKnowledgeProposals();
  const meta = SOURCE_META[source.kind];
  const textLabel = source.kind === 'voice' ? 'Editable transcript' : source.kind === 'document' ? 'Extracted text or manual notes' : 'Original notes';

  async function save() {
    setLocalError(null);
    if (!title.trim()) return setLocalError('Give this source a title.');
    if (!textContent.trim()) return setLocalError(source.kind === 'voice' ? 'Keep some reviewed transcript text before saving.' : 'Add some source text first.');
    await updateMutation.mutateAsync({ id: source.id, handoffId: source.handoffId, title, textContent });
    router.replace((`/handoff/${source.handoffId}`) as Href);
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <View style={styles.badge}>
          <MaterialCommunityIcons color={colors.moss} name={meta.icon} size={18} />
          <AppText variant="caption" color={colors.moss}>{meta.label.toUpperCase()}</AppText>
        </View>
        <AppText variant="display">Review the source</AppText>
        <AppText color={colors.inkMuted}>Source material stays private. Editing it does not automatically change approved knowledge.</AppText>
      </View>

      {source.versionNumber > 1 || !source.isCurrent ? (
        <View style={styles.versionCard}>
          <MaterialCommunityIcons color={colors.moss} name="source-branch" size={24} />
          <View style={styles.statusCopy}>
            <AppText variant="label">Version {source.versionNumber}{source.isCurrent ? ' · Current' : ' · Historical'}</AppText>
            <AppText variant="caption" color={colors.inkMuted}>
              {source.isCurrent
                ? 'Linked to the prior file. Earlier versions remain private and preserved.'
                : 'This earlier version is preserved as immutable evidence.'}
            </AppText>
          </View>
          {source.supersedesSourceId ? (
            <Button
              icon="history"
              label="Prior"
              tone="ghost"
              onPress={() => router.push((`/source/${source.supersedesSourceId}`) as Href)}
            />
          ) : null}
        </View>
      ) : null}

      {source.versionNumber > 1 ? (
        <View style={styles.deltaSection}>
          <View style={styles.deltaHeading}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>MEANINGFUL DELTA</AppText>
            <AppText variant="heading">
              {source.deltaStatus === 'ready'
                ? `${versionChanges.length} relevant ${versionChanges.length === 1 ? 'change' : 'changes'} detected`
                : source.deltaStatus === 'failed' ? 'Delta review needs attention' : 'Comparing operational content…'}
            </AppText>
            <AppText color={colors.inkMuted}>
              Formatting, reordered rows, and wording-only edits are suppressed. Every surfaced change still requires review before canonical knowledge changes.
            </AppText>
          </View>
          {versionChanges.map((change) => (
            <View key={change.id} style={styles.deltaRow}>
              <View style={styles.deltaBadge}>
                <AppText variant="caption" color={change.changeType === 'removed' ? colors.emergency : colors.moss}>
                  {change.changeType.toUpperCase()}
                </AppText>
              </View>
              <View style={styles.statusCopy}>
                <AppText variant="label">{change.title}</AppText>
                <AppText variant="caption" color={colors.inkMuted}>{change.summary}</AppText>
              </View>
            </View>
          ))}
          {source.deltaFailureReason ? <AppText variant="caption" color={colors.emergency}>{source.deltaFailureReason}</AppText> : null}
        </View>
      ) : null}

      {source.processingStatus !== 'ready' ? (
        <View style={[styles.statusCard, source.processingStatus === 'failed' && styles.failedCard]}>
          <MaterialCommunityIcons color={source.processingStatus === 'failed' ? colors.emergency : colors.saffron} name={source.processingStatus === 'failed' ? 'alert-circle-outline' : 'progress-clock'} size={26} />
          <View style={styles.statusCopy}>
            <AppText variant="label">{source.processingStatus === 'failed' ? 'Processing needs attention' : 'Processing source'}</AppText>
            <AppText variant="caption" color={colors.inkMuted}>
              {source.failureReason ?? 'Relay is preparing this source. You can leave this screen safely.'}
            </AppText>
          </View>
        </View>
      ) : null}

      <FormSection eyebrow="Private evidence" title="Original source content">
        <FormInput editable={source.isCurrent} label="Source title" maxLength={160} value={title} onChangeText={setTitle} />
        <FormInput
          helper={source.kind === 'voice' ? 'Correct transcription mistakes before using this as evidence.' : 'This text remains source evidence until knowledge is deliberately approved.'}
          label={textLabel}
          maxLength={50000}
          multiline
          placeholder={source.kind === 'voice' ? 'Review the confirmed transcript…' : 'Add the useful text from this source…'}
          style={styles.sourceText}
          value={textContent}
          onChangeText={setTextContent}
          editable={source.isCurrent}
        />
      </FormSection>

      {localError || updateMutation.error || retryMutation.error || structureMutation.error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.errorCopy}>
            {localError ?? updateMutation.error?.message ?? retryMutation.error?.message ?? structureMutation.error?.message}
          </AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        {source.isCurrent ? (
          <Button disabled={updateMutation.isPending || retryMutation.isPending} icon="content-save-outline" label={updateMutation.isPending ? 'Saving…' : 'Save source text'} onPress={() => void save()} />
        ) : null}
        {source.isCurrent && source.kind === 'document' && source.processingStatus === 'failed' ? (
          <Button
            disabled={updateMutation.isPending || retryMutation.isPending}
            icon="refresh"
            label={retryMutation.isPending ? 'Retrying…' : 'Retry processing'}
            tone="secondary"
            onPress={() => retryMutation.mutate({ id: source.id, handoffId: source.handoffId })}
          />
        ) : null}
        {source.isCurrent && source.processingStatus === 'ready' && source.textContent && source.structuringStatus !== 'ready' ? (
          <Button
            disabled={updateMutation.isPending || structureMutation.isPending || source.structuringStatus === 'processing'}
            icon={source.structuringStatus === 'failed' ? 'refresh' : 'creation-outline'}
            label={structureMutation.isPending || source.structuringStatus === 'processing'
              ? 'Creating proposals…'
              : source.structuringStatus === 'failed' ? 'Retry proposal creation' : 'Create knowledge proposals'}
            tone="secondary"
            onPress={() => structureMutation.mutate({ sourceId: source.id, handoffId: source.handoffId })}
          />
        ) : null}
      </View>

      {source.structuringStatus === 'failed' || source.structuringStatus === 'ready' ? (
        <View style={[styles.structureStatus, source.structuringStatus === 'failed' && styles.failedCard]}>
          <MaterialCommunityIcons
            color={source.structuringStatus === 'failed' ? colors.emergency : colors.moss}
            name={source.structuringStatus === 'failed' ? 'alert-circle-outline' : 'check-circle-outline'}
            size={22}
          />
          <AppText variant="caption" color={colors.inkMuted} style={styles.statusCopy}>
            {source.structuringStatus === 'failed'
              ? source.structuringFailureReason
              : source.structuredProposalCount
                ? `${source.structuredProposalCount} ${source.structuredProposalCount === 1 ? 'proposal was' : 'proposals were'} created from this source.`
                : 'Relay checked this source and found no new knowledge to propose.'}
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

export default function SourceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sourceQuery = useHandoffSource(id);
  const needsChanges = Boolean(sourceQuery.data && sourceQuery.data.versionNumber > 1);
  const changesQuery = useSourceVersionChanges(needsChanges ? id : undefined);
  if (sourceQuery.isPending || (needsChanges && changesQuery.isPending)) return <Screen><LoadingState label="Opening source…" /></Screen>;
  if (sourceQuery.error || (needsChanges && changesQuery.error) || !sourceQuery.data) {
    return <Screen><MessageState icon="file-remove-outline" title="Source unavailable" body={sourceQuery.error?.message ?? 'This source no longer exists or you do not have access.'} /></Screen>;
  }
  return <SourceEditor source={sourceQuery.data} versionChanges={changesQuery.data ?? []} />;
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  statusCard: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.saffronSoft },
  failedCard: { backgroundColor: '#FFF1EE' },
  statusCopy: { flex: 1, gap: spacing.xxs },
  sourceText: { minHeight: 220 },
  error: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1' },
  errorCopy: { flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
  structureStatus: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  versionCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  deltaSection: { gap: spacing.sm, marginBottom: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  deltaHeading: { gap: spacing.xxs },
  deltaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  deltaBadge: { minWidth: 74, alignItems: 'center', paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs, borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  eyebrow: { letterSpacing: 1.1 },
});
