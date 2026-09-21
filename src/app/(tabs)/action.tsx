import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { colors, radii, spacing } from '@/theme/tokens';

const flow = [
  ['numeric-1-circle-outline', 'Choose the organization and role'],
  ['numeric-2-circle-outline', 'Set the service period'],
  ['numeric-3-circle-outline', 'Begin a private draft'],
] as const;

export default function HandoffActionScreen() {
  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>CREATE A HANDOFF</AppText>
        <AppText variant="display">Pass on more than files</AppText>
        <AppText color={colors.inkMuted}>Start with clear ownership so every source and decision stays attached to the right role.</AppText>
      </View>

      <View style={styles.flowCard}>
        {flow.map(([icon, label]) => (
          <View key={label} style={styles.flowRow}>
            <View style={styles.flowIcon}><MaterialCommunityIcons color={colors.moss} name={icon} size={24} /></View>
            <AppText style={styles.flowCopy}>{label}</AppText>
          </View>
        ))}
      </View>

      <Button icon="arrow-right" label="Choose organization and role" onPress={() => router.push('/handoff-new' as Href)} />

      <View style={styles.guardrail}>
        <MaterialCommunityIcons color={colors.saffron} name="shield-check-outline" size={25} />
        <View style={styles.guardrailCopy}>
          <AppText variant="label">No orphan drafts</AppText>
          <AppText variant="caption" color={colors.inkMuted}>Relay requires an organization, role, and service period before it saves a handoff.</AppText>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  flowCard: { gap: spacing.md, marginBottom: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  flowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flowIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.md, backgroundColor: colors.mossSoft },
  flowCopy: { flex: 1 },
  guardrail: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.saffronSoft },
  guardrailCopy: { flex: 1, gap: spacing.xxs },
});
