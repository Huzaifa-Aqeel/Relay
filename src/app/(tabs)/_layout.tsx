import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { colors, radii, shadow, type } from '@/theme/tokens';

type TabIconProps = {
  color: ColorValue;
  focused: boolean;
  name: ComponentProps<typeof MaterialCommunityIcons>['name'];
  action?: boolean;
};

function TabIcon({ color, focused, name, action }: TabIconProps) {
  if (action) {
    return (
      <View style={[styles.actionIcon, focused && styles.actionIconFocused]}>
        <MaterialCommunityIcons color={colors.white} name={name} size={28} />
      </View>
    );
  }
  return <MaterialCommunityIcons color={color} name={name} size={focused ? 25 : 23} />;
}

export default function TabsLayout() {
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
          title: 'Organizations',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="office-building-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="memory"
        options={{
          title: 'Memory',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="book-open-page-variant-outline" />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon color={color} focused={focused} name="tune-variant" />
          ),
        }}
      />
      <Tabs.Screen
        name="action"
        options={{
          title: 'Handoff',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon action color={color} focused={focused} name="plus" />
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
  actionIcon: {
    width: 48, height: 48, marginTop: -17, borderRadius: radii.pill,
    backgroundColor: colors.moss, alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: colors.canvas,
  },
  actionIconFocused: { backgroundColor: colors.black },
});

