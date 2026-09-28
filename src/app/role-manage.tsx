import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput, FormSection } from '@/components/ui/form-controls';
import { InfoCard, InfoRow } from '@/components/ui/info-card';
import { Screen } from '@/components/ui/screen';
import { useContinuity } from '@/features/relay/continuity';
import { useOrganization, useRole, useUpdateRole } from '@/features/relay/queries';
import type { OrganizationRole } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

export default function ManageRoleScreen() {
  const { roleId } = useLocalSearchParams<{ roleId: string }>();
  const role = useRole(roleId);
  const organization = useOrganization(role.data?.organizationId);
  const continuity = useContinuity(role.data?.organizationId);

  if (!roleId) {
    return <Screen><MessageState icon="account-alert-outline" title="Choose a Role first" body="Role management must stay attached to one Organization Role." /></Screen>;
  }
  if (role.isPending || (role.data && (organization.isPending || continuity.isPending))) {
    return <Screen><LoadingState label="Opening Role settings…" /></Screen>;
  }
  if (role.error || organization.error || continuity.error || !role.data || !organization.data || !continuity.data) {
    return (
      <Screen>
        <MessageState
          icon="account-alert-outline"
          title="Role unavailable"
          body={(role.error ?? organization.error ?? continuity.error)?.message ?? 'This Role could not be opened.'}
        />
      </Screen>
    );
  }
  if (!continuity.data.isOwner) {
    return (
      <Screen>
        <MessageState
          icon="shield-lock-outline"
          title="Owner access required"
          body="Only the Organization Owner can edit this Role and manage its assignment."
          actionLabel="Return to organization"
          onAction={() => router.replace(`/organization/${organization.data!.id}` as Href)}
        />
      </Screen>
    );
  }

  const overview = continuity.data.roles.find((candidate) => candidate.roleId === roleId);
  if (!overview) {
    return <Screen><MessageState icon="account-alert-outline" title="Role unavailable" body="This Role is no longer active." /></Screen>;
  }

  return (
    <ManageRoleForm
      key={role.data.updatedAt}
      organizationName={organization.data.name}
      planAvailable={overview.planAvailable}
      role={role.data}
      holder={overview.assignments[0]}
    />
  );
}

function ManageRoleForm({ organizationName, planAvailable, role, holder }: {
  organizationName: string;
  planAvailable: boolean;
  role: OrganizationRole;
  holder?: { name: string; servicePeriod: string };
}) {
  const update = useUpdateRole();
  const [title, setTitle] = useState(role.title);
  const [description, setDescription] = useState(role.description);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  async function save() {
    const normalizedTitle = title.trim();
    setNotice('');
    if (!normalizedTitle) return setValidationError('Enter the Role title.');
    if (normalizedTitle.length > 100) return setValidationError('Keep the Role title under 100 characters.');
    if (description.trim().length > 800) return setValidationError('Keep the description under 800 characters.');
    setValidationError(null);
    try {
      await update.mutateAsync({
        roleId: role.id,
        organizationId: role.organizationId,
        title: normalizedTitle,
        description,
      });
      setTitle(normalizedTitle);
      setDescription(description.trim());
      setNotice('Role details saved.');
    } catch {
      // The mutation exposes its safe error below.
    }
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{organizationName.toUpperCase()}</AppText>
        <AppText variant="display">Manage Role</AppText>
        <AppText color={colors.inkMuted}>Edit this Role and keep its assignment from becoming orphaned.</AppText>
      </View>

      {!planAvailable ? (
        <View style={styles.lockedNotice}>
          <MaterialCommunityIcons color={colors.saffron} name="lock-outline" size={24} />
          <View style={styles.flex}>
            <AppText variant="label">Workspace locked · administration available</AppText>
            <AppText variant="caption" color={colors.inkMuted}>
              Relay Pro expired for this Role. Its history stays preserved, and you can still edit the Role or assign its next holder.
            </AppText>
          </View>
        </View>
      ) : null}

      <FormSection eyebrow="Role" title="Role details">
        <FormInput
          autoCapitalize="words"
          label="Role title"
          maxLength={100}
          onChangeText={setTitle}
          placeholder="President"
          value={title}
        />
        <FormInput
          label="Description"
          maxLength={800}
          multiline
          optional
          onChangeText={setDescription}
          placeholder="The scope of this Role and what it is responsible for"
          value={description}
        />
      </FormSection>

      <View style={styles.saveSection}>
        {validationError || update.error ? (
          <View accessibilityLiveRegion="polite" style={styles.error}>
            <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
            <AppText variant="caption" color={colors.emergency} style={styles.flex}>
              {validationError ?? update.error?.message}
            </AppText>
          </View>
        ) : null}
        {notice ? <AppText accessibilityLiveRegion="polite" color={colors.moss}>{notice}</AppText> : null}
        <Button disabled={update.isPending} label={update.isPending ? 'Saving…' : 'Save Role details'} onPress={() => void save()} />
      </View>

      <InfoCard eyebrow="Current holder" title={holder?.name || 'Not assigned'}>
        {holder ? <InfoRow label="Service period" value={holder.servicePeriod} /> : (
          <AppText color={colors.inkMuted}>Invite the first holder to establish responsibility for this Role.</AppText>
        )}
        <Button
          icon="account-switch-outline"
          label={holder ? 'Manage assignment' : 'Assign this Role'}
          tone="secondary"
          onPress={() => router.push(`/role-assignment?roleId=${role.id}` as Href)}
        />
      </InfoCard>

    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  lockedNotice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginBottom: spacing.lg, padding: spacing.md,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.saffronSoft,
  },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  saveSection: { gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.xl },
  flex: { flex: 1 },
});
