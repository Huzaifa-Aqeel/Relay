import '@/global.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import type { PropsWithChildren } from 'react';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { AuthProvider, useAuth } from '@/features/auth/auth-provider';
import { BillingProvider } from '@/features/billing/billing-provider';
import { useNotificationNavigation } from '@/features/notifications/notification-service';
import { isPublicRootSegment } from '@/features/relay/shell-model';
import { colors, spacing, type } from '@/theme/tokens';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
    mutations: { retry: 0 },
  },
});

function AuthGate({ children }: PropsWithChildren) {
  const { status, session } = useAuth();
  const priorUser = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (status === 'loading' || status === 'demo') return;
    const user = session?.user.id ?? null;
    if (priorUser.current === undefined) {
      priorUser.current = user;
      return;
    }
    if (user !== priorUser.current) {
      queryClient.clear();
      priorUser.current = user;
    }
  }, [session?.user.id, status]);
  const segments = useSegments();

  useEffect(() => {
    if (status === 'loading' || status === 'demo') return;
    const rootSegment = segments[0] as string | undefined;
    const authScreen = segments[1] as string | undefined;
    const isAuthRoute = rootSegment === 'auth';
    const isPublicRoute = isPublicRootSegment(rootSegment);

    if (status === 'anonymous' && !isAuthRoute && !isPublicRoute) {
      router.replace('/auth/welcome');
    }
    if (
      status === 'authenticated'
      && isAuthRoute
      && authScreen !== 'callback'
      && authScreen !== 'new-password'
    ) {
      router.replace('/');
    }
  }, [segments, status]);

  return (
    <View style={styles.root}>
      {children}
      {status === 'loading' ? (
        <View accessibilityLiveRegion="polite" style={styles.authLoading}>
          <View style={styles.loadingMark} />
          <AppText variant="label" color={colors.moss}>Opening Relay…</AppText>
        </View>
      ) : null}
    </View>
  );
}

export default function RootLayout() {
  useNotificationNavigation();

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BillingProvider>
            <AuthGate>
              <StatusBar style="dark" />
              <Stack
              screenOptions={{
                contentStyle: styles.content,
                headerStyle: styles.header,
                headerShadowVisible: false,
                headerTintColor: colors.ink,
                headerTitleStyle: styles.headerTitle,
                animation: 'slide_from_right',
              }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="organization/[id]" options={{ title: 'Organization' }} />
              <Stack.Screen name="organization-new" options={{ title: 'New organization' }} />
              <Stack.Screen name="role/[id]" options={{ title: 'Role' }} />
              <Stack.Screen name="role-new" options={{ title: 'New role' }} />
              <Stack.Screen name="handoff/[id]" options={{ title: 'Handoff' }} />
              <Stack.Screen name="handoff-new" options={{ title: 'New handoff' }} />
              <Stack.Screen name="handoff-review" options={{ title: 'Review' }} />
              <Stack.Screen name="handoff-preflight" options={{ title: 'Handoff check' }} />
              <Stack.Screen name="handoff-preview" options={{ title: 'Preview & share' }} />
              <Stack.Screen name="organization-memory" options={{ title: 'Organization Memory' }} />
              <Stack.Screen name="ownership-transfer" options={{ title: 'Organization ownership' }} />
              <Stack.Screen name="memory-reason" options={{ title: 'Confirm reason' }} />
              <Stack.Screen name="preflight-resolve" options={{ title: 'Resolve finding' }} />
              <Stack.Screen name="knowledge/[id]" options={{ title: 'Edit knowledge' }} />
              <Stack.Screen name="source/[id]" options={{ title: 'Source' }} />
              <Stack.Screen name="shared/[token]" options={{ headerShown: false }} />
              <Stack.Screen name="auth/welcome" options={{ headerShown: false }} />
              <Stack.Screen name="auth/sign-in" options={{ title: 'Sign in' }} />
              <Stack.Screen name="auth/sign-up" options={{ title: 'Create account' }} />
              <Stack.Screen name="auth/forgot-password" options={{ title: 'Reset password' }} />
              <Stack.Screen name="auth/new-password" options={{ title: 'New password' }} />
              <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
              <Stack.Screen name="drive-import" options={{ headerShown: false }} />
              <Stack.Screen name="legal/privacy" options={{ title: 'Privacy' }} />
              <Stack.Screen name="legal/terms" options={{ title: 'Terms' }} />
              <Stack.Screen
                name="paywall"
                options={{ title: 'Relay Pro', presentation: 'modal', animation: 'slide_from_bottom' }}
              />
              </Stack>
            </AuthGate>
          </BillingProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { backgroundColor: colors.canvas },
  header: { backgroundColor: colors.canvas },
  headerTitle: { fontFamily: type.display, fontWeight: '700' },
  authLoading: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    backgroundColor: colors.canvas,
  },
  loadingMark: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.mossSoft, borderWidth: 10, borderColor: colors.surface,
  },
});
