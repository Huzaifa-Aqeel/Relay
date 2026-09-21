import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Database } from '@/types/database';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = (
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
)?.trim();

const SECURE_CHUNK_SIZE = 1800;

async function secureChunkCount(key: string) {
  const stored = await SecureStore.getItemAsync(`${key}.chunks`);
  const count = Number(stored);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

const nativeSecureStorage = {
  async getItem(key: string) {
    const count = await secureChunkCount(key);
    if (count === 0) return SecureStore.getItemAsync(key);
    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${key}.${index}`)),
    );
    return chunks.some((chunk) => chunk === null) ? null : chunks.join('');
  },
  async setItem(key: string, value: string) {
    const previousCount = await secureChunkCount(key);
    const chunks = value.match(new RegExp(`.{1,${SECURE_CHUNK_SIZE}}`, 'gs')) ?? [''];
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(`${key}.${index}`, chunk)));
    if (previousCount > chunks.length) {
      await Promise.all(
        Array.from(
          { length: previousCount - chunks.length },
          (_, index) => SecureStore.deleteItemAsync(`${key}.${chunks.length + index}`),
        ),
      );
    }
    await SecureStore.setItemAsync(`${key}.chunks`, String(chunks.length));
    await SecureStore.deleteItemAsync(key);
  },
  async removeItem(key: string) {
    const count = await secureChunkCount(key);
    await Promise.all([
      SecureStore.deleteItemAsync(key),
      SecureStore.deleteItemAsync(`${key}.chunks`),
      ...Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(`${key}.${index}`)),
    ]);
  },
};

const webStorage = {
  getItem(key: string) {
    return Promise.resolve(globalThis.localStorage?.getItem(key) ?? null);
  },
  setItem(key: string, value: string) {
    globalThis.localStorage?.setItem(key, value);
    return Promise.resolve();
  },
  removeItem(key: string) {
    globalThis.localStorage?.removeItem(key);
    return Promise.resolve();
  },
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl!, supabaseKey!, {
      auth: {
        storage: Platform.OS === 'web' ? webStorage : nativeSecureStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
        flowType: 'pkce',
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Cloud sign-in is not configured for this build yet.');
  }
  return supabase;
}
