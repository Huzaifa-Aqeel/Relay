import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { OrganizationMark } from '@/features/relay/organization-mark';
import { useOrganizations } from '@/features/relay/queries';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

export default function OrganizationsScreen() {
  const { isCloudEnabled } = useAuth();
  const query = useOrganizations();

  if (!isCloudEnabled) {
    return (
      <Screen>
        <BrandHeading />
        <MessageState
          icon="cloud-outline"
          title="Connect Supabase to create organizations"
          body="This preview keeps the real creation flow disabled rather than storing work that cannot safely sync."
        />
      </Screen>
    );
  }

  if (query.isPending) return <Screen><BrandHeading /><LoadingState label="Loading your organizations…" /></Screen>;
  if (query.error) {
    return (
      <Screen>
        <BrandHeading />
        <MessageState
          icon="cloud-alert-outline"
          title="Organizations could not be loaded"
          body={query.error.message}
          actionLabel="Try again"
          onAction={() => void query.refetch()}
        />
      </Screen>
    );
  }

  const organizations = query.data ?? [];
  return (
    <Screen
      scrollProps={{
        refreshControl: <RefreshControl refreshing={query.isRefetching} tintColor={colors.moss} onRefresh={() => void query.refetch()} />,
      }}>
      <BrandHeading />

      <View style={styles.titleRow}>
        <View style={styles.titleCopy}>
          <AppText variant="display">Your organizations</AppText>
          <AppText color={colors.inkMuted}>Choose where knowledge belongs before creating a handoff.</AppText>
        </View>
        {organizations.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create organization"
            onPress={() => router.push('/organization-new' as Href)}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons color={colors.white} name="plus" size={24} />
          </Pressable>
        ) : null}
      </View>

      {organizations.length ? (
        <View style={styles.organizationList}>
          {organizations.map((organization) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${organization.name}`}
              key={organization.id}
              onPress={() => router.push((`/organization/${organization.id}`) as Href)}
              style={({ pressed }) => [styles.organizationCard, pressed && styles.pressed]}>
              <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} size={58} />
              <View style={styles.organizationCopy}>
                <AppText variant="heading">{organization.name}</AppText>
                <AppText color={colors.inkMuted}>{organization.institution || 'Independent organization'}</AppText>
                {organization.description ? <AppText variant="caption" color={colors.inkMuted} numberOfLines={2}>{organization.description}</AppText> : null}
              </View>
              <MaterialCommunityIcons color={colors.inkMuted} name="chevron-right" size={24} />
            </Pressable>
          ))}
        </View>
      ) : (
        <MessageState
          icon="office-building-plus-outline"
          title="Create your first organization"
          body="This becomes the lasting home for its roles, handoffs, and institutional memory."
          actionLabel="Create organization"
          onAction={() => router.push('/organization-new' as Href)}
        />
      )}

      {organizations.length ? (
        <View style={styles.promise}>
          <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>THE RELAY PROMISE</AppText>
          <AppText variant="heading">Your club should not forget how to run when its leaders graduate.</AppText>
        </View>
      ) : null}
    </Screen>
  );
}

function BrandHeading() {
  return (
    <View style={styles.brandRow}>
      <View style={styles.brandMark}><MaterialCommunityIcons color={colors.moss} name="source-branch" size={22} /></View>
      <AppText variant="label" color={colors.moss}>RELAY</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  brandMark: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, marginBottom: spacing.xl },
  titleCopy: { flex: 1, gap: spacing.xs },
  addButton: {
    width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.moss,
  },
  organizationList: { gap: spacing.sm },
  organizationCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.surface, ...shadow,
  },
  organizationCopy: { flex: 1, gap: spacing.xxs },
  promise: { gap: spacing.sm, marginTop: spacing.xl, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  eyebrow: { letterSpacing: 1.2 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
