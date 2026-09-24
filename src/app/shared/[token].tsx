import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState } from '@/components/ui/async-state';
import { Screen } from '@/components/ui/screen';
import { AskRelayPanel } from '@/features/relay/ask-relay-panel';
import { HandoffDocument } from '@/features/relay/handoff-document';
import { useSharedHandoff } from '@/features/relay/queries';
import { colors, radii, spacing } from '@/theme/tokens';

function Unavailable() {
  return (
    <Screen safeTop>
      <View style={styles.brand}>
        <View style={styles.brandMark}><MaterialCommunityIcons color={colors.moss} name="source-branch" size={20} /></View>
        <AppText variant="label" color={colors.moss}>RELAY</AppText>
      </View>
      <View style={styles.unavailable}>
        <View style={styles.unavailableIcon}><MaterialCommunityIcons color={colors.moss} name="link-variant-off" size={36} /></View>
        <AppText variant="heading" accessibilityRole="header">This handoff is unavailable</AppText>
        <AppText color={colors.inkMuted} style={styles.center}>
          The link may be incomplete or revoked. Ask the person who shared it for a current link.
        </AppText>
      </View>
    </Screen>
  );
}

export default function SharedHandoffScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const validToken = typeof token === 'string' && /^[0-9a-f]{64}$/.test(token);
  const handoffQuery = useSharedHandoff(validToken ? token : undefined);

  if (!validToken) return <Unavailable />;
  if (handoffQuery.isPending) return <Screen safeTop><LoadingState label="Opening the handoff…" /></Screen>;
  if (handoffQuery.error || !handoffQuery.data) return <Unavailable />;

  return (
    <Screen safeTop>
      <HandoffDocument
        organizationName={handoffQuery.data.organizationName}
        organizationInstitution={handoffQuery.data.organizationInstitution}
        roleTitle={handoffQuery.data.roleTitle}
        roleDescription={handoffQuery.data.roleDescription}
        servicePeriod={handoffQuery.data.servicePeriod}
        publishedAt={handoffQuery.data.publishedAt}
        items={handoffQuery.data.items}
      />
      <AskRelayPanel token={token} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  brandMark: { width: 38, height: 38, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mossSoft },
  unavailable: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl, padding: spacing.xl, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  unavailableIcon: { width: 64, height: 64, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mossSoft },
  center: { textAlign: 'center' },
});
