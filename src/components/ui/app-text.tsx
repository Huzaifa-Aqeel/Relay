import type { TextProps } from 'react-native';
import { StyleSheet, Text } from 'react-native';

import { colors, type } from '@/theme/tokens';

type AppTextProps = TextProps & {
  variant?: 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';
  color?: string;
};

export function AppText({
  variant = 'body',
  color = colors.ink,
  style,
  ...props
}: AppTextProps) {
  return <Text {...props} style={[styles.base, styles[variant], { color }, style]} />;
}

const styles = StyleSheet.create({
  base: {
    fontFamily: type.body,
  },
  display: {
    fontFamily: type.display,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '700',
    letterSpacing: -1.2,
  },
  title: {
    fontFamily: type.display,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  heading: {
    fontFamily: type.display,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0.15,
  },
  caption: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    letterSpacing: 0.25,
  },
});
