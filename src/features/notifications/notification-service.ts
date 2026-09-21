import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { requireSupabase } from '@/lib/supabase';

const TOKEN_KEY = '@relay/current-expo-push-token';
const CHANNEL_ID = 'relay-updates';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerPushToken() {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Push notifications are available in the Android and iOS apps.');
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Relay updates',
      description: 'Important updates about handoffs and organization knowledge.',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
      vibrationPattern: [0, 180, 120, 180],
      lightColor: '#315E4B',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Notifications are off. Allow them in device settings, then try again.');
  }

  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    ?? Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Push notifications need the EAS project id before this build can register a device.');

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const client = requireSupabase();
  const claim = await client.rpc('claim_push_token', {
    requested_token: token,
    requested_platform: Platform.OS,
  });
  if (claim.error) throw new Error('This device could not be registered for notifications. Please try again.');
  await AsyncStorage.setItem(TOKEN_KEY, token);
  return token;
}

export async function unregisterPushToken(userId: string) {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  const client = requireSupabase();
  const result = await client.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
  if (result.error) throw new Error('This device could not be signed out of notifications. Please try again.');
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export function useNotificationNavigation() {
  useEffect(() => {
    function redirect(notification: Notifications.Notification) {
      const url = notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) {
        router.push(url as Href);
      }
    }

    const response = Notifications.getLastNotificationResponse();
    if (response?.notification) redirect(response.notification);
    const subscription = Notifications.addNotificationResponseReceivedListener((nextResponse) => {
      redirect(nextResponse.notification);
    });
    return () => subscription.remove();
  }, []);
}
