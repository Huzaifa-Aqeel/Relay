import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { OrganizationMark } from '@/features/relay/organization-mark';
import { useCreateHandoff, useOrganizations, useRoles } from '@/features/relay/queries';
import { RelayPlanLimitError } from '@/features/relay/repository';
import { colors, radii, spacing } from '@/theme/tokens';

function suggestedPeriod() {
  const now = new Date();
  const start = now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}–${start + 1}`;
}

export default function CreateHandoffScreen() {
  const params = useLocalSearchParams<{ organizationId?: string; roleId?: string }>();
  const organizationsQuery = useOrganizations();
  const [organizationId, setOrganizationId] = useState(params.organizationId ?? '');
  const [roleId, setRoleId] = useState(params.roleId ?? '');
  const [servicePeriod, setServicePeriod] = useState(suggestedPeriod());
  const [validationError, setValidationError] = useState<string | null>(null);
  const rolesQuery = useRoles(organizationId || undefined);
  const mutation = useCreateHandoff();

  useEffect(() => {
    if (params.organizationId) setOrganizationId(params.organizationId);
    if (params.roleId) setRoleId(params.roleId);
  }, [params.organizationId, params.roleId]);

  const selectedOrganization = useMemo(
    () => organizationsQuery.data?.find((organization) => organization.id === organizationId),
    [organizationId, organizationsQuery.data],
  );

  async function submit() {
    setValidationError(null);
    if (!organizationId) return setValidationError('Choose an organization.');
    if (!roleId) return setValidationError('Choose the role being handed over.');
    const trimmedPeriod = servicePeriod.trim();
    if (!trimmedPeriod || trimmedPeriod.length > 40) return setValidationError('Enter a service period under 40 characters.');
    try {
      const id = await mutation.mutateAsync({ organizationId, roleId, servicePeriod: trimmedPeriod });
      router.replace((`/handoff/${id}`) as Href);
    } catch (error) {
      if (error instanceof RelayPlanLimitError) {
        router.push((`/paywall?reason=handoff&organizationId=${organizationId}`) as Href);
      }
    }
  }

  if (organizationsQuery.isPending) return <Screen><LoadingState label="Loading organizations…" /></Screen>;
  if (organizationsQuery.error) {
    return (
      <Screen>
        <MessageState
          icon="cloud-alert-outline"
          title="Organizations could not be loaded"
          body={organizationsQuery.error.message}
          actionLabel="Try again"
          onAction={() => void organizationsQuery.refetch()}
        />
      </Screen>
    );
  }
  if (!organizationsQuery.data?.length) {
    return (
      <Screen>
        <MessageState
          icon="office-building-plus-outline"
          title="Create an organization first"
          body="Every handoff belongs to an organization and a real role."
          actionLabel="Create organization"
          onAction={() => router.push('/organization-new' as Href)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>NEW HANDOFF</AppText>
        <AppText variant="display">Start with the right context</AppText>
        <AppText color={colors.inkMuted}>Choose where this knowledge belongs before capturing anything.</AppText>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>1 · ORGANIZATION</AppText>
          <AppText variant="heading">Who owns this knowledge?</AppText>
        </View>
        <View style={styles.optionList}>
          {organizationsQuery.data.map((organization) => {
            const selected = organization.id === organizationId;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={organization.id}
                onPress={() => { setOrganizationId(organization.id); setRoleId(''); }}
                style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}>
                <OrganizationMark name={organization.name} logoUrl={organization.logoUrl} size={46} />
                <View style={styles.optionCopy}>
                  <AppText variant="label">{organization.name}</AppText>
                  <AppText variant="caption" color={colors.inkMuted}>{organization.institution || 'Independent organization'}</AppText>
                </View>
                <MaterialCommunityIcons color={selected ? colors.moss : colors.line} name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={23} />
              </Pressable>
            );
          })}
        </View>
      </View>

      {selectedOrganization ? (
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>2 · ROLE</AppText>
            <AppText variant="heading">Which role is being passed on?</AppText>
          </View>
          {rolesQuery.isPending ? <LoadingState label="Loading roles…" /> : null}
          {rolesQuery.error ? (
            <MessageState icon="cloud-alert-outline" title="Roles could not be loaded" body={rolesQuery.error.message} actionLabel="Try again" onAction={() => void rolesQuery.refetch()} />
          ) : null}
          {rolesQuery.data?.length ? (
            <View style={styles.optionList}>
              {rolesQuery.data.map((role) => {
                const selected = role.id === roleId;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={role.id}
                    onPress={() => setRoleId(role.id)}
                    style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}>
                    <View style={styles.roleIcon}><MaterialCommunityIcons color={colors.moss} name="account-tie-outline" size={23} /></View>
                    <View style={styles.optionCopy}>
                      <AppText variant="label">{role.title}</AppText>
                      {role.description ? <AppText variant="caption" color={colors.inkMuted} numberOfLines={2}>{role.description}</AppText> : null}
                    </View>
                    <MaterialCommunityIcons color={selected ? colors.moss : colors.line} name={selected ? 'radiobox-marked' : 'radiobox-blank'} size={23} />
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {!rolesQuery.isPending && !rolesQuery.error && !rolesQuery.data?.length ? (
            <MessageState
              icon="account-tie-outline"
              title="Add the first role"
              body="A handoff must be attached to a specific responsibility."
              actionLabel="Add role"
              onAction={() => router.push((`/role-new?organizationId=${organizationId}`) as Href)}
            />
          ) : null}
        </View>
      ) : null}

      {roleId ? (
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>3 · SERVICE PERIOD</AppText>
            <AppText variant="heading">When does this handoff apply?</AppText>
          </View>
          <FormInput
            helper="Examples: 2026–2027, Spring 2027, or RoboFest 2027."
            label="Service period"
            maxLength={40}
            onChangeText={setServicePeriod}
            placeholder="2026–2027"
            value={servicePeriod}
          />
        </View>
      ) : null}

      {validationError || mutation.error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.errorCopy}>{validationError ?? mutation.error?.message}</AppText>
        </View>
      ) : null}

      <Button
        disabled={!roleId || mutation.isPending}
        icon="arrow-right"
        label={mutation.isPending ? 'Starting handoff…' : 'Start private draft'}
        onPress={() => void submit()}
      />
      <AppText variant="caption" color={colors.inkMuted} style={styles.center}>Drafts are visible only to authorized organization members.</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  section: {
    gap: spacing.md, marginBottom: spacing.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  sectionHeading: { gap: spacing.xxs },
  optionList: { gap: spacing.sm },
  option: {
    minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.md, backgroundColor: colors.canvas,
  },
  optionSelected: { borderColor: colors.moss, backgroundColor: colors.mossSoft },
  optionCopy: { flex: 1, gap: spacing.xxs },
  roleIcon: {
    width: 46, height: 46, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  pressed: { opacity: 0.78 },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginBottom: spacing.md, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  errorCopy: { flex: 1 },
  center: { marginTop: spacing.xs, textAlign: 'center' },
});
