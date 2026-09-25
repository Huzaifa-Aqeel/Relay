import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Screen } from '@/components/ui/screen';
import { useMyAssignedRoles } from '@/features/relay/queries';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

export default function HandoffActionScreen() {
  const roles = useMyAssignedRoles();

  if (roles.isPending) {
    return <Screen safeTop><LoadingState label="Loading your Roles…" /></Screen>;
  }
  if (roles.error) {
    return (
      <Screen safeTop>
        <MessageState
          icon="cloud-alert-outline"
          title="Your Roles could not be loaded"
          body={roles.error.message}
          actionLabel="Try again"
          onAction={() => void roles.refetch()}
        />
      </Screen>
    );
  }

  const assignedRoles = roles.data ?? [];
  return (
    <Screen
      safeTop
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={roles.isRefetching}
            tintColor={colors.moss}
            onRefresh={() => void roles.refetch()}
          />
        ),
      }}>
      <View style={styles.heading}>
        <AppText variant="display">Your handoffs</AppText>
      </View>

      {assignedRoles.length ? (
        <View style={styles.roleList}>
          {assignedRoles.map((role) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${role.title}`}
              key={role.roleId}
              onPress={() => router.push(`/role/${role.roleId}` as Href)}
              style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}>
              <View style={styles.roleIcon}>
                <MaterialCommunityIcons color={colors.moss} name="account-tie-outline" size={25} />
              </View>
              <View style={styles.roleCopy}>
                <AppText variant="heading">{role.title}</AppText>
                <AppText variant="caption" color={colors.inkMuted}>
                  {role.organizationName} · {role.servicePeriod}
                </AppText>
                {role.description ? (
                  <AppText variant="caption" color={colors.inkMuted} numberOfLines={2}>{role.description}</AppText>
                ) : null}
              </View>
              <MaterialCommunityIcons color={colors.inkMuted} name="chevron-right" size={23} />
            </Pressable>
          ))}
        </View>
      ) : (
        <MessageState
          icon="account-tie-outline"
          title="No Role assigned"
          body="A Role will appear here after its assignment invitation is accepted."
          actionLabel="Open Organizations"
          onAction={() => router.replace('/')}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  roleList: { gap: spacing.sm },
  roleCard: {
    minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.surface, ...shadow,
  },
  roleIcon: {
    width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  roleCopy: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
