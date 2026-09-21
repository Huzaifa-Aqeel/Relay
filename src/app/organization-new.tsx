import { zodResolver } from '@hookform/resolvers/zod';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Pressable, StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormInput, FormSection } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { useCreateOrganization } from '@/features/relay/queries';
import { RelayPlanLimitError } from '@/features/relay/repository';
import { colors, radii, spacing } from '@/theme/tokens';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter the organization name.').max(100, 'Keep the name under 100 characters.'),
  institution: z.string().trim().max(160, 'Keep the institution under 160 characters.'),
  description: z.string().trim().max(800, 'Keep the description under 800 characters.'),
});

type FormValues = z.infer<typeof schema>;
type Logo = { uri: string; mimeType?: string | null };

export default function CreateOrganizationScreen() {
  const mutation = useCreateOrganization();
  const [logo, setLogo] = useState<Logo | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const { control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', institution: '', description: '' },
  });

  async function chooseLogo() {
    setLogoError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setLogoError('Allow photo access to choose a logo, or continue without one.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
      setLogoError('Choose a logo smaller than 5 MB.');
      return;
    }
    setLogo({ uri: asset.uri, mimeType: asset.mimeType });
  }

  const submit = handleSubmit(async (values) => {
    try {
      const id = await mutation.mutateAsync({ ...values, logo: logo ?? undefined });
      router.replace((`/organization/${id}`) as Href);
    } catch (error) {
      if (error instanceof RelayPlanLimitError) router.push('/paywall?reason=organization');
    }
  });

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>NEW ORGANIZATION</AppText>
        <AppText variant="display">Give the knowledge a home</AppText>
        <AppText color={colors.inkMuted}>Roles and handoffs stay connected to this organization over time.</AppText>
      </View>

      <FormSection eyebrow="Identity" title="Organization details">
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <FormInput
              autoCapitalize="words"
              error={errors.name?.message}
              label="Organization name"
              placeholder="University Robotics Club"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="institution"
          render={({ field }) => (
            <FormInput
              autoCapitalize="words"
              error={errors.institution?.message}
              label="Institution"
              optional
              placeholder="Northbridge University"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="description"
          render={({ field }) => (
            <FormInput
              error={errors.description?.message}
              label="Short description"
              multiline
              optional
              placeholder="What the organization does and who it serves"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
            />
          )}
        />

        <View style={styles.logoField}>
          <View style={styles.logoHeading}>
            <AppText variant="label">Logo</AppText>
            <AppText variant="caption" color={colors.inkMuted}>Optional</AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={logo ? 'Change organization logo' : 'Choose organization logo'}
            onPress={() => void chooseLogo()}
            style={({ pressed }) => [styles.logoPicker, pressed && styles.pressed]}>
            {logo ? (
              <Image contentFit="cover" source={{ uri: logo.uri }} style={styles.logoPreview} />
            ) : (
              <View style={styles.logoPlaceholder}>
                <MaterialCommunityIcons color={colors.moss} name="image-plus-outline" size={28} />
              </View>
            )}
            <View style={styles.logoCopy}>
              <AppText variant="label">{logo ? 'Change logo' : 'Choose a logo'}</AppText>
              <AppText variant="caption" color={colors.inkMuted}>Square JPEG, PNG, or WebP · up to 5 MB</AppText>
            </View>
          </Pressable>
          {logo ? <Button label="Remove logo" tone="ghost" onPress={() => setLogo(null)} /> : null}
          {logoError ? <AppText variant="caption" color={colors.emergency}>{logoError}</AppText> : null}
        </View>
      </FormSection>

      {mutation.error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.errorCopy}>{mutation.error.message}</AppText>
        </View>
      ) : null}

      <Button
        disabled={mutation.isPending}
        icon="arrow-right"
        label={mutation.isPending ? 'Creating organization…' : 'Create organization'}
        onPress={() => void submit()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  logoField: { gap: spacing.xs },
  logoHeading: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  logoPicker: {
    minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.sm, borderWidth: 1, borderColor: colors.line,
    borderRadius: radii.md, backgroundColor: colors.canvas,
  },
  logoPlaceholder: {
    width: 58, height: 58, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  logoPreview: { width: 58, height: 58, borderRadius: radii.md },
  logoCopy: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.78 },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginVertical: spacing.md, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  errorCopy: { flex: 1 },
});
