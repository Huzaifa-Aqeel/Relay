import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors, radii } from '@/theme/tokens';

export function OrganizationMark({
  name,
  logoUrl,
  size = 56,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  if (logoUrl) {
    return (
      <Image
        accessibilityLabel={`${name} logo`}
        contentFit="cover"
        source={{ uri: logoUrl }}
        style={{ width: size, height: size, borderRadius: Math.min(radii.md, size / 3) }}
      />
    );
  }

  return (
    <View
      accessibilityLabel={`${name} organization mark`}
      style={[styles.fallback, { width: size, height: size, borderRadius: Math.min(radii.md, size / 3) }]}>
      {initials ? (
        <AppText variant="label" color={colors.moss}>{initials}</AppText>
      ) : (
        <MaterialCommunityIcons color={colors.moss} name="account-group-outline" size={size * 0.48} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mossSoft },
});
