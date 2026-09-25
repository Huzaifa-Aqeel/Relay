import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { youtubeEmbedUrl } from '@/features/relay/youtube-video';
import { colors, radii } from '@/theme/tokens';

export function YouTubeEmbed({ url, title }: { url: string; title: string }) {
  const source = youtubeEmbedUrl(url);
  if (!source) return null;
  return (
    <View style={styles.frame}>
      <WebView
        accessibilityLabel={title}
        allowsFullscreenVideo
        javaScriptEnabled
        source={{ uri: source }}
        style={styles.webview}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    aspectRatio: 16 / 9,
    overflow: 'hidden',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.black,
  },
  webview: { flex: 1, backgroundColor: colors.black },
});
