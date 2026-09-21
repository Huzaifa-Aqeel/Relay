import { zodResolver } from '@hookform/resolvers/zod';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput, FormSection } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { useCreateTypedSource, useHandoff, useRole } from '@/features/relay/queries';
import { colors, radii, spacing } from '@/theme/tokens';

const schema = z.object({
  title: z.string().trim().min(1, 'Give these notes a title.').max(160, 'Keep the title under 160 characters.'),
  textContent: z.string().trim().min(1, 'Type or paste some knowledge first.').max(50000, 'Keep this source under 50,000 characters.'),
});

type FormValues = z.infer<typeof schema>;

export default function CaptureTextScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const mutation = useCreateTypedSource();
  const { control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: 'Working notes', textContent: '' },
  });

  if (!handoffId) {
    return <Screen><MessageState icon="alert-circle-outline" title="Choose a handoff first" body="Typed notes must belong to a handoff." /></Screen>;
  }
  if (handoffQuery.isPending || (handoffQuery.data && roleQuery.isPending)) {
    return <Screen><LoadingState label="Opening capture…" /></Screen>;
  }
  if (handoffQuery.error || roleQuery.error || !handoffQuery.data || !roleQuery.data) {
    return (
      <Screen>
        <MessageState
          icon="file-document-alert-outline"
          title="Handoff unavailable"
          body={(handoffQuery.error ?? roleQuery.error)?.message ?? 'This handoff could not be opened.'}
        />
      </Screen>
    );
  }

  const handoff = handoffQuery.data;
  const submit = handleSubmit(async (values) => {
    await mutation.mutateAsync({
      organizationId: handoff.organizationId,
      handoffId,
      ...values,
    });
    router.replace((`/handoff/${handoffId}`) as Href);
  });

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{roleQuery.data.title.toUpperCase()}</AppText>
        <AppText variant="display">Capture what you know</AppText>
        <AppText color={colors.inkMuted}>Write naturally or paste existing notes. Relay keeps the original wording as source evidence.</AppText>
      </View>

      <FormSection
        eyebrow="Typed source"
        title="No template required"
        description="Responsibilities, people, dates, processes, mistakes, and lessons can all go together here.">
        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <FormInput
              error={errors.title?.message}
              label="Source title"
              maxLength={160}
              placeholder="RoboFest planning notes"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="textContent"
          render={({ field }) => (
            <FormInput
              error={errors.textContent?.message}
              label="Notes"
              maxLength={50000}
              multiline
              placeholder="RoboFest happens in March. Sarah in Facilities handles the hall…"
              style={styles.notes}
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
            />
          )}
        />
      </FormSection>

      <View style={styles.safetyNote}>
        <MaterialCommunityIcons color={colors.saffron} name="shield-key-outline" size={24} />
        <View style={styles.safetyCopy}>
          <AppText variant="label">Keep credentials elsewhere</AppText>
          <AppText variant="caption" color={colors.inkMuted}>Do not include passwords, recovery codes, private keys, or account secrets.</AppText>
        </View>
      </View>

      {mutation.error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.errorCopy}>{mutation.error.message}</AppText>
        </View>
      ) : null}

      <Button
        disabled={mutation.isPending}
        icon="content-save-outline"
        label={mutation.isPending ? 'Saving source…' : 'Save source'}
        onPress={() => void submit()}
      />
      <AppText variant="caption" color={colors.inkMuted} style={styles.center}>Saving a source does not publish it or treat it as approved knowledge.</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  notes: { minHeight: 240 },
  safetyNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginVertical: spacing.lg, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: colors.saffronSoft,
  },
  safetyCopy: { flex: 1, gap: spacing.xxs },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginBottom: spacing.md, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  errorCopy: { flex: 1 },
  center: { marginTop: spacing.xs, textAlign: 'center' },
});
