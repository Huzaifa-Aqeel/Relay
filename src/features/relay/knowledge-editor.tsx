import { zodResolver } from '@hookform/resolvers/zod';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { ChoiceGroup, FormInput, FormSection } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { KNOWLEDGE_META } from '@/features/relay/knowledge-meta';
import { KNOWLEDGE_TYPES, type KnowledgeType } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

const schema = z.object({
  knowledgeType: z.enum(KNOWLEDGE_TYPES),
  title: z.string().trim().min(1, 'Give this item a clear title.').max(160, 'Keep the title under 160 characters.'),
  content: z.string().trim().min(1, 'Add the information your successor needs.').max(5000, 'Keep this item under 5,000 characters.'),
});

export type KnowledgeEditorValues = z.infer<typeof schema>;

export function KnowledgeEditor({
  eyebrow,
  title,
  description,
  defaultValues,
  error,
  isPending,
  submitLabel,
  onSubmit,
  onDelete,
  isDeleting,
}: {
  eyebrow: string;
  title: string;
  description: string;
  defaultValues: KnowledgeEditorValues;
  error?: string;
  isPending: boolean;
  submitLabel: string;
  onSubmit: (values: KnowledgeEditorValues) => Promise<void>;
  onDelete?: () => void;
  isDeleting?: boolean;
}) {
  const { control, handleSubmit, formState: { errors } } = useForm<KnowledgeEditorValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const submit = handleSubmit(onSubmit);

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{eyebrow}</AppText>
        <AppText variant="display">{title}</AppText>
        <AppText color={colors.inkMuted}>{description}</AppText>
      </View>

      <FormSection
        eyebrow="Approved knowledge"
        title="What should the next leader know?"
        description="Keep approved knowledge clear, accurate, and actionable.">
        <Controller
          control={control}
          name="knowledgeType"
          render={({ field }) => (
            <ChoiceGroup
              label="Knowledge type"
              value={field.value}
              choices={KNOWLEDGE_TYPES.map((value) => ({ value, label: KNOWLEDGE_META[value].label }))}
              onChange={(value) => field.onChange(value as KnowledgeType)}
            />
          )}
        />
        <Controller
          control={control}
          name="title"
          render={({ field }) => (
            <FormInput
              error={errors.title?.message}
              label="Title"
              maxLength={160}
              placeholder="Book the RoboFest venue"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
            />
          )}
        />
        <Controller
          control={control}
          name="content"
          render={({ field }) => (
            <FormInput
              error={errors.content?.message}
              helper="Be specific enough that someone new can act without guessing."
              label="Details"
              maxLength={5000}
              multiline
              placeholder="Submit the venue request at least 12 weeks before the event…"
              value={field.value}
              onBlur={field.onBlur}
              onChangeText={field.onChange}
            />
          )}
        />
      </FormSection>

      <View style={styles.safetyNote}>
        <MaterialCommunityIcons color={colors.saffron} name="shield-key-outline" size={24} />
        <AppText variant="caption" color={colors.inkMuted} style={styles.safetyCopy}>
          Do not store passwords, recovery codes, private keys, or other login secrets in Relay.
        </AppText>
      </View>

      {error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.errorCopy}>{error}</AppText>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          disabled={isPending || isDeleting}
          icon="check"
          label={isPending ? 'Saving…' : submitLabel}
          onPress={() => void submit()}
        />
        {onDelete ? (
          <Button
            disabled={isPending || isDeleting}
            icon="trash-can-outline"
            label={isDeleting ? 'Deleting…' : 'Delete item'}
            tone="ghost"
            onPress={onDelete}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2, textTransform: 'uppercase' },
  safetyNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    marginTop: spacing.lg, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: colors.saffronSoft,
  },
  safetyCopy: { flex: 1 },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginTop: spacing.md, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  errorCopy: { flex: 1 },
  actions: { gap: spacing.xs, marginTop: spacing.lg },
});
