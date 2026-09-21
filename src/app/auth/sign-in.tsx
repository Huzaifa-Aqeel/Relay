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

export default function SignInScreen() {
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!email.includes('@')) {
      setError('Enter the email address you used for Relay.');
      return;
    }
    if (!password) {
      setError('Enter your password.');
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password);
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in did not complete. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Google sign-in did not complete.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScaffold
      eyebrow="Welcome back"
      title="Continue your Relay"
      intro="Sign in to keep organization knowledge current and safely connected to its role."
      footer={
        <View style={authStyles.linkRow}>
          <AppText color={colors.inkMuted}>New to Relay?</AppText>
          <Pressable accessibilityRole="link" onPress={() => router.replace('/auth/sign-up')} style={authStyles.linkButton}>
            <AppText variant="label" color={colors.moss}>Create an account</AppText>
          </Pressable>
        </View>
      }>
      <View style={authStyles.fields}>
        <FormInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" value={email} />
        <FormInput autoCapitalize="none" autoComplete="current-password" label="Password" onChangeText={setPassword} secureTextEntry value={password} />
        <Pressable accessibilityRole="link" onPress={() => router.push('/auth/forgot-password')} style={authStyles.linkButton}>
          <AppText variant="label" color={colors.moss}>Forgot password?</AppText>
        </Pressable>
      </View>

      {error ? (
        <View accessibilityLiveRegion="polite" style={authStyles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={authStyles.errorCopy}>{error}</AppText>
        </View>
      ) : null}

      <View style={authStyles.actions}>
        <Button disabled={busy} label={busy ? 'Signing in…' : 'Sign in'} onPress={() => void submit()} />
        <View style={authStyles.divider}>
          <View style={authStyles.dividerLine} />
          <AppText variant="caption" color={colors.inkMuted}>OR</AppText>
          <View style={authStyles.dividerLine} />
        </View>
        <Button disabled={busy} icon="google" label="Continue with Google" tone="secondary" onPress={() => void google()} />
      </View>
    </AuthScaffold>
  );
}
