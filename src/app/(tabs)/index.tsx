import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { OrganizationMark } from '@/features/relay/organization-mark';
import {
  useMyMembershipRequests,
  useOrganizations,
  useRequestOrganizationMembership,
  useSearchOrganizationsForMembership,
} from '@/features/relay/queries';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

export default function OrganizationsScreen() {
  const { isCloudEnabled } = useAuth();
  const query = useOrganizations();
  const requests = useMyMembershipRequests();

  if (!isCloudEnabled) {
    return (
      <Screen safeTop>
        <BrandHeading />
        <MessageState icon="cloud-outline" title="Connect Supabase to open organizations" body="Organization membership is stored securely in Relay." />
      </Screen>
    );
  }

  if (query.isPending) return <Screen safeTop><BrandHeading /><LoadingState label="Loading your organizations…" /></Screen>;
  if (query.error) {
    return (
      <Screen safeTop>
        <BrandHeading />
        <MessageState icon="cloud-alert-outline" title="Organizations could not be loaded" body={query.error.message} actionLabel="Try again" onAction={() => void query.refetch()} />
      </Screen>
    );
  }

  const organizations = query.data ?? [];
  const refreshing = query.isRefetching || requests.isRefetching;
  return (
    <Screen safeTop scrollProps={{
      refreshControl: <RefreshControl
        refreshing={refreshing}
        tintColor={colors.moss}
        onRefresh={() => void Promise.all([query.refetch(), requests.refetch()])}
      />,
    }}>
      <BrandHeading />

      {organizations.length ? (
        <>
          <View style={styles.titleRow}>
            <View style={styles.titleCopy}>
              <AppText variant="display">Your organizations</AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Create organization"
              onPress={() => router.push('/organization-new' as Href)}
              style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons color={colors.white} name="plus" size={24} />
            </Pressable>
          </View>
          <View style={styles.organizationList}>
            {organizations.map((organization) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${organization.name}`}
                key={organization.id}
                onPress={() => router.push(`/organization/${organization.id}` as Href)}
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
        </>
      ) : (
        <View style={styles.welcome}>
          <AppText variant="display">Find your organization</AppText>
          <AppText color={colors.inkMuted}>Request membership in your society, or create one if you are setting Relay up for it.</AppText>
        </View>
      )}

      {!organizations.length ? <JoinOrganization requests={requests.data ?? []} /> : null}

      {!organizations.length ? (
        <View style={styles.createBlock}>
          <AppText variant="heading">Setting up a new organization?</AppText>
          <Button label="Create organization" tone="secondary" onPress={() => router.push('/organization-new' as Href)} />
        </View>
      ) : null}
    </Screen>
  );
}

function JoinOrganization({ requests }: { requests: Array<{ requestId: string; organizationId: string; name: string; institution: string; status: 'pending' | 'accepted' | 'rejected'; requestedAt: string }> }) {
  const [search, setSearch] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const searchMutation = useSearchOrganizationsForMembership();
  const requestMutation = useRequestOrganizationMembership();
  const myRequests = useMyMembershipRequests();

  async function runSearch() {
    setValidationError(null);
    if (search.trim().length < 2) return setValidationError('Enter at least two characters.');
    try {
      await searchMutation.mutateAsync(search);
    } catch {
      // The mutation exposes its safe error below.
    }
  }

  async function requestMembership(organizationId: string) {
    try {
      await requestMutation.mutateAsync(organizationId);
      await Promise.all([searchMutation.mutateAsync(search), myRequests.refetch()]);
    } catch {
      // The mutation exposes its safe error below.
    }
  }

  const pending = requests.filter((request) => request.status === 'pending');
  return (
    <View style={styles.joinCard}>
      <View style={styles.joinHeading}>
        <AppText variant="heading">Join an organization</AppText>
        <AppText color={colors.inkMuted}>Search by society or institution name. The Organization Owner reviews your request.</AppText>
      </View>
      <FormInput
        label="Organization or society"
        placeholder="Search organizations"
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={() => void runSearch()}
        returnKeyType="search"
      />
      <Button disabled={searchMutation.isPending} label={searchMutation.isPending ? 'Searching…' : 'Search'} onPress={() => void runSearch()} />
      {validationError || searchMutation.error || requestMutation.error ? (
        <AppText variant="caption" color={colors.emergency}>
          {validationError ?? searchMutation.error?.message ?? requestMutation.error?.message}
        </AppText>
      ) : null}

      {searchMutation.data ? (
        searchMutation.data.length ? (
          <View style={styles.searchResults}>
            {searchMutation.data.map((result) => (
              <View key={result.organizationId} style={styles.searchResult}>
                <View style={styles.organizationCopy}>
                  <AppText variant="label">{result.name}</AppText>
                  <AppText variant="caption" color={colors.inkMuted}>{result.institution || 'Independent organization'}</AppText>
                </View>
                {result.requestStatus === 'pending' ? (
                  <View style={styles.statusPill}><AppText variant="caption" color={colors.moss}>Request pending</AppText></View>
                ) : (
                  <Button
                    disabled={requestMutation.isPending}
                    label={result.requestStatus === 'rejected' ? 'Request again' : 'Request to join'}
                    tone="secondary"
                    onPress={() => void requestMembership(result.organizationId)}
                  />
                )}
              </View>
            ))}
          </View>
        ) : <AppText color={colors.inkMuted}>No matching organizations found.</AppText>
      ) : null}

      {pending.length ? (
        <View style={styles.pendingBlock}>
          <AppText variant="label">Pending requests</AppText>
          {pending.map((request) => (
            <View key={request.requestId} style={styles.pendingRow}>
              <MaterialCommunityIcons color={colors.moss} name="clock-outline" size={20} />
              <View style={styles.organizationCopy}>
                <AppText variant="label">{request.name}</AppText>
                <AppText variant="caption" color={colors.inkMuted}>Waiting for the Organization Owner</AppText>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
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
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  brandMark: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xl, marginBottom: spacing.xl },
  titleCopy: { flex: 1, gap: spacing.xs },
  welcome: { gap: spacing.xs, marginTop: spacing.xl, marginBottom: spacing.lg },
  addButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.moss },
  organizationList: { gap: spacing.sm },
  organizationCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, ...shadow },
  organizationCopy: { flex: 1, gap: spacing.xxs },
  joinCard: { gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  joinHeading: { gap: spacing.xxs },
  searchResults: { gap: spacing.sm },
  searchResult: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.pill, backgroundColor: colors.mossSoft },
  pendingBlock: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  createBlock: { gap: spacing.sm, marginTop: spacing.xl },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
