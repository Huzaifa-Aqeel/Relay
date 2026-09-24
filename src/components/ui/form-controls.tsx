import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { colors, radii, spacing, type } from '@/theme/tokens';

type FormInputProps = TextInputProps & {
  label: string;
  helper?: string;
  error?: string;
  optional?: boolean;
};

export function FormInput({ label, helper, error, optional, style, ...props }: FormInputProps) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <AppText variant="label">{label}</AppText>
        {optional ? <AppText variant="caption" color={colors.inkMuted}>Optional</AppText> : null}
      </View>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.inkMuted}
        {...props}
        style={[styles.input, props.multiline && styles.multiline, error && styles.inputError, style]}
      />
      {error ? (
        <View style={styles.messageRow}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={16} />
          <AppText variant="caption" color={colors.emergency} style={styles.messageCopy}>{error}</AppText>
        </View>
      ) : helper ? (
        <AppText variant="caption" color={colors.inkMuted}>{helper}</AppText>
      ) : null}
    </View>
  );
}

type Choice = { label: string; value: string };

export function ChoiceGroup({
  label,
  value,
  choices,
  onChange,
  helper,
  selectionTone = 'solid',
}: {
  label: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
  helper?: string;
  selectionTone?: 'solid' | 'soft';
}) {
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {choices.map((choice) => {
          const selected = value === choice.value;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              key={choice.value}
              onPress={() => onChange(choice.value)}
              style={({ pressed }) => [
                styles.choice,
                selected && (selectionTone === 'soft' ? styles.choiceSelectedSoft : styles.choiceSelected),
                pressed && styles.pressed,
              ]}>
              <AppText
                variant="label"
                color={selected ? (selectionTone === 'soft' ? colors.moss : colors.white) : colors.ink}>
                {choice.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {helper ? <AppText variant="caption" color={colors.inkMuted}>{helper}</AppText> : null}
    </View>
  );
}

export function FormSection({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{eyebrow}</AppText>
        <AppText variant="heading">{title}</AppText>
        {description ? <AppText color={colors.inkMuted}>{description}</AppText> : null}
      </View>
      <View style={styles.sectionFields}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  input: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontFamily: type.body,
    fontSize: 16,
  },
  multiline: { minHeight: 104, textAlignVertical: 'top' },
  inputError: { borderColor: colors.emergency, backgroundColor: '#FFF9F7' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  messageCopy: { flex: 1 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choice: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  choiceSelected: { borderColor: colors.moss, backgroundColor: colors.moss },
  choiceSelectedSoft: { borderColor: colors.moss, backgroundColor: colors.mossSoft },
  pressed: { opacity: 0.78 },
  section: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  sectionHeading: { gap: spacing.xxs },
  eyebrow: { letterSpacing: 1.1, textTransform: 'uppercase' },
  sectionFields: { gap: spacing.lg },
});
