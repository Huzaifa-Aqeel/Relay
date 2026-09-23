import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useHandoffSource } from '@/features/relay/queries';
import { colors, radii, spacing } from '@/theme/tokens';

function statusCopy(status: 'pending' | 'processing' | 'ready' | 'failed') {
  if (status === 'pending') return 'This file is saved and will be prepared when you choose Organize.';
  if (status === 'processing') return 'Relay is preparing this file for the capture.';
  if (status === 'failed') return 'Relay could not prepare this file. Return to the capture to edit it or choose Organize again.';
  return 'This file is ready to support the capture.';
}

export default function SourceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sourceQuery = useHandoffSource(id);
  if (sourceQuery.isPending) return <Screen><LoadingState label="Opening file…" /></Screen>;
  if (sourceQuery.error || !sourceQuery.data) {
    return <Screen><MessageState icon="file-remove-outline" title="File unavailable" body={sourceQuery.error?.message ?? 'This file no longer exists or you do not have access.'} /></Screen>;
  }
  const source = sourceQuery.data;
  return (
    <Screen>
      <View style={styles.heading}>
        <View style={styles.badge}>
          <MaterialCommunityIcons color={colors.moss} name="file-document-outline" size={18} />
          <AppText variant="caption" color={colors.moss}>ATTACHMENT</AppText>
        </View>
        <AppText variant="display">{source.title}</AppText>
        <AppText color={colors.inkMuted}>{statusCopy(source.processingStatus)}</AppText>
      </View>

      {source.failureReason ? (
        <View style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={20} />
          <AppText color={colors.emergency} style={styles.copy}>{source.failureReason}</AppText>
        </View>
      ) : null}

      {source.textContent ? (
        <View style={styles.contentCard}>
          <AppText variant="label">Prepared content</AppText>
          <AppText color={colors.inkMuted}>{source.textContent}</AppText>
        </View>
      ) : null}

      <Button
        icon="arrow-left"
        label="Back to capture"
        tone="secondary"
        onPress={() => router.replace((`/handoff/${source.handoffId}`) as Href)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  badge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs,
    borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  error: {
    flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg,
    padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  copy: { flex: 1 },
  contentCard: {
    gap: spacing.sm, marginBottom: spacing.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
});
