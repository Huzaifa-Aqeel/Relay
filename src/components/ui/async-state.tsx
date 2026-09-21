import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { colors, radii, spacing } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.card}>
      <ActivityIndicator color={colors.moss} size="large" />
      <AppText color={colors.inkMuted}>{label}</AppText>
    </View>
  );
}

export function MessageState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.icon}>
        <MaterialCommunityIcons color={colors.moss} name={icon} size={34} />
      </View>
      <AppText variant="heading" style={styles.center}>{title}</AppText>
      <AppText color={colors.inkMuted} style={styles.center}>{body}</AppText>
      {actionLabel && onAction ? <Button label={actionLabel} tone="secondary" onPress={onAction} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, padding: spacing.xl,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  icon: {
    width: 64, height: 64, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  center: { textAlign: 'center' },
});
