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

export default function NewPasswordScreen() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < 8) return setError('Use at least 8 characters for your new password.');
    if (password !== confirmation) return setError('The two passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
      router.replace('/');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your password could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScaffold eyebrow="Account access" title="Choose a new password" intro="Use something unique that you do not use for another service.">
      <View style={authStyles.fields}>
        <FormInput autoComplete="new-password" label="New password" onChangeText={setPassword} secureTextEntry value={password} />
        <FormInput autoComplete="new-password" label="Confirm password" onChangeText={setConfirmation} secureTextEntry value={confirmation} />
      </View>
      {error ? (
        <View accessibilityLiveRegion="polite" style={authStyles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={authStyles.errorCopy}>{error}</AppText>
        </View>
      ) : null}
      <Button disabled={busy} label={busy ? 'Updating…' : 'Update password'} onPress={() => void submit()} />
    </AuthScaffold>
  );
}
