import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { useAskRelay } from '@/features/relay/queries';
import { colors, radii, spacing } from '@/theme/tokens';

export function AskRelayPanel({ token }: { token: string }) {
  const [question, setQuestion] = useState('');
  const [lastQuestion, setLastQuestion] = useState('');
  const mutation = useAskRelay();

  async function ask() {
    const trimmed = question.trim();
    if (!trimmed || mutation.isPending) return;
    try {
      await mutation.mutateAsync({ token, question: trimmed });
      setLastQuestion(trimmed);
    } catch {
      // The mutation exposes the safe, recipient-facing error below.
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View style={styles.icon}>
          <MaterialCommunityIcons color={colors.moss} name="message-question-outline" size={24} />
        </View>
        <View style={styles.headingCopy}>
          <AppText variant="heading" accessibilityRole="header">Ask this handoff</AppText>
          <AppText color={colors.inkMuted}>
            Get a concise answer using only the information the owner published here.
          </AppText>
        </View>
      </View>

      <FormInput
        label="Your question"
        maxLength={500}
        multiline
        onChangeText={(value) => {
          setQuestion(value);
          if (mutation.error) mutation.reset();
        }}
        onSubmitEditing={() => void ask()}
        placeholder="What should I do before the event begins?"
        returnKeyType="send"
        value={question}
      />
      <Button
        disabled={!question.trim() || mutation.isPending}
        icon="arrow-right"
        label={mutation.isPending ? 'Checking the handoff…' : 'Ask Relay'}
        onPress={() => void ask()}
      />

      {mutation.error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={19} />
          <AppText variant="caption" color={colors.emergency} style={styles.flex}>
            {mutation.error.message}
          </AppText>
        </View>
      ) : null}

      {mutation.data ? (
        <View accessibilityLiveRegion="polite" style={styles.answerCard}>
          <AppText variant="caption" color={colors.inkMuted}>YOU ASKED</AppText>
          <AppText variant="label">{lastQuestion}</AppText>
          <View style={styles.rule} />
          <View style={styles.answerHeading}>
            <MaterialCommunityIcons
              color={mutation.data.status === 'answered' ? colors.moss : colors.saffron}
              name={mutation.data.status === 'answered' ? 'check-decagram-outline' : mutation.data.status === 'conflict' ? 'alert-outline' : 'information-outline'}
              size={21}
            />
            <AppText variant="label">
              {mutation.data.status === 'answered'
                ? 'Answer from this handoff'
                : mutation.data.status === 'conflict' ? 'Conflicting information' : 'Not in this handoff'}
            </AppText>
          </View>
          <AppText>{mutation.data.answer}</AppText>

          {mutation.data.citations.length ? (
            <View style={styles.citations}>
              <AppText variant="caption" color={colors.inkMuted}>SOURCES</AppText>
              {mutation.data.citations.map((citation) => (
                <View key={citation.ref} style={styles.citation}>
                  <View style={styles.ref}><AppText variant="caption" color={colors.moss}>{citation.ref}</AppText></View>
                  <View style={styles.flex}>
                    <AppText variant="label">{citation.title}</AppText>
                    {citation.sources.map((source, index) => (
                      <AppText key={`${source.label}-${index}`} variant="caption" color={colors.inkMuted}>
                        {source.label}{source.locator ? ` · ${source.locator}` : ''}
                      </AppText>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
          <AppText variant="caption" color={colors.inkMuted}>
            {mutation.data.remaining} Ask {mutation.data.remaining === 1 ? 'request' : 'requests'} remaining today for this link.
          </AppText>
        </View>
      ) : null}

      <View style={styles.trustNote}>
        <MaterialCommunityIcons color={colors.inkMuted} name="shield-check-outline" size={17} />
        <AppText variant="caption" color={colors.inkMuted} style={styles.flex}>
          Asking never edits this handoff. If the published information is insufficient or conflicting, Relay says so.
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  headingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  headingCopy: { flex: 1, gap: spacing.xxs },
  icon: {
    width: 44, height: 44, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  answerCard: {
    gap: spacing.sm, padding: spacing.md,
    borderRadius: radii.md, backgroundColor: colors.canvas,
    borderWidth: 1, borderColor: colors.line,
  },
  answerHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  citations: { gap: spacing.sm, marginTop: spacing.xs },
  citation: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  ref: {
    minWidth: 34, minHeight: 28, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: spacing.xs, borderRadius: radii.pill, backgroundColor: colors.mossSoft,
  },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  trustNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  flex: { flex: 1 },
});
