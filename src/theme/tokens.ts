import { Platform } from 'react-native';

export const colors = {
  canvas: '#F6F1E9',
  surface: '#FFFDFC',
  surfaceMuted: '#ECE5DB',
  ink: '#24221F',
  inkMuted: '#706B64',
  line: '#DED5C9',
  moss: '#315E4B',
  mossSoft: '#DCE9E0',
  saffron: '#E6A346',
  saffronSoft: '#F7E5C7',
  emergency: '#9B342A',
  emergencyDark: '#62231E',
  white: '#FFFFFF',
  black: '#161411',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

export const type = {
  display: Platform.select({ ios: 'Georgia', android: 'serif', web: 'Georgia' }),
  body: Platform.select({ ios: 'System', android: 'sans-serif', web: 'system-ui' }),
} as const;

export const shadow = {
  shadowColor: '#2E271E',
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.08,
  shadowRadius: 18,
  elevation: 3,
} as const;
