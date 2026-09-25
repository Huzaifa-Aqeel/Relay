import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { OrganizationMark } from '@/features/relay/organization-mark';
import { YouTubeEmbed } from '@/features/relay/youtube-embed';
import { useContinuity } from '@/features/relay/continuity';
import { useOrganization } from '@/features/relay/queries';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

export default function OrganizationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const organizationQuery = useOrganization(id);
  const continuity = useContinuity(id);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const pending = organizationQuery.isPending || continuity.isPending;
  const error = organizationQuery.error ?? continuity.error;

  if (pending) return <Screen><LoadingState label="Opening organization…" /></Screen>;
  if (error || !organizationQuery.data || !continuity.data) {
    return (
      <Screen>
        <MessageState
          icon="office-building-remove-outline"
          title="Organization unavailable"
          body={error?.message ?? 'This organization does not exist or you do not have access.'}
          actionLabel="Back to organizations"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const organization = organizationQuery.data;
  const refreshing = organizationQuery.isRefetching || continuity.isRefetching;
  const refresh = () => void Promise.all([organizationQuery.refetch(), continuity.refetch()]);

  return (
    <Screen scrollProps={{ refreshControl: <RefreshControl refreshing={refreshing} tintColor={colors.moss} onRefresh={refresh} /> }}>
      <View style={styles.headingRow}>
        <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} size={72} />
        <View style={styles.headingCopy}>
          <AppText variant="display">{organization.name}</AppText>
          <AppText color={colors.inkMuted}>{organization.institution || 'Independent organization'}</AppText>
        </View>
      </View>

      {continuity.data.isOwner ? (
        <Button
          icon="pencil-outline"
          label="Manage organization page"
          tone="secondary"
          onPress={() => router.push(`/organization-manage?organizationId=${organization.id}` as Href)}
        />
      ) : null}

      <View style={styles.sectionBlock}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: aboutOpen }}
          onPress={() => setAboutOpen((current) => !current)}
          style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}>
          <View style={styles.sectionHeadingInline}>
            <MaterialCommunityIcons color={colors.moss} name="information-outline" size={24} />
            <View style={styles.flex}>
              <AppText variant="heading">About {organization.name}</AppText>
              <AppText variant="caption" color={colors.inkMuted}>About and video</AppText>
            </View>
            <MaterialCommunityIcons color={colors.inkMuted} name={aboutOpen ? 'chevron-up' : 'chevron-down'} size={24} />
          </View>
        </Pressable>
        {aboutOpen ? (
          <View style={styles.expandedContent}>
            <AppText color={organization.description ? colors.ink : colors.inkMuted}>
              {organization.description || 'No organization description has been added yet.'}
            </AppText>
            {organization.youtubeVideoUrl ? (
              <YouTubeEmbed title={`${organization.name} video`} url={organization.youtubeVideoUrl} />
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.sectionBlock}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: filesOpen }}
          onPress={() => setFilesOpen((current) => !current)}
          style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}>
          <View style={styles.sectionHeadingInline}>
            <MaterialCommunityIcons color={colors.moss} name="file-document-outline" size={24} />
            <View style={styles.flex}>
              <AppText variant="heading">Organization files</AppText>
              <AppText variant="caption" color={colors.inkMuted}>
                {organization.files.length} {organization.files.length === 1 ? 'file' : 'files'}
              </AppText>
            </View>
            <MaterialCommunityIcons color={colors.inkMuted} name={filesOpen ? 'chevron-up' : 'chevron-down'} size={24} />
          </View>
        </Pressable>
        {filesOpen ? (
          organization.files.length ? (
            <View style={styles.fileList}>
              {organization.files.map((file) => (
                <View key={file.id} style={styles.fileRow}>
                  <MaterialCommunityIcons color={colors.emergency} name="file-pdf-box" size={25} />
                  <View style={styles.fileTextRow}>
                    <AppText variant="label">{file.title}</AppText>
                    <AppText variant="caption" color={colors.inkMuted}>—</AppText>
                    <Pressable disabled={!file.url} onPress={file.url ? () => void Linking.openURL(file.url!) : undefined}>
                      <AppText variant="caption" color={colors.moss} style={styles.fileLink}>{file.fileName}</AppText>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : <AppText color={colors.inkMuted}>No organization files have been added yet.</AppText>
        ) : null}
      </View>

      <View style={styles.sectionBlock}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: committeeOpen }}
          onPress={() => setCommitteeOpen((current) => !current)}
          style={({ pressed }) => [styles.collapseHeader, pressed && styles.pressed]}>
          <View style={styles.sectionHeadingInline}>
            <MaterialCommunityIcons color={colors.moss} name="account-group-outline" size={24} />
            <View style={styles.flex}>
              <AppText variant="heading">Current committee</AppText>
              <AppText variant="caption" color={colors.inkMuted}>
                {continuity.data.roles.length} {continuity.data.roles.length === 1 ? 'role' : 'roles'}
              </AppText>
            </View>
            <MaterialCommunityIcons color={colors.inkMuted} name={committeeOpen ? 'chevron-up' : 'chevron-down'} size={24} />
          </View>
        </Pressable>
        {committeeOpen ? (
          continuity.data.roles.length ? (
            <View style={styles.committeeList}>
              {continuity.data.roles.map((role) => {
                const holder = role.assignments[0];
                return (
                  <View key={role.roleId} style={styles.committeeRow}>
                    <View style={styles.committeeIcon}>
                      <MaterialCommunityIcons color={colors.moss} name="account-tie-outline" size={21} />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="label">{role.title}</AppText>
                      <AppText variant="caption" color={colors.inkMuted}>
                        {holder ? `${holder.name || 'Assigned member'} · ${holder.servicePeriod}` : 'No current holder'}
                      </AppText>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : <AppText color={colors.inkMuted}>No committee roles have been added yet.</AppText>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  headingCopy: { flex: 1, gap: spacing.xxs },
  sectionBlock: {
    gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg,
    borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, ...shadow,
  },
  sectionHeadingInline: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  collapseHeader: { margin: -spacing.xs, padding: spacing.xs },
  expandedContent: { gap: spacing.md },
  fileList: { gap: spacing.xs },
  fileRow: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  fileTextRow: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  fileLink: { textDecorationLine: 'underline' },
  committeeList: { gap: spacing.xs },
  committeeRow: {
    minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.canvas,
  },
  committeeIcon: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  flex: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.76 },
});
