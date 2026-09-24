import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { InfoCard } from '@/components/ui/info-card';
import { Screen } from '@/components/ui/screen';
import { colors, spacing } from '@/theme/tokens';

export default function PrivacyScreen() {
  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="display">Privacy</AppText>
        <AppText color={colors.inkMuted}>
          Relay separates private source material from approved knowledge shared with a successor.
        </AppText>
      </View>

      <View style={styles.cards}>
        <InfoCard title="Draft content">
          <AppText>Draft handoffs, voice transcripts, uploads, and unapproved proposals remain private to authorized organization members. Relay does not retain voice audio after transcription.</AppText>
        </InfoCard>
        <InfoCard title="Published access">
          <AppText>A recipient receives only the approved content included in a valid published handoff. A shared token must not expose unrelated organization data.</AppText>
        </InfoCard>
        <InfoCard title="AI and document processors">
          <AppText>Relay will disclose the providers used for document processing, transcription, retrieval, and reasoning before those services are enabled in production.</AppText>
        </InfoCard>
        <InfoCard title="Your controls">
          <AppText>Authorized users can revoke published links and remove managed sources. Provider secrets are never placed in the mobile or web client.</AppText>
        </InfoCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  cards: { gap: spacing.md },
});
