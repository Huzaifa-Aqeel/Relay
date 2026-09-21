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
import { useCreateRole, useOrganization } from '@/features/relay/queries';
import { RelayPlanLimitError } from '@/features/relay/repository';
import { colors, radii, spacing } from '@/theme/tokens';

const schema = z.object({
  title: z.string().trim().min(1, 'Enter the role title.').max(100, 'Keep the title under 100 characters.'),
  description: z.string().trim().max(800, 'Keep the description under 800 characters.'),
});

type FormValues = z.infer<typeof schema>;

export default function CreateRoleScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const organizationQuery = useOrganization(organizationId);
  const mutation = useCreateRole();
  const { control, handleSubmit, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema), defaultValues: { title: '', description: '' },
  });

  if (!organizationId) {
    return <Screen><MessageState icon="alert-circle-outline" title="Choose an organization first" body="A role must belong to an organization." /></Screen>;
  }
  if (organizationQuery.isPending) return <Screen><LoadingState label="Opening organization…" /></Screen>;
  if (organizationQuery.error || !organizationQuery.data) {
    return (
      <Screen>
        <MessageState
          icon="office-building-remove-outline"
          title="Organization unavailable"
          body={organizationQuery.error?.message ?? 'This organization could not be opened.'}
          actionLabel="Try again"
          onAction={() => void organizationQuery.refetch()}
        />
      </Screen>
    );
  }

  const organization = organizationQuery.data;
  const submit = handleSubmit(async (values) => {
    try {
      const id = await mutation.mutateAsync({ organizationId, ...values });
      router.replace((`/role/${id}`) as Href);
    } catch (error) {
      if (error instanceof RelayPlanLimitError) {
        router.push((`/paywall?reason=role&organizationId=${organizationId}`) as Href);
      }
    }
  });

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{organization.name.toUpperCase()}</AppText>
        <AppText variant="display">Add a role</AppText>
        <AppText color={colors.inkMuted}>Each role keeps a separate, continuous handoff history.</AppText>
      </View>

      <FormSection eyebrow="Role" title="What responsibility is being passed on?">
        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <FormInput
              autoCapitalize="words"
              error={errors.title?.message}
              label="Role title"
              placeholder="President"
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
              label="Description"
              multiline
              optional
              placeholder="The scope of this role and what it is responsible for"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
            />
          )}
        />
      </FormSection>

      {mutation.error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.errorCopy}>{mutation.error.message}</AppText>
        </View>
      ) : <View style={styles.spacer} />}

      <Button disabled={mutation.isPending} label={mutation.isPending ? 'Adding role…' : 'Add role'} onPress={() => void submit()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginTop: spacing.md, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  errorCopy: { flex: 1 },
  spacer: { height: spacing.lg },
});
