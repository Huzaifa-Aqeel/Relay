import { Platform } from 'react-native';

function webOrigin() {
  if (Platform.OS !== 'web') return null;
  const origin = globalThis.location?.origin;
  return origin && origin !== 'null' ? origin : null;
}

export function sharedHandoffUrl(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const configured = process.env.EXPO_PUBLIC_RELAY_WEB_ORIGIN?.trim().replace(/\/$/, '');
  const origin = configured || webOrigin();
  return origin ? `${origin}/shared/${token}` : null;
}
