import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/form-controls';
import { InfoCard, InfoRow } from '@/components/ui/info-card';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import {
  acceptAssignment,
  createAssignmentInvite,
  useContinuity,
  useContinuityAction,
} from '@/features/relay/continuity';
import { useRole } from '@/features/relay/queries';
import { assignmentInviteUrl } from '@/features/relay/share-link';
import { colors, radii, spacing } from '@/theme/tokens';

type Assignment = { id: string; userId: string; name: string; servicePeriod: string };
type IssuedInvite = { token: string; expiresAt: string; servicePeriod: string; replacement: boolean };
type AssignmentAction =
  | { kind: 'invite'; servicePeriod: string; replacement: boolean }
  | { kind: 'self'; servicePeriod: string };

function periodStart(value?: string) {
  const match = value?.match(/^([0-9]{4})\s*[-–—/]\s*([0-9]{2}|[0-9]{4})$/);
  return match ? Number(match[1]) : null;
}

function periodLabel(start: number) {
  return `${start}–${start + 1}`;
}

function currentAcademicStart() {
  const now = new Date();
  return now.getMonth() >= 5 ? now.getFullYear() : now.getFullYear() - 1;
}

function nextPeriodChoices(current?: string) {
  const currentStart = periodStart(current);
  const first = currentStart === null ? currentAcademicStart() : currentStart + 1;
  return [first, first + 1, first + 2].map((start) => ({ value: periodLabel(start), label: periodLabel(start) }));
}

export default function RoleAssignmentScreen() {
  const { roleId } = useLocalSearchParams<{ roleId: string }>();
  const auth = useAuth();
  const role = useRole(roleId);
  const overview = useContinuity(role.data?.organizationId);
  const roleOverview = overview.data?.roles.find((candidate) => candidate.roleId === roleId);
  const assignments = roleOverview?.assignments ?? [];
  const currentAssignment = assignments[0] as Assignment | undefined;
  const isCurrentHolder = currentAssignment?.userId === auth.session?.user.id;
  const canManage = Boolean(overview.data?.isOwner || isCurrentHolder);
  const periods = useMemo(() => nextPeriodChoices(currentAssignment?.servicePeriod), [currentAssignment?.servicePeriod]);
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const period = periods.some((choice) => choice.value === selectedPeriod)
    ? selectedPeriod
    : periods[0]?.value ?? '';
  const [replacing, setReplacing] = useState(false);
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [notice, setNotice] = useState('');

  const action = useContinuityAction(async (input: AssignmentAction) => {
    setNotice('');
    const invite = await createAssignmentInvite(
      roleId,
      input.servicePeriod,
      input.kind === 'invite' && input.replacement,
    );
    if (input.kind === 'self') {
      const handoffId = await acceptAssignment(invite.token);
      router.replace(`/handoff/${handoffId}` as Href);
      return;
    }
    setIssued({ ...invite, servicePeriod: input.servicePeriod, replacement: input.replacement });
  });

  if (!roleId) {
    return <Screen><MessageState icon="account-alert-outline" title="Choose a Role first" body="Succession must stay attached to one Role." /></Screen>;
  }
  if (role.isPending || overview.isPending) return <Screen><LoadingState label="Opening Role succession…" /></Screen>;
  if (role.error || overview.error || !role.data || !overview.data || !roleOverview) {
    return <Screen><MessageState icon="account-alert-outline" title="Role unavailable" body={(role.error ?? overview.error)?.message ?? 'This Role could not be opened.'} /></Screen>;
  }

  const roleTitle = role.data.title;
  const roleAvailableOnPlan = roleOverview.planAvailable;
  if (!roleAvailableOnPlan) {
    return (
      <Screen>
        <MessageState
          icon="lock-outline"
          title="Relay Pro required"
          body={overview.data.isOwner
            ? `Upgrade this Organization to manage succession for ${roleTitle}.`
            : `Ask the Organization Owner to upgrade before changing the ${roleTitle} assignment.`}
          actionLabel={overview.data.isOwner ? 'View Relay Pro' : undefined}
          onAction={overview.data.isOwner
            ? () => router.push(`/paywall?reason=role&organizationId=${role.data!.organizationId}` as Href)
            : undefined}
        />
      </Screen>
    );
  }
  const inviteUrl = issued ? assignmentInviteUrl(issued.token) : null;

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>ROLE SUCCESSION</AppText>
        <AppText variant="display">{roleTitle}</AppText>
        <AppText color={colors.inkMuted}>Invite the next person when this Role is ready to change hands.</AppText>
      </View>

      {currentAssignment ? (
        <InfoCard eyebrow="Current holder" title={currentAssignment.name || 'Role Holder'}>
          <InfoRow label="Service period" value={currentAssignment.servicePeriod} />
        </InfoCard>
      ) : (
        <InfoCard eyebrow="Current holder" title="Not assigned">
          <AppText color={colors.inkMuted}>Invite the first holder or assign yourself during initial setup.</AppText>
        </InfoCard>
      )}

      {!canManage ? (
        <MessageState
          icon="shield-account-outline"
          title="Succession is managed by this Role"
          body={`Only the Organization Owner or the current ${roleTitle} can invite the next holder.`}
        />
      ) : (
        <>
          {!replacing ? (
            <View style={styles.section}>
              <View style={styles.sectionHeading}>
                <AppText variant="heading">{currentAssignment ? `Invite next ${roleTitle}` : `Invite first ${roleTitle}`}</AppText>
                <AppText color={colors.inkMuted}>
                  {currentAssignment
                    ? 'Choose the next service period. The new workspace will start from the previous published handoff.'
                    : 'Choose the service period this person will maintain.'}
                </AppText>
              </View>
              <ChoiceGroup
                label={currentAssignment ? 'Next service period' : 'Service period'}
                value={period}
                choices={periods}
                selectionTone="soft"
                onChange={(value) => { setSelectedPeriod(value); setIssued(null); }}
              />
              <Button
                disabled={!period || action.isPending}
                icon="account-arrow-right-outline"
                label={currentAssignment ? `Invite next ${roleTitle}` : `Invite first ${roleTitle}`}
                onPress={() => action.mutate({ kind: 'invite', servicePeriod: period, replacement: false })}
              />
              {!currentAssignment && overview.data.isOwner ? (
                <Button
                  disabled={!period || action.isPending}
                  label="Assign myself for initial setup"
                  tone="secondary"
                  onPress={() => action.mutate({ kind: 'self', servicePeriod: period })}
                />
              ) : null}
              {currentAssignment ? (
                <Button
                  label="Replace current holder"
                  onPress={() => { setReplacing(true); setIssued(null); }}
                />
              ) : null}
            </View>
          ) : currentAssignment ? (
            <View style={styles.replaceCard}>
              <MaterialCommunityIcons color={colors.saffron} name="account-switch-outline" size={28} />
              <View style={styles.replaceCopy}>
                <AppText variant="heading">Replace current holder</AppText>
                <AppText color={colors.inkMuted}>
                  Invite a replacement for {currentAssignment.name || 'the current holder'} in {currentAssignment.servicePeriod}. They keep access until the replacement signs in and accepts.
                </AppText>
                <AppText>The replacement will continue the same working Handoff with its existing history and attribution.</AppText>
              </View>
              <Button
                disabled={action.isPending}
                label="Create replacement invite"
                onPress={() => action.mutate({
                  kind: 'invite',
                  servicePeriod: currentAssignment.servicePeriod,
                  replacement: true,
                })}
              />
              <Button label="Cancel" tone="ghost" onPress={() => { setReplacing(false); setIssued(null); }} />
            </View>
          ) : null}

          {issued ? (
            <View style={styles.inviteCard}>
              <MaterialCommunityIcons color={colors.moss} name="check-circle-outline" size={28} />
              <View style={styles.inviteCopy}>
                <AppText variant="heading">Invite ready</AppText>
                <AppText color={colors.inkMuted}>
                  {issued.replacement ? `Replacement ${roleTitle}` : roleTitle} · {issued.servicePeriod}
                </AppText>
                <AppText variant="caption" color={colors.inkMuted}>
                  This single-use link expires {new Date(issued.expiresAt).toLocaleDateString()}.
                </AppText>
              </View>
              {inviteUrl ? (
                <>
                  <Button
                    label="Copy invite link"
                    onPress={() => void Clipboard.setStringAsync(inviteUrl).then(() => setNotice('Invite link copied.'))}
                  />
                  <Button
                    label="Share invite"
                    tone="secondary"
                    onPress={() => void Share.share({
                      title: `${roleTitle} invitation`,
                      message: `You’re invited to become ${roleTitle} for ${issued.servicePeriod} in Relay.\n\n${inviteUrl}`,
                      url: inviteUrl,
                    })}
                  />
                </>
              ) : null}
            </View>
          ) : null}

        </>
      )}

      {action.error ? <AppText accessibilityLiveRegion="polite" color={colors.emergency}>{action.error.message}</AppText> : null}
      {notice ? <AppText accessibilityLiveRegion="polite" color={colors.moss}>{notice}</AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  section: { gap: spacing.lg, marginTop: spacing.xl },
  sectionHeading: { gap: spacing.xxs },
  replaceCard: {
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  replaceCopy: { gap: spacing.xs },
  inviteCard: {
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.mossSoft,
  },
  inviteCopy: { gap: spacing.xxs },
});
