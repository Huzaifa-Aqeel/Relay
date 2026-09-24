import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useAuth } from '@/features/auth/auth-provider';
import { checkContinuityError, useContinuity, useContinuityAction } from '@/features/relay/continuity';
import { requireSupabase } from '@/lib/supabase';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

type TransferAction = 'offer' | 'accept';

export default function OwnershipTransferScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { session } = useAuth();
  const overview = useContinuity(organizationId);
  const [selected, setSelected] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [notice, setNotice] = useState('');

  const candidates = useMemo(() => overview.data?.members.filter(
    (member) => member.userId !== session?.user.id,
  ) ?? [], [overview.data, session?.user.id]);
  const selectedMember = candidates.find((member) => member.userId === selected);
  const pending = overview.data?.pendingTransfer;
  const receivingOffer = pending?.toUserId === session?.user.id && !overview.data?.isOwner;

  const roleDetails = (userId: string) => overview.data?.roles.flatMap((role) =>
    role.assignments
      .filter((assignment) => assignment.userId === userId)
      .map((assignment) => `${role.title} · ${assignment.servicePeriod}`),
  ) ?? [];

  const action = useContinuityAction(async (kind: TransferAction) => {
    setNotice('');
    if (kind === 'accept') {
      const result = await requireSupabase().rpc('accept_organization_ownership_transfer', {
        requested_transfer_id: pending!.id,
      });
      checkContinuityError(result.error);
      setNotice('Ownership transferred. Role assignments and organization history were not changed.');
      return;
    }

    const result = await requireSupabase().rpc('request_organization_ownership_transfer', {
      requested_organization_id: organizationId,
      requested_user_id: selected,
    });
    checkContinuityError(result.error);
    setShowConfirmation(false);
  });

  if (!organizationId) {
    return <Screen><MessageState icon="office-building-remove-outline" title="Organization unavailable" body="Open ownership from an Organization." /></Screen>;
  }
  if (overview.isPending) return <Screen><LoadingState label="Opening organization ownership…" /></Screen>;
  if (overview.error || !overview.data) {
    return <Screen><MessageState icon="shield-account-outline" title="Ownership unavailable" body={overview.error?.message ?? 'This Organization could not be opened.'} /></Screen>;
  }

  const sessionName = session?.user.user_metadata.display_name as string | undefined;
  const currentOwnerName = overview.data.currentOwnerName || (overview.data.isOwner ? sessionName : undefined) || 'Current Organization Owner';
  const pendingMember = pending
    ? overview.data.members.find((member) => member.userId === pending.toUserId)
    : undefined;
  const nextOwnerName = pendingMember?.name
    || (pending?.toUserId === session?.user.id ? sessionName : undefined)
    || selectedMember?.name
    || 'Organization member';
  const nextOwnerDetails = pending ? roleDetails(pending.toUserId) : selectedMember ? roleDetails(selectedMember.userId) : [];

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="display">Organization ownership</AppText>
      </View>

      <View style={styles.ownerCard}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>CURRENT OWNER</AppText>
        <AppText variant="heading">{currentOwnerName}</AppText>
      </View>

      {pending ? (
        <View style={styles.section}>
          <AppText variant="heading">{receivingOffer ? 'Ownership offered to you' : 'Next owner'}</AppText>
          <PersonCard
            details={nextOwnerDetails}
            name={nextOwnerName}
            selected
          />
          <AppText variant="caption" color={colors.inkMuted}>
            This transfer expires {new Date(pending.expiresAt).toLocaleDateString()}.
          </AppText>
          {receivingOffer ? (
            <>
              <TransferImpact />
              <Button
                disabled={action.isPending}
                label={action.isPending ? 'Accepting…' : 'Accept ownership'}
                onPress={() => action.mutate('accept')}
              />
            </>
          ) : (
            <AppText color={colors.inkMuted}>{nextOwnerName} must accept before ownership changes.</AppText>
          )}
        </View>
      ) : overview.data.isOwner ? (
        <View style={styles.section}>
          <AppText variant="heading">Transfer ownership to</AppText>
          {candidates.length ? (
            <View accessibilityRole="radiogroup" style={styles.people}>
              {candidates.map((member) => (
                <PersonCard
                  details={roleDetails(member.userId)}
                  key={member.userId}
                  name={member.name || 'Organization member'}
                  onPress={() => setSelected(member.userId)}
                  selected={selected === member.userId}
                />
              ))}
            </View>
          ) : (
            <AppText color={colors.inkMuted}>Add an active Role Holder before transferring ownership.</AppText>
          )}
          <Button
            disabled={!selectedMember || action.isPending}
            label="Transfer ownership"
            onPress={() => setShowConfirmation(true)}
          />
        </View>
      ) : (
        <MessageState
          icon="shield-account-outline"
          title="No ownership offer"
          body="Only the current Owner can begin an ownership transfer."
        />
      )}

      {notice ? <AppText accessibilityLiveRegion="polite" color={colors.moss}>{notice}</AppText> : null}
      {action.error ? <AppText accessibilityLiveRegion="polite" color={colors.emergency}>{action.error.message}</AppText> : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setShowConfirmation(false)}
        transparent
        visible={showConfirmation && Boolean(selectedMember)}>
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.modalCard}>
            <AppText variant="heading">Transfer ownership to {nextOwnerName}?</AppText>
            <TransferImpact name={nextOwnerName} />
            <View style={styles.modalActions}>
              <Button
                disabled={action.isPending}
                label="Cancel"
                style={styles.modalButton}
                tone="secondary"
                onPress={() => setShowConfirmation(false)}
              />
              <Button
                disabled={action.isPending}
                label={action.isPending ? 'Transferring…' : 'Transfer ownership'}
                style={styles.modalButton}
                onPress={() => action.mutate('offer')}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function PersonCard({
  name,
  details,
  selected,
  onPress,
}: {
  name: string;
  details: string[];
  selected: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'radio' : undefined}
      accessibilityState={onPress ? { checked: selected } : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.personCard, selected && styles.personCardSelected, pressed && styles.pressed]}>
      <View style={styles.personIcon}>
        <MaterialCommunityIcons color={colors.moss} name="account-outline" size={24} />
      </View>
      <View style={styles.personCopy}>
        <AppText variant="label">{name}</AppText>
        <AppText variant="caption" color={colors.inkMuted}>
          {details.length ? details.join('\n') : 'Active organization member'}
        </AppText>
      </View>
      {onPress ? (
        <MaterialCommunityIcons
          color={selected ? colors.moss : colors.inkMuted}
          name={selected ? 'radiobox-marked' : 'radiobox-blank'}
          size={23}
        />
      ) : null}
    </Pressable>
  );
}

function TransferImpact({ name = 'The new Owner' }: { name?: string }) {
  return (
    <View style={styles.impact}>
      <AppText>{name} will be able to manage roles, succession, and the organization’s Relay plan.</AppText>
      <AppText>Your previous contributions and history will stay intact. Your role assignments will not automatically change.</AppText>
      <AppText>If you purchased Relay Pro, your store billing account remains yours; the organization keeps Pro while that subscription remains active.</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.xl },
  ownerCard: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadow,
  },
  eyebrow: { letterSpacing: 1.2 },
  section: { gap: spacing.md, marginTop: spacing.xl },
  people: { gap: spacing.sm },
  personCard: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadow,
  },
  personCardSelected: { borderColor: colors.moss, backgroundColor: colors.mossSoft },
  personIcon: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  personCopy: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.76 },
  impact: { gap: spacing.md },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: 'rgba(22,20,17,0.48)',
    zIndex: 1000,
  },
  modalCard: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: spacing.lg,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm },
  modalButton: { flex: 1 },
});
