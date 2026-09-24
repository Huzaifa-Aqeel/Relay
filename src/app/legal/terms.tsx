import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { InfoCard } from '@/components/ui/info-card';
import { Screen } from '@/components/ui/screen';
import { colors, spacing } from '@/theme/tokens';

export default function TermsScreen() {
  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="display">Terms of Use</AppText>
        <AppText color={colors.inkMuted}>Effective date: September 24, 2026</AppText>
      </View>

      <View style={styles.cards}>
        <InfoCard title="1. Acceptance of these terms">
          <AppText>Using Relay means you agree to these Terms and our Privacy Policy.</AppText>
        </InfoCard>
        <InfoCard title="2. Eligibility and accounts">
          <AppText>You are responsible for the accuracy of your account information and for activity performed through your account.</AppText>
        </InfoCard>
        <InfoCard title="3. Organizations and roles">
          <AppText>Organization owners and authorized role holders may create, manage, review, publish, and share organizational handoff content according to their permissions.</AppText>
        </InfoCard>
        <InfoCard title="4. Your content">
          <AppText>You retain ownership of content you submit to Relay. You grant Relay the limited rights necessary to store, process, organize, and display that content in order to provide the service.</AppText>
        </InfoCard>
        <InfoCard title="5. AI-assisted features">
          <AppText>Relay may use automated systems to transcribe, organize, retrieve, and summarize submitted material. Relay generates AI-assisted suggestions from your submitted source material and shows the supporting evidence. Review each suggestion for accuracy and context before adding it to a handoff.</AppText>
        </InfoCard>
        <InfoCard title="6. Acceptable use">
          <AppText>You may not use Relay unlawfully, interfere with the service, attempt unauthorized access, or upload content you do not have the right to use.</AppText>
        </InfoCard>
        <InfoCard title="7. Third-party services">
          <AppText>Some features may rely on third-party infrastructure or AI/document processing providers. Use of connected third-party services may also be subject to their terms.</AppText>
        </InfoCard>
        <InfoCard title="8. Published handoffs and sharing">
          <AppText>Users are responsible for reviewing information before publishing or sharing it and for ensuring they are authorized to share that information.</AppText>
        </InfoCard>
        <InfoCard title="9. Service availability and changes">
          <AppText>Relay may modify, suspend, or discontinue features and may update these Terms from time to time.</AppText>
        </InfoCard>
        <InfoCard title="10. Termination">
          <AppText>We may restrict or terminate access when these Terms are violated. Users may stop using Relay at any time.</AppText>
        </InfoCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  cards: { gap: spacing.md },
});
