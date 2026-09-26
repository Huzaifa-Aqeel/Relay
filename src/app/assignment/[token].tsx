import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { useAuth } from '@/features/auth/auth-provider';
import { AuthScaffold, authStyles } from '@/features/auth/auth-ui';
import {
  acceptAssignment,
  previewAssignmentInvite,
  useContinuityAction,
} from '@/features/relay/continuity';
import { colors, radii, spacing } from '@/theme/tokens';

type AuthMode = 'sign-in' | 'create-account';

function invitationDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AssignmentInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const valid = /^[0-9a-f]{64}$/.test(token ?? '');

  const preview = useQuery({
    queryKey: ['relay', 'assignment-invite', token],
    enabled: valid,
    retry: false,
    queryFn: () => previewAssignmentInvite(token),
  });

  const action = useContinuityAction(async (intent: 'authenticate' | 'accept') => {
    setNotice('');
    if (intent === 'accept') {
      return acceptAssignment(token);
    }
    if (mode === 'create-account') {
      const result = await auth.signUp(name, email, password, `/assignment/${token}`);
      if (result.needsEmailConfirmation) {
        setNotice('Check your email to confirm your account. Open the confirmation on this device to return here.');
      }
      return;
    }
    await auth.signIn(email, password);
    return null;
  });

  async function acceptInvite() {
    try {
      const handoffId = await action.mutateAsync('accept');
      if (typeof handoffId === 'string') router.replace('/(tabs)/action' as Href);
    } catch {
      // The mutation exposes its safe error in the invitation card.
    }
  }

  function chooseMode(nextMode: AuthMode) {
    setMode(nextMode);
    setNotice('');
    action.reset();
  }

  const invitation = preview.data;
  const expiryLabel = invitationDate(invitation?.expiresAt ?? '');
  const title = invitation
    ? `You’re invited to lead ${invitation.roleTitle}`
    : valid
      ? 'Open your Relay invitation'
      : 'Invitation unavailable';
  const intro = invitation
    ? `Join ${invitation.organizationName} for ${invitation.servicePeriod}.`
    : valid
      ? 'Relay is checking the invitation details.'
      : 'This link is invalid or incomplete.';

  return (
    <AuthScaffold title={title} intro={intro}>
      {!valid ? (
        <View style={styles.state}>
          <MaterialCommunityIcons color={colors.inkMuted} name="link-off" size={34} />
          <AppText variant="heading" style={styles.center}>This invitation is unavailable</AppText>
          <AppText color={colors.inkMuted} style={styles.center}>Ask the Role Holder to send you a new link.</AppText>
        </View>
      ) : preview.isPending ? (
        <View accessibilityLiveRegion="polite" style={styles.state}>
          <View style={styles.loadingMark} />
          <AppText variant="label" color={colors.moss}>Opening your invitation…</AppText>
        </View>
      ) : preview.error || !invitation ? (
        <View style={styles.state}>
          <MaterialCommunityIcons color={colors.inkMuted} name="link-off" size={34} />
          <AppText variant="heading" style={styles.center}>This invitation is no longer available</AppText>
          <AppText color={colors.inkMuted} style={styles.center}>It may have expired, been replaced, or already been used.</AppText>
        </View>
      ) : !invitation.planAvailable ? (
        <View style={styles.state}>
          <MaterialCommunityIcons color={colors.inkMuted} name="lock-outline" size={34} />
          <AppText variant="heading" style={styles.center}>Relay Pro required</AppText>
          <AppText color={colors.inkMuted} style={styles.center}>
            This Role is preserved, but the Organization Owner needs to restore Relay Pro before this invitation can be accepted.
          </AppText>
        </View>
      ) : (
        <>
          {auth.status === 'loading' ? (
            <View accessibilityLiveRegion="polite" style={styles.compactState}>
              <AppText color={colors.inkMuted}>Checking your Relay account…</AppText>
            </View>
          ) : auth.status !== 'authenticated' ? (
            <>
              <View style={styles.authHeading}>
                <AppText variant="heading">Continue to your handoff</AppText>
                <AppText color={colors.inkMuted}>Use your Relay account or create one to accept.</AppText>
              </View>

              <View accessibilityRole="tablist" style={styles.modeSwitch}>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === 'sign-in' }}
                  onPress={() => chooseMode('sign-in')}
                  style={({ pressed }) => [
                    styles.modeButton,
                    mode === 'sign-in' && styles.modeButtonSelected,
                    pressed && styles.pressed,
                  ]}>
                  <AppText variant="label" color={mode === 'sign-in' ? colors.white : colors.ink}>Sign in</AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === 'create-account' }}
                  onPress={() => chooseMode('create-account')}
                  style={({ pressed }) => [
                    styles.modeButton,
                    mode === 'create-account' && styles.modeButtonSelected,
                    pressed && styles.pressed,
                  ]}>
                  <AppText variant="label" color={mode === 'create-account' ? colors.white : colors.ink}>Create account</AppText>
                </Pressable>
              </View>

              <View style={authStyles.fields}>
                {mode === 'create-account' ? (
                  <FormInput
                    autoCapitalize="words"
                    autoComplete="name"
                    label="Your name"
                    onChangeText={setName}
                    placeholder="How your organization knows you"
                    value={name}
                  />
                ) : null}
                <FormInput
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  label="Email"
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  value={email}
                />
                <FormInput
                  autoCapitalize="none"
                  autoComplete={mode === 'create-account' ? 'new-password' : 'current-password'}
                  helper={mode === 'create-account' ? 'At least 8 characters.' : undefined}
                  label="Password"
                  onChangeText={setPassword}
                  secureTextEntry
                  value={password}
                />
              </View>

              {action.error ? (
                <View accessibilityLiveRegion="polite" style={authStyles.error}>
                  <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
                  <AppText variant="caption" color={colors.emergency} style={authStyles.errorCopy}>{action.error.message}</AppText>
                </View>
              ) : null}
              {notice ? (
                <View accessibilityLiveRegion="polite" style={styles.notice}>
                  <MaterialCommunityIcons color={colors.moss} name="email-check-outline" size={20} />
                  <AppText variant="caption" color={colors.moss} style={styles.noticeCopy}>{notice}</AppText>
                </View>
              ) : null}

              <Button
                disabled={
                  action.isPending
                  || !email.includes('@')
                  || password.length < (mode === 'create-account' ? 8 : 1)
                  || (mode === 'create-account' && !name.trim())
                }
                icon={mode === 'create-account' ? 'account-plus-outline' : 'login'}
                label={action.isPending
                  ? mode === 'create-account' ? 'Creating account…' : 'Signing in…'
                  : mode === 'create-account' ? 'Create account and continue' : 'Sign in and continue'}
                onPress={() => action.mutate('authenticate')}
              />
            </>
          ) : (
            <>
              <View style={styles.acceptCopy}>
                <AppText variant="heading">Ready to continue?</AppText>
                <AppText color={colors.inkMuted}>
                  {invitation.replacement
                    ? `You’ll continue the existing ${invitation.roleTitle} handoff for ${invitation.servicePeriod}. The current holder’s access ends after you accept.`
                    : `You’ll open the ${invitation.roleTitle} handoff for ${invitation.servicePeriod}. Approved published knowledge is carried forward when available.`}
                </AppText>
              </View>
              <View style={styles.signedInRow}>
                <MaterialCommunityIcons color={colors.moss} name="check-circle-outline" size={20} />
                <View style={styles.flex}>
                  <AppText variant="caption" color={colors.inkMuted}>SIGNED IN AS</AppText>
                  <AppText variant="label">{auth.session?.user.email}</AppText>
                </View>
              </View>
              {action.error ? (
                <View accessibilityLiveRegion="polite" style={authStyles.error}>
                  <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
                  <AppText variant="caption" color={colors.emergency} style={authStyles.errorCopy}>{action.error.message}</AppText>
                </View>
              ) : null}
              <Button
                disabled={action.isPending}
                icon="arrow-right"
                label={action.isPending ? 'Opening Relay…' : 'Accept and open workspace'}
                onPress={() => void acceptInvite()}
              />
            </>
          )}

          {expiryLabel ? (
            <AppText variant="caption" color={colors.inkMuted} style={styles.expiry}>Invitation available until {expiryLabel}.</AppText>
          ) : null}
        </>
      )}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  compactState: { alignItems: 'center', paddingVertical: spacing.md },
  loadingMark: {
    width: 50, height: 50, borderRadius: radii.pill,
    backgroundColor: colors.mossSoft, borderWidth: 9, borderColor: colors.surfaceMuted,
  },
  center: { textAlign: 'center' },
  authHeading: { gap: spacing.xxs, marginTop: spacing.xs },
  modeSwitch: {
    flexDirection: 'row', gap: spacing.xs, padding: spacing.xxs,
    borderRadius: radii.md, backgroundColor: colors.surfaceMuted,
  },
  modeButton: {
    minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.sm, borderRadius: radii.sm,
  },
  modeButtonSelected: { backgroundColor: colors.moss },
  pressed: { opacity: 0.78 },
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  noticeCopy: { flex: 1 },
  acceptCopy: { gap: spacing.xs, marginTop: spacing.xs },
  signedInRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted,
  },
  flex: { flex: 1 },
  expiry: { textAlign: 'center', marginTop: spacing.xs },
});
