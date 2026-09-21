import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Screen } from '@/components/ui/screen';
import { useMemoryRoles } from '@/features/relay/queries';
import { colors, radii, spacing } from '@/theme/tokens';

export default function MemoryScreen() {
  const query = useMemoryRoles();
  if (query.isPending) return <Screen><LoadingState label="Opening organization memory…" /></Screen>;
  if (query.error) {
    return (
      <Screen>
        <MessageState
          icon="book-alert-outline"
          title="Organization Memory unavailable"
          body={query.error.message}
          actionLabel="Try again"
          onAction={() => void query.refetch()}
        />
      </Screen>
    );
  }
  const roles = query.data ?? [];
  return (
    <Screen scrollProps={{
      refreshControl: <RefreshControl refreshing={query.isRefetching} tintColor={colors.moss} onRefresh={() => void query.refetch()} />,
    }}>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>INSTITUTIONAL MEMORY</AppText>
        <AppText variant="display">What materially changed</AppText>
        <AppText color={colors.inkMuted}>
          Compare adjacent published service periods for the same role. Relay omits uncertain or wording-only differences and never guesses why.
        </AppText>
      </View>

      {roles.length ? (
        <View style={styles.list}>
          {roles.map((role) => (
            <Pressable
              accessibilityRole="button"
              key={role.roleId}
              onPress={() => router.push((`/organization-memory?roleId=${role.roleId}`) as Href)}
              style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}>
              <View style={styles.icon}>
                <MaterialCommunityIcons color={colors.moss} name="book-open-page-variant-outline" size={25} />
              </View>
              <View style={styles.copy}>
                <AppText variant="caption" color={colors.moss}>{role.organizationName.toUpperCase()}</AppText>
                <AppText variant="heading">{role.roleTitle}</AppText>
                <AppText variant="caption" color={colors.inkMuted}>
                  {role.publishedHandoffCount} published {role.publishedHandoffCount === 1 ? 'handoff' : 'handoffs'} · latest {role.latestServicePeriod}
                </AppText>
              </View>
              <MaterialCommunityIcons color={colors.inkMuted} name="chevron-right" size={23} />
            </Pressable>
          ))}
        </View>
      ) : (
        <MessageState
          icon="book-open-page-variant-outline"
          title="No published handoffs yet"
          body="Published, human-approved knowledge will appear here—not raw uploads or unreviewed AI output."
        />
      )}

      <View style={styles.boundaryCard}>
        <MaterialCommunityIcons color={colors.saffron} name="shield-check-outline" size={24} />
        <View style={styles.copy}>
          <AppText variant="label">Grounded memory only</AppText>
          <AppText variant="caption" color={colors.inkMuted}>
            No leader rankings, improvement scores, cross-role comparisons, or causal claims without approved evidence.
          </AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  list: { gap: spacing.sm },
  roleCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.mossSoft },
  copy: { flex: 1, gap: spacing.xxs },
  boundaryCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.saffronSoft },
  pressed: { opacity: 0.75 },
});
