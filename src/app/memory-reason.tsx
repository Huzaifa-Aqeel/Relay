import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { ChoiceGroup, FormInput, FormSection } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import {
  useConfirmMemoryChangeReason,
  useRoleLessons,
  useRoleMemoryChanges,
} from '@/features/relay/queries';
import { broadKnowledgeType } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

type ConfirmableReason = 'lesson_driven' | 'leadership_preference' | 'contact_resource' | 'unknown';

export default function MemoryReasonScreen() {
  const { changeId, comparisonId, roleId } = useLocalSearchParams<{
    changeId: string; comparisonId: string; roleId: string;
  }>();
  const changesQuery = useRoleMemoryChanges(comparisonId);
  const lessonsQuery = useRoleLessons(roleId);
  const mutation = useConfirmMemoryChangeReason();
  const [reason, setReason] = useState<ConfirmableReason>('leadership_preference');
  const [explanation, setExplanation] = useState('');
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  if (changesQuery.isPending || lessonsQuery.isPending) return <Screen><LoadingState label="Opening reason confirmation…" /></Screen>;
  const change = changesQuery.data?.find((candidate) => candidate.id === changeId);
  if (changesQuery.error || lessonsQuery.error || !change) {
    return <Screen><MessageState icon="source-branch-remove" title="Change unavailable" body={(changesQuery.error ?? lessonsQuery.error)?.message ?? 'This comparison change is unavailable.'} /></Screen>;
  }
  const broadTypes = [change.beforeSnapshot?.knowledgeType, change.afterSnapshot?.knowledgeType]
    .filter((type): type is NonNullable<typeof type> => Boolean(type))
    .map(broadKnowledgeType);
  const supportsContact = broadTypes.some((type) => type === 'contact' || type === 'access_resource');
  const supportsLesson = Boolean(change.afterSnapshot)
    && ['process', 'warning_lesson'].includes(broadKnowledgeType(change.afterSnapshot!.knowledgeType))
    && Boolean(lessonsQuery.data?.length);
  const choices = [
    ...(supportsLesson ? [{ label: 'Lesson-driven', value: 'lesson_driven' }] : []),
    { label: 'Leadership preference', value: 'leadership_preference' },
    ...(supportsContact ? [{ label: 'Contact/resource', value: 'contact_resource' }] : []),
    { label: 'Not established', value: 'unknown' },
  ];

  async function submit() {
    setLocalError(null);
    if (!explanation.trim()) return setLocalError('Explain what you are confirming in plain language.');
    if (reason === 'lesson_driven' && !lessonId) return setLocalError('Choose the approved lesson that led to this practice.');
    await mutation.mutateAsync({
      changeId,
      comparisonId,
      reasonCategory: reason,
      explanation,
      lessonKnowledgeItemId: reason === 'lesson_driven' ? lessonId : null,
    });
    router.replace((`/organization-memory?roleId=${roleId}`) as Href);
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>HUMAN CONFIRMATION</AppText>
        <AppText variant="display">Why did this change?</AppText>
        <AppText color={colors.inkMuted}>Confirm only a relationship you actually know. Relay records your statement as attributable metadata; it does not rewrite either published handoff.</AppText>
      </View>

      <View style={styles.changeCard}>
        <AppText variant="caption" color={colors.moss}>{change.changeType.toUpperCase()}</AppText>
        <AppText variant="heading">{change.title}</AppText>
        <AppText color={colors.inkMuted}>{change.summary}</AppText>
      </View>

      <FormSection eyebrow="Grounded reason" title="Confirm the relationship">
        <ChoiceGroup
          label="Reason category"
          value={reason}
          choices={choices}
          onChange={(value) => {
            setReason(value as ConfirmableReason);
            if (value !== 'lesson_driven') setLessonId(null);
          }}
          helper="Policy-driven is intentionally unavailable here: it must come from approved policy evidence in the comparison."
        />
        {reason === 'lesson_driven' ? (
          <View style={styles.lessons}>
            <AppText variant="label">Approved lesson that led to this practice</AppText>
            {lessonsQuery.data?.map((lesson) => {
              const selected = lesson.id === lessonId;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={lesson.id}
                  onPress={() => setLessonId(lesson.id)}
                  style={({ pressed }) => [styles.lesson, selected && styles.lessonSelected, pressed && styles.pressed]}>
                  <MaterialCommunityIcons color={selected ? colors.white : colors.moss} name="lightbulb-on-outline" size={20} />
                  <View style={styles.copy}>
                    <AppText variant="label" color={selected ? colors.white : colors.ink}>{lesson.title}</AppText>
                    <AppText variant="caption" color={selected ? colors.white : colors.inkMuted}>{lesson.content}</AppText>
                  </View>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <FormInput
          label="Confirmation"
          maxLength={1000}
          multiline
          placeholder={reason === 'lesson_driven'
            ? 'This practice was introduced because…'
            : 'State how you know this reason applies…'}
          value={explanation}
          onChangeText={setExplanation}
        />
      </FormSection>

      {localError || mutation.error ? <AppText variant="caption" color={colors.emergency}>{localError ?? mutation.error?.message}</AppText> : null}
      <Button disabled={mutation.isPending} icon="check-decagram-outline" label={mutation.isPending ? 'Confirming…' : 'Confirm reason'} onPress={() => void submit()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.1 },
  changeCard: { gap: spacing.xs, marginBottom: spacing.lg, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  lessons: { gap: spacing.xs },
  lesson: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radii.md, backgroundColor: colors.surface },
  lessonSelected: { borderColor: colors.moss, backgroundColor: colors.moss },
  copy: { flex: 1, gap: spacing.xxs },
  pressed: { opacity: 0.72 },
});
