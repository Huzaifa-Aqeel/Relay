import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { AuthScaffold } from '@/features/auth/auth-ui';
import { useAuth } from '@/features/auth/auth-provider';
import { colors, radii, spacing } from '@/theme/tokens';

export default function AuthWelcomeScreen() {
  const { isCloudEnabled, status } = useAuth();

  return (
    <AuthScaffold
      eyebrow="Knowledge that carries forward"
      title="Leadership knowledge should outlast the leader"
      intro="Capture how a role actually works, resolve what is unclear, and publish a handoff a successor can trust."
      footer={
        <AppText variant="caption" color={colors.inkMuted} style={styles.center}>
          Published handoffs never require a recipient account.
        </AppText>
      }>
      <View style={styles.promiseList}>
        {[
          ['microphone-outline', 'Capture voice, text, and documents'],
          ['message-question-outline', 'Preflight finds what is still unclear'],
          ['link-variant', 'A no-login handoff for the successor'],
        ].map(([icon, label]) => (
          <View key={label} style={styles.promiseRow}>
            <View style={styles.promiseIcon}>
              <MaterialCommunityIcons color={colors.moss} name={icon as 'link-variant'} size={21} />
            </View>
            <AppText variant="label">{label}</AppText>
          </View>
        ))}
      </View>

      {!isCloudEnabled ? (
        <View style={styles.demoNotice}>
          <MaterialCommunityIcons color={colors.moss} name="laptop" size={21} />
          <AppText variant="caption" color={colors.moss} style={styles.demoCopy}>
            This local build is in preview mode. Add the Supabase client settings to enable accounts.
          </AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          disabled={!isCloudEnabled}
          label="Create an account"
          icon="arrow-right"
          onPress={() => router.push('/auth/sign-up')}
        />
        <Button
          disabled={!isCloudEnabled}
          label="I already have an account"
          tone="secondary"
          onPress={() => router.push('/auth/sign-in')}
        />
        {status === 'demo' ? (
          <Button label="Continue local preview" tone="ghost" onPress={() => router.replace('/')} />
        ) : null}
      </View>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  promiseList: { gap: spacing.sm },
  promiseRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  promiseIcon: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  demoNotice: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  demoCopy: { flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  center: { textAlign: 'center' },
});
