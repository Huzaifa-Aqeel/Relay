import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/form-controls';
import { InfoCard, InfoRow } from '@/components/ui/info-card';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import {
  acceptAssignment,
  checkContinuityError,
  createAssignmentInvite,
  useContinuity,
  useContinuityAction,
} from '@/features/relay/continuity';
import { useRole } from '@/features/relay/queries';
import { assignmentInviteUrl } from '@/features/relay/share-link';
import { requireSupabase } from '@/lib/supabase';
import { colors, radii, spacing } from '@/theme/tokens';

type Assignment = { id: string; userId: string; name: string; servicePeriod: string };
type IssuedInvite = { token: string; expiresAt: string; servicePeriod: string; replacement: boolean };
type AssignmentAction =
  | { kind: 'invite'; servicePeriod: string; replacement: boolean }
  | { kind: 'self'; servicePeriod: string }
  | { kind: 'end'; assignmentId: string };

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
  const [period, setPeriod] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const [notice, setNotice] = useState('');
  const [showHolderMenu, setShowHolderMenu] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);

  useEffect(() => {
    if (!periods.some((choice) => choice.value === period)) setPeriod(periods[0]?.value ?? '');
  }, [period, periods]);

  const action = useContinuityAction(async (input: AssignmentAction) => {
    setNotice('');
    if (input.kind === 'end') {
      const { error } = await requireSupabase().rpc('end_role_assignment', {
        requested_assignment_id: input.assignmentId,
      });
      checkContinuityError(error);
      setShowHolderMenu(false);
      setConfirmingEnd(false);
      setNotice('Assignment ended. This person no longer has private workspace access.');
      return;
    }

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
  const inviteUrl = issued ? assignmentInviteUrl(issued.token) : null;

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>ROLE SUCCESSION</AppText>
        <AppText variant="display">{roleTitle}</AppText>
        <AppText color={colors.inkMuted}>Invite the next person when this Role is ready to change hands.</AppText>
      </View>

      {currentAssignment ? (
        <InfoCard
          action={overview.data.isOwner ? (
            <Pressable
              accessibilityLabel="Current holder options"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => { setConfirmingEnd(false); setShowHolderMenu(true); }}
              style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons color={colors.ink} name="dots-horizontal" size={25} />
            </Pressable>
          ) : undefined}
          eyebrow="Current holder"
          title={currentAssignment.name || 'Role Holder'}>
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
                onChange={(value) => { setPeriod(value); setIssued(null); }}
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
                  tone="ghost"
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
                  {issued.replacement ? 'Replacement' : roleTitle} · {issued.servicePeriod}
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
                    onPress={() => void Share.share({ message: `Open this Relay invitation for ${roleTitle}: ${inviteUrl}` })}
                  />
                </>
              ) : null}
            </View>
          ) : null}

        </>
      )}

      {action.error ? <AppText accessibilityLiveRegion="polite" color={colors.emergency}>{action.error.message}</AppText> : null}
      {notice ? <AppText accessibilityLiveRegion="polite" color={colors.moss}>{notice}</AppText> : null}

      <Modal
        animationType="fade"
        onRequestClose={() => { setShowHolderMenu(false); setConfirmingEnd(false); }}
        transparent
        visible={showHolderMenu && Boolean(currentAssignment)}>
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.modalCard}>
            {confirmingEnd ? (
              <>
                <AppText variant="heading">End this assignment?</AppText>
                <AppText color={colors.inkMuted}>
                  {currentAssignment?.name || 'This person'} will lose access to this Role's private workspace. Existing history and attribution will remain.
                </AppText>
                <View style={styles.modalActions}>
                  <Button
                    disabled={action.isPending || !currentAssignment}
                    label={action.isPending ? 'Ending…' : 'End assignment'}
                    tone="emergency"
                    onPress={() => currentAssignment && action.mutate({ kind: 'end', assignmentId: currentAssignment.id })}
                  />
                  <Button
                    disabled={action.isPending}
                    label="Keep assignment"
                    tone="secondary"
                    onPress={() => setConfirmingEnd(false)}
                  />
                </View>
              </>
            ) : (
              <>
                <AppText variant="heading">Current holder</AppText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setConfirmingEnd(true)}
                  style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}>
                  <MaterialCommunityIcons color={colors.emergency} name="account-minus-outline" size={22} />
                  <AppText variant="label" color={colors.emergency}>End assignment</AppText>
                </Pressable>
                <Button
                  label="Cancel"
                  tone="ghost"
                  onPress={() => setShowHolderMenu(false)}
                />
              </>
            )}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
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
  moreButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
  },
  pressed: { opacity: 0.68 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: spacing.lg,
    backgroundColor: 'rgba(22,20,17,0.48)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: '#FFF5F2',
  },
  modalActions: { gap: spacing.sm, marginTop: spacing.xs },
});
