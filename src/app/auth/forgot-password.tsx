import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { useAuth } from '@/features/auth/auth-provider';
import { AuthScaffold, authStyles } from '@/features/auth/auth-ui';
import { colors } from '@/theme/tokens';

export default function ForgotPasswordScreen() {
  const { sendPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.includes('@')) return setError('Enter a valid email address.');
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The reset email could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScaffold eyebrow="Account access" title="Reset your password" intro="We’ll send one secure reset link. It expires automatically.">
      {sent ? (
        <View style={authStyles.success}>
          <MaterialCommunityIcons color={colors.moss} name="email-fast-outline" size={38} />
          <AppText variant="heading">Check your inbox</AppText>
          <AppText color={colors.inkMuted} style={authStyles.centered}>
            If an account exists for {email.trim()}, a reset link is on its way.
          </AppText>
        </View>
      ) : (
        <View style={authStyles.fields}>
          <FormInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="you@example.com" value={email} />
          {error ? (
            <View accessibilityLiveRegion="polite" style={authStyles.error}>
              <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
              <AppText variant="caption" color={colors.emergency} style={authStyles.errorCopy}>{error}</AppText>
            </View>
          ) : null}
          <Button disabled={busy} label={busy ? 'Sending…' : 'Send reset link'} onPress={() => void submit()} />
        </View>
      )}
      <Button label="Back to sign in" tone="ghost" onPress={() => router.replace('/auth/sign-in')} />
    </AuthScaffold>
  );
}
