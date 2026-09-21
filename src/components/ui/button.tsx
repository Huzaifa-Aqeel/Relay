import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import type { PressableProps } from 'react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors, radii, spacing } from '@/theme/tokens';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type ButtonProps = PressableProps & {
  label: string;
  icon?: IconName;
  tone?: 'primary' | 'secondary' | 'emergency' | 'ghost';
};

export function Button({ label, icon, tone = 'primary', style, ...props }: ButtonProps) {
  const foreground = tone === 'secondary' || tone === 'ghost' ? colors.ink : colors.white;

  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      style={(state) => [
        styles.base,
        styles[tone],
        props.disabled && styles.disabled,
        state.pressed && styles.pressed,
        typeof style === 'function' ? style(state) : style,
      ]}>
      <View style={styles.content}>
        {icon ? <MaterialCommunityIcons color={foreground} name={icon} size={21} /> : null}
        <AppText variant="label" color={foreground}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  primary: {
    backgroundColor: colors.moss,
    borderColor: colors.moss,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
  },
  emergency: {
    backgroundColor: colors.emergency,
    borderColor: colors.emergency,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.985 }],
  },
  disabled: {
    opacity: 0.45,
  },
});
