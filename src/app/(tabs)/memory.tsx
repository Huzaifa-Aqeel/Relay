import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Screen } from '@/components/ui/screen';
import { colors, radii, spacing } from '@/theme/tokens';

export default function MemoryScreen() {
  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>INSTITUTIONAL MEMORY</AppText>
        <AppText variant="display">History with context</AppText>
        <AppText color={colors.inkMuted}>
          Published handoffs will stay connected to their organization, role, and service period.
        </AppText>
      </View>

      <View style={styles.emptyCard}>
        <View style={styles.icon}>
          <MaterialCommunityIcons color={colors.moss} name="book-open-page-variant-outline" size={34} />
        </View>
        <AppText variant="heading">No published handoffs yet</AppText>
        <AppText color={colors.inkMuted} style={styles.center}>
          When a handoff is reviewed and published, its approved knowledge will appear here—not raw uploads or unreviewed AI output.
        </AppText>
      </View>

      <View style={styles.boundaryCard}>
        <MaterialCommunityIcons color={colors.saffron} name="shield-check-outline" size={24} />
        <View style={styles.boundaryCopy}>
          <AppText variant="label">Human-approved memory</AppText>
          <AppText variant="caption" color={colors.inkMuted}>
            Relay keeps source evidence separate from canonical knowledge.
          </AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  emptyCard: {
    alignItems: 'center', gap: spacing.sm, padding: spacing.xl,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  icon: {
    width: 64, height: 64, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mossSoft,
  },
  center: { textAlign: 'center' },
  boundaryCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md,
    marginTop: spacing.lg, padding: spacing.lg, borderRadius: radii.lg,
    backgroundColor: colors.saffronSoft,
  },
  boundaryCopy: { flex: 1, gap: spacing.xxs },
});
