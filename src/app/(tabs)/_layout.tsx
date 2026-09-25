import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { StyleSheet } from 'react-native';

import { colors, radii, shadow, type } from '@/theme/tokens';
import { useRelayAccess } from '@/features/relay/queries';

type TabIconProps = {
  color: ColorValue;
  focused: boolean;
  name: ComponentProps<typeof MaterialCommunityIcons>['name'];
};

function TabIcon({ color, focused, name }: TabIconProps) {
  return <MaterialCommunityIcons color={color} name={name} size={focused ? 25 : 23} />;
}

export default function TabsLayout() {
  const access = useRelayAccess();
  const hasFullAccess = access.data?.hasFullAccess === true;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.moss,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: styles.label,
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item,
        tabBarHideOnKeyboard: true,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: hasFullAccess ? 'Organizations' : 'Organization',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="office-building-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="action"
        options={{
          href: hasFullAccess ? undefined : null,
          title: 'Handoff',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="source-branch" />
          ),
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          href: hasFullAccess ? undefined : null,
          title: 'Memory',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="book-open-page-variant-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: hasFullAccess ? undefined : null,
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="tune-variant" />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute', height: 78, paddingTop: 8, paddingBottom: 10,
    marginHorizontal: 14, marginBottom: 12, borderRadius: radii.lg,
    borderTopWidth: 0, backgroundColor: colors.surface, ...shadow,
  },
  item: { paddingTop: 4 },
  label: { fontFamily: type.body, fontSize: 11, fontWeight: '700' },
});
