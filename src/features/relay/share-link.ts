const DEFAULT_RELAY_WEB_ORIGIN = 'https://relay-handoff.expo.app';

function webOrigin() {
  const origin = globalThis.location?.origin;
  return origin && origin !== 'null' ? origin : null;
}

export function sharedHandoffUrl(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const configured = process.env.EXPO_PUBLIC_RELAY_WEB_ORIGIN?.trim().replace(/\/$/, '');
  const origin = configured || webOrigin();
  return origin ? `${origin}/shared/${token}` : null;
}

export function assignmentInviteUrl(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const configured = process.env.EXPO_PUBLIC_RELAY_WEB_ORIGIN?.trim().replace(/\/$/, '');
  const origin = configured || webOrigin() || DEFAULT_RELAY_WEB_ORIGIN;
  return `${origin}/assignment/${token}`;
}
