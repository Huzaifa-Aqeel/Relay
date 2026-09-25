import { createElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { youtubeEmbedUrl } from '@/features/relay/youtube-video';
import { colors, radii } from '@/theme/tokens';

export function YouTubeEmbed({ url, title }: { url: string; title: string }) {
  const source = youtubeEmbedUrl(url);
  if (!source) return null;
  return (
    <View style={styles.frame}>
      {createElement('iframe', {
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
        allowFullScreen: true,
        src: source,
        style: { width: '100%', height: '100%', border: 0 },
        title,
      })}
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
});
