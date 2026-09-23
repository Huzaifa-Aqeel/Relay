import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors, spacing } from '@/theme/tokens';

WebBrowser.maybeCompleteAuthSession();

export default function DriveImportReturnScreen() {
  return (
    <View style={styles.screen}>
      <AppText variant="heading">Returning to Relay…</AppText>
      <AppText color={colors.inkMuted} style={styles.center}>
        Your selected files are being added to the Capture.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  center: { textAlign: 'center' },
});
