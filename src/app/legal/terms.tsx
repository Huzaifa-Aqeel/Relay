import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { InfoCard } from '@/components/ui/info-card';
import { Screen } from '@/components/ui/screen';
import { colors, spacing } from '@/theme/tokens';

export default function TermsScreen() {
  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="display">Terms of use</AppText>
        <AppText color={colors.inkMuted}>
          Relay helps organizations preserve and transfer human-approved operational knowledge.
        </AppText>
      </View>

      <View style={styles.cards}>
        <InfoCard title="Human responsibility">
          <AppText>AI output remains proposed until an authorized person accepts it. Relay does not make organization or university decisions for you.</AppText>
        </InfoCard>
        <InfoCard title="No secrets">
          <AppText>Do not upload passwords, recovery codes, private keys, or authentication secrets. Relay is not a password manager.</AppText>
        </InfoCard>
        <InfoCard title="Shared handoffs">
          <AppText>Anyone with a valid published link may read the approved recipient content. Organizations are responsible for sharing and revoking links appropriately.</AppText>
        </InfoCard>
        <InfoCard title="Grounded answers">
          <AppText>Ask Relay is limited to authorized evidence. It must say when a reliable answer is not present and must not present generated policy interpretation as official advice.</AppText>
        </InfoCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  cards: { gap: spacing.md },
});

