import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { AuthScaffold } from '@/features/auth/auth-ui';
import { colors, radii, spacing } from '@/theme/tokens';

export default function AuthCallbackScreen() {
  const { code, type, returnTo } = useLocalSearchParams<{ code?: string; type?: string; returnTo?: string }>();
  const { exchangeCode } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError('This sign-in link is incomplete or has expired.');
      return;
    }
    const safeReturnTo = returnTo && /^\/assignment\/[0-9a-f]{64}$/.test(returnTo) ? returnTo as Href : null;
    void exchangeCode(code)
      .then(() => router.replace(type === 'recovery' ? '/auth/new-password' : safeReturnTo ?? '/'))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'This link could not be completed.'));
  }, [code, exchangeCode, returnTo, type]);

  return (
    <AuthScaffold eyebrow="Secure return" title={error ? 'This link needs attention' : 'Opening Relay'} intro={error ?? 'Your account is being confirmed on this device.'}>
      <View style={styles.status}>
        <MaterialCommunityIcons color={error ? colors.emergency : colors.moss} name={error ? 'link-variant-off' : 'shield-check-outline'} size={38} />
        <AppText color={colors.inkMuted} style={styles.center}>
          {error ? 'Request a new link from the sign-in screen.' : 'This should only take a moment.'}
        </AppText>
      </View>
      {error ? <Button label="Back to sign in" onPress={() => router.replace('/auth/sign-in')} /> : null}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  status: { alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  center: { textAlign: 'center' },
});
