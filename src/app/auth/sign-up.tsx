import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { useAuth } from '@/features/auth/auth-provider';
import { AuthScaffold, authStyles } from '@/features/auth/auth-ui';
import { colors } from '@/theme/tokens';

export default function SignUpScreen() {
  const { signUp, signInWithGoogle } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('Tell us what to call you.');
    if (!email.includes('@')) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      const result = await signUp(name, email, password);
      if (result.needsEmailConfirmation) setConfirmationEmail(email.trim());
      else router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your account could not be created.');
    } finally {
      setBusy(false);
    }
  }

  if (confirmationEmail) {
    return (
      <AuthScaffold eyebrow="One quick check" title="Check your email" intro="Your profile is ready to begin after you confirm this address.">
        <View style={authStyles.success}>
          <MaterialCommunityIcons color={colors.moss} name="email-check-outline" size={38} />
          <AppText variant="heading" style={authStyles.centered}>{confirmationEmail}</AppText>
          <AppText color={colors.inkMuted} style={authStyles.centered}>
            Open the confirmation email on this device, then return to Relay.
          </AppText>
        </View>
        <Button label="Back to sign in" onPress={() => router.replace('/auth/sign-in')} />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      eyebrow="Your knowledge workspace"
      title="Create your account"
      intro="Draft sources stay private. Recipients see only the approved content you publish."
      footer={
        <View style={authStyles.linkRow}>
          <AppText color={colors.inkMuted}>Already have an account?</AppText>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/auth/sign-in')} style={authStyles.linkButton}>
            <AppText variant="label" color={colors.moss}>Sign in</AppText>
          </Pressable>
        </View>
      }>
      <View style={authStyles.fields}>
        <FormInput autoCapitalize="words" autoComplete="name" label="Your name" onChangeText={setName} placeholder="How your organization knows you" value={name} />
        <FormInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" value={email} />
        <FormInput autoCapitalize="none" autoComplete="new-password" helper="At least 8 characters." label="Password" onChangeText={setPassword} secureTextEntry value={password} />
      </View>

      {error ? (
        <View accessibilityLiveRegion="polite" style={authStyles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={authStyles.errorCopy}>{error}</AppText>
        </View>
      ) : null}

      <View style={authStyles.actions}>
        <Button disabled={busy} label={busy ? 'Creating account…' : 'Create account'} onPress={() => void submit()} />
        <View style={authStyles.divider}>
          <View style={authStyles.dividerLine} />
          <AppText variant="caption" color={colors.inkMuted}>OR</AppText>
          <View style={authStyles.dividerLine} />
        </View>
        <Button disabled={busy} icon="google" label="Continue with Google" tone="secondary" onPress={() => void signInWithGoogle().catch((caught) => setError(caught instanceof Error ? caught.message : 'Google sign-in did not complete.'))} />
      </View>

      <View style={authStyles.linkRow}>
        <AppText variant="caption" color={colors.inkMuted}>By continuing, you agree to the</AppText>
        <Pressable accessibilityRole="link" onPress={() => router.push('/legal/terms')} style={authStyles.linkButton}>
          <AppText variant="caption" color={colors.moss}>Terms</AppText>
        </Pressable>
        <AppText variant="caption" color={colors.inkMuted}>and</AppText>
        <Pressable accessibilityRole="link" onPress={() => router.push('/legal/privacy')} style={authStyles.linkButton}>
          <AppText variant="caption" color={colors.moss}>Privacy Policy.</AppText>
        </Pressable>
      </View>
    </AuthScaffold>
  );
}
