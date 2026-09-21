import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { PropsWithChildren, ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

export function AuthScaffold({
  eyebrow,
  title,
  intro,
  children,
  footer,
}: PropsWithChildren<{
  eyebrow: string;
  title: string;
  intro: string;
  footer?: ReactNode;
}>) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <MaterialCommunityIcons color={colors.moss} name="source-branch" size={22} />
          </View>
          <AppText variant="label" color={colors.moss}>RELAY</AppText>
        </View>

        <View style={styles.heading}>
          <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{eyebrow}</AppText>
          <AppText variant="display">{title}</AppText>
          <AppText color={colors.inkMuted}>{intro}</AppText>
        </View>

        <View style={styles.card}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export const authStyles = StyleSheet.create({
  fields: { gap: spacing.md },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: '#FFF5F2', borderWidth: 1, borderColor: '#E4B5AE',
  },
  errorCopy: { flex: 1 },
  success: {
    alignItems: 'center', gap: spacing.md, padding: spacing.lg,
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  centered: { textAlign: 'center' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: spacing.xxs },
  linkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.xxs },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xs },
  dividerLine: { height: 1, flex: 1, backgroundColor: colors.line },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  scroll: {
    width: '100%', maxWidth: 560, minHeight: '100%', alignSelf: 'center',
    paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xl,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  brandMark: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  heading: { gap: spacing.xs, marginTop: spacing.xxl, marginBottom: spacing.lg },
  eyebrow: { letterSpacing: 1.2, textTransform: 'uppercase' },
  card: {
    gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, ...shadow,
  },
  footer: { alignItems: 'center', marginTop: spacing.lg },
});
