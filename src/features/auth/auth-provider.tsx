import type { Session } from '@supabase/supabase-js';
import { makeRedirectUri } from 'expo-auth-session';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';

import { isSupabaseConfigured, requireSupabase, supabase } from '@/lib/supabase';
import { unregisterPushToken } from '@/features/notifications/notification-service';

WebBrowser.maybeCompleteAuthSession();

type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'demo';

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  isCloudEnabled: boolean;
  isPasswordRecovery: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (displayName: string, email: string, password: string, returnTo?: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  exchangeCode: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const authCodeExchanges = new Map<string, Promise<void>>();

function authMessage(message: string) {
  const normalised = message.toLowerCase();
  if (normalised.includes('invalid login credentials')) return 'That email and password do not match.';
  if (normalised.includes('email not confirmed')) return 'Confirm your email before signing in.';
  if (normalised.includes('already registered')) return 'An account already exists for this email.';
  if (normalised.includes('password') && normalised.includes('characters')) return 'Use at least 8 characters for your password.';
  if (normalised.includes('rate limit')) return 'Too many attempts. Wait a moment, then try again.';
  if (normalised.includes('network') || normalised.includes('fetch')) return 'Check your connection and try again.';
  return 'We couldn’t complete that request. Please try again.';
}

function throwFriendly(error: { message: string } | null) {
  if (error) throw new Error(authMessage(error.message));
}

function exchangeAuthCodeOnce(code: string) {
  const existing = authCodeExchanges.get(code);
  if (existing) return existing;

  const exchange = requireSupabase().auth.exchangeCodeForSession(code).then(({ error }) => {
    throwFriendly(error);
  });
  authCodeExchanges.set(code, exchange);
  void exchange.then(
    () => setTimeout(() => authCodeExchanges.delete(code), 60_000),
    () => authCodeExchanges.delete(code),
  );
  return exchange;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? 'loading' : 'demo');
  const [session, setSession] = useState<Session | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        setSession(null);
        setStatus('anonymous');
        return;
      }
      setSession(data.session);
      setStatus(data.session ? 'authenticated' : 'anonymous');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      setStatus(nextSession ? 'authenticated' : 'anonymous');
      setIsPasswordRecovery(event === 'PASSWORD_RECOVERY');
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || Platform.OS === 'web') return;
    const client = supabase;
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
    return () => listener.remove();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const client = requireSupabase();
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    throwFriendly(error);
  }, []);

  const signUp = useCallback(async (displayName: string, email: string, password: string, returnTo?: string) => {
    const client = requireSupabase();
    const safeReturnTo = returnTo && /^\/assignment\/[0-9a-f]{64}$/.test(returnTo) ? returnTo : null;
    const redirectTo = makeRedirectUri({
      scheme: 'relay',
      path: 'auth/callback',
      queryParams: safeReturnTo ? { returnTo: safeReturnTo } : undefined,
    });
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: redirectTo, data: { display_name: displayName.trim() } },
    });
    throwFriendly(error);
    return { needsEmailConfirmation: !data.session };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const client = requireSupabase();
    const redirectTo = makeRedirectUri({ scheme: 'relay', path: 'auth/callback' });
    const isWeb = Platform.OS === 'web';
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // A full-page web redirect gives the callback screen sole ownership
        // of the one-use PKCE code. Native keeps the secure browser session
        // and completes the exchange in this process.
        skipBrowserRedirect: !isWeb,
        queryParams: { prompt: 'select_account' },
      },
    });
    throwFriendly(error);
    if (isWeb) return;
    if (!data.url) throw new Error('Google sign-in could not be opened. Please try again.');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success') return;
    const parsed = Linking.parse(result.url);
    const code = typeof parsed.queryParams?.code === 'string' ? parsed.queryParams.code : null;
    if (!code) throw new Error('Google sign-in did not return a valid session. Please try again.');
    await exchangeAuthCodeOnce(code);
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    const client = requireSupabase();
    const redirectTo = makeRedirectUri({ scheme: 'relay', path: 'auth/callback', queryParams: { type: 'recovery' } });
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    throwFriendly(error);
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const client = requireSupabase();
    const { error } = await client.auth.updateUser({ password });
    throwFriendly(error);
    setIsPasswordRecovery(false);
  }, []);

  const exchangeCode = useCallback(async (code: string) => {
    await exchangeAuthCodeOnce(code);
  }, []);

  const userId = session?.user.id;
  const signOut = useCallback(async () => {
    const client = requireSupabase();
    if (userId) await unregisterPushToken(userId);
    const { error } = await client.auth.signOut();
    throwFriendly(error);
  }, [userId]);

  const deleteAccount = useCallback(async () => {
    const client = requireSupabase();
    if (userId) await unregisterPushToken(userId);
    const { error } = await client.functions.invoke('delete-account', { body: {} });
    throwFriendly(error);
    await client.auth.signOut({ scope: 'local' });
  }, [userId]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    session,
    isCloudEnabled: isSupabaseConfigured,
    isPasswordRecovery,
    signIn,
    signUp,
    signInWithGoogle,
    sendPasswordReset,
    updatePassword,
    exchangeCode,
    signOut,
    deleteAccount,
  }), [
    status,
    session,
    isPasswordRecovery,
    signIn,
    signUp,
    signInWithGoogle,
    sendPasswordReset,
    updatePassword,
    exchangeCode,
    signOut,
    deleteAccount,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
