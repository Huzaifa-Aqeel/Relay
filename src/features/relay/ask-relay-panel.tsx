import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { useAskRelay } from '@/features/relay/queries';
import type { AskRelayAnswer } from '@/features/relay/types';
import { colors, radii, shadow, spacing, type } from '@/theme/tokens';

export type AskRelayTarget = {
  handoffId: string;
  organizationName: string;
  roleTitle: string;
  servicePeriod: string;
};

type ConversationMessage =
  | { id: number; sender: 'user'; text: string }
  | { id: number; sender: 'relay'; answer: AskRelayAnswer };

export function AskRelayChatbot({ targets }: { targets: AskRelayTarget[] }) {
  const [visible, setVisible] = useState(false);
  const [selectedHandoffId, setSelectedHandoffId] = useState(targets[0]?.handoffId ?? '');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const nextMessageId = useRef(1);
  const messageList = useRef<ScrollView>(null);
  const mutation = useAskRelay();

  const target = targets.find((candidate) => candidate.handoffId === selectedHandoffId) ?? targets[0];

  function chooseTarget(handoffId: string) {
    if (handoffId === selectedHandoffId || mutation.isPending) return;
    setSelectedHandoffId(handoffId);
    setQuestion('');
    setMessages([]);
    mutation.reset();
  }

  async function ask() {
    const trimmed = question.trim();
    if (!target || !trimmed || mutation.isPending) return;
    setMessages((current) => [...current, {
      id: nextMessageId.current++,
      sender: 'user',
      text: trimmed,
    }]);
    setQuestion('');
    mutation.reset();
    try {
      const answer = await mutation.mutateAsync({ handoffId: target.handoffId, question: trimmed });
      setMessages((current) => [...current, {
        id: nextMessageId.current++,
        sender: 'relay',
        answer,
      }]);
    } catch {
      // The mutation exposes the safe user-facing error beside the composer.
    }
  }

  if (!target) return null;

  return (
    <>
      <Pressable
        accessibilityLabel="Open Ask Relay"
        accessibilityRole="button"
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.launcher, pressed && styles.pressed]}>
        <MaterialCommunityIcons color={colors.white} name="message-processing-outline" size={30} />
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setVisible(false)}
        statusBarTranslucent
        transparent
        visible={visible}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalRoot}>
          <View style={styles.backdrop}>
            <Pressable
              accessibilityLabel="Close Ask Relay"
              accessibilityRole="button"
              onPress={() => setVisible(false)}
              style={styles.backdropDismiss}
            />
            <View accessibilityViewIsModal style={styles.chatCard}>
              <View style={styles.chatHeader}>
                <View style={styles.botMark}>
                  <MaterialCommunityIcons color={colors.white} name="message-processing-outline" size={24} />
                </View>
                <View style={styles.headerCopy}>
                  <AppText variant="heading" color={colors.white}>Ask Relay</AppText>
                  <AppText variant="caption" color={colors.mossSoft} numberOfLines={1}>
                    {target.organizationName} · {target.roleTitle} · {target.servicePeriod}
                  </AppText>
                </View>
                <Pressable
                  accessibilityLabel="Close Ask Relay"
                  accessibilityRole="button"
                  onPress={() => setVisible(false)}
                  style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons color={colors.white} name="close" size={23} />
                </Pressable>
              </View>

              {targets.length > 1 ? (
                <ScrollView
                  contentContainerStyle={styles.targetList}
                  horizontal
                  showsHorizontalScrollIndicator={false}>
                  {targets.map((candidate) => {
                    const selected = candidate.handoffId === target.handoffId;
                    return (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        disabled={mutation.isPending}
                        key={candidate.handoffId}
                        onPress={() => chooseTarget(candidate.handoffId)}
                        style={({ pressed }) => [
                          styles.targetChip,
                          selected && styles.targetChipSelected,
                          pressed && styles.pressed,
                        ]}>
                        <AppText variant="caption" color={selected ? colors.white : colors.moss}>
                          {candidate.roleTitle} · {candidate.servicePeriod}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}

              <ScrollView
                contentContainerStyle={styles.messages}
                keyboardShouldPersistTaps="handled"
                ref={messageList}
                style={styles.messageList}
                showsVerticalScrollIndicator>
                <View style={[styles.bubble, styles.relayBubble]}>
                  <AppText>
                    Ask me about the previous {target.roleTitle} handoff. I answer only from its approved published knowledge.
                  </AppText>
                </View>

                {messages.map((message) => message.sender === 'user' ? (
                  <View key={message.id} style={[styles.bubble, styles.userBubble]}>
                    <AppText color={colors.white}>{message.text}</AppText>
                  </View>
                ) : (
                  <View
                    key={message.id}
                    onLayout={(event) => {
                      if (messages[messages.length - 1]?.id === message.id) {
                        messageList.current?.scrollTo({
                          animated: true,
                          y: Math.max(event.nativeEvent.layout.y - spacing.sm, 0),
                        });
                      }
                    }}
                    style={[styles.bubble, styles.relayBubble]}>
                    <View style={styles.answerHeading}>
                      <MaterialCommunityIcons
                        color={message.answer.status === 'answered' ? colors.moss : colors.saffron}
                        name={message.answer.status === 'answered'
                          ? 'check-decagram-outline'
                          : message.answer.status === 'conflict' ? 'alert-outline' : 'information-outline'}
                        size={19}
                      />
                      <AppText variant="label">
                        {message.answer.status === 'answered'
                          ? 'From the previous handoff'
                          : message.answer.status === 'conflict' ? 'Conflicting information' : 'Not in the handoff'}
                      </AppText>
                    </View>
                    <AppText>{message.answer.answer}</AppText>
                    {message.answer.citations.length ? (
                      <View style={styles.citations}>
                        <AppText variant="caption" color={colors.inkMuted}>SOURCES</AppText>
                        {message.answer.citations.map((citation) => (
                          <View key={citation.ref} style={styles.citation}>
                            <MaterialCommunityIcons color={colors.moss} name="file-check-outline" size={17} />
                            <View style={styles.flex}>
                              <AppText variant="caption">{citation.title}</AppText>
                              {citation.sources.map((source, index) => (
                                <AppText
                                  color={colors.inkMuted}
                                  key={`${source.label}-${index}`}
                                  variant="caption">
                                  {source.label}{source.locator ? ` · ${source.locator}` : ''}
                                </AppText>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <AppText variant="caption" color={colors.inkMuted}>
                      {message.answer.remaining} questions remaining today
                    </AppText>
                  </View>
                ))}

                {mutation.isPending ? (
                  <View style={[styles.bubble, styles.relayBubble, styles.thinkingBubble]}>
                    <MaterialCommunityIcons color={colors.moss} name="dots-horizontal" size={22} />
                    <AppText color={colors.inkMuted}>Checking the published handoff…</AppText>
                  </View>
                ) : null}
              </ScrollView>

              {mutation.error ? (
                <View accessibilityLiveRegion="polite" style={styles.error}>
                  <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
                  <AppText variant="caption" color={colors.emergency} style={styles.flex}>
                    {mutation.error.message}
                  </AppText>
                </View>
              ) : null}

              <View style={styles.composer}>
                <TextInput
                  accessibilityLabel="Question for Ask Relay"
                  editable={!mutation.isPending}
                  maxLength={500}
                  multiline
                  onChangeText={(value) => {
                    setQuestion(value);
                    if (mutation.error) mutation.reset();
                  }}
                  onSubmitEditing={() => void ask()}
                  placeholder="Ask about the previous handoff…"
                  placeholderTextColor={colors.inkMuted}
                  returnKeyType="send"
                  style={styles.input}
                  value={question}
                />
                <Pressable
                  accessibilityLabel="Send question"
                  accessibilityRole="button"
                  disabled={!question.trim() || mutation.isPending}
                  onPress={() => void ask()}
                  style={({ pressed }) => [
                    styles.sendButton,
                    (!question.trim() || mutation.isPending) && styles.sendButtonDisabled,
                    pressed && styles.pressed,
                  ]}>
                  <MaterialCommunityIcons color={colors.white} name="arrow-up" size={22} />
                </Pressable>
              </View>
              <AppText variant="caption" color={colors.inkMuted} style={styles.trustCopy}>
                Relay never edits the Handoff and does not answer beyond its published knowledge.
              </AppText>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  launcher: {
    position: 'absolute', right: spacing.lg, bottom: 108, zIndex: 20,
    width: 64, height: 64, alignItems: 'center', justifyContent: 'center',
    borderRadius: 32, backgroundColor: colors.moss,
    borderWidth: 3, borderColor: colors.surface, ...shadow,
  },
  modalRoot: { flex: 1 },
  backdrop: {
    flex: 1, justifyContent: 'flex-end', alignItems: 'flex-end',
    paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: spacing.lg,
    backgroundColor: 'rgba(22, 20, 17, 0.34)',
  },
  backdropDismiss: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  chatCard: {
    width: '100%', maxWidth: 460, height: '76%', minHeight: 440,
    overflow: 'hidden', borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, ...shadow,
  },
  chatHeader: {
    minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.moss,
  },
  botMark: {
    width: 42, height: 42, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.14)',
  },
  headerCopy: { flex: 1, gap: spacing.xxs },
  closeButton: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: 'rgba(255,255,255,0.1)',
  },
  targetList: { gap: spacing.xs, padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  targetChip: {
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs,
    borderRadius: radii.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  targetChipSelected: { borderColor: colors.moss, backgroundColor: colors.moss },
  messageList: { flex: 1, backgroundColor: colors.canvas },
  messages: { flexGrow: 1, gap: spacing.sm, padding: spacing.md },
  bubble: { maxWidth: '88%', gap: spacing.sm, padding: spacing.sm, borderRadius: radii.md },
  relayBubble: {
    alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.line,
    borderBottomLeftRadius: radii.sm, backgroundColor: colors.surface,
  },
  userBubble: {
    alignSelf: 'flex-end', borderBottomRightRadius: radii.sm, backgroundColor: colors.moss,
  },
  thinkingBubble: { flexDirection: 'row', alignItems: 'center' },
  answerHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  citations: { gap: spacing.xs, paddingTop: spacing.xxs },
  citation: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs,
    marginHorizontal: spacing.sm, paddingLeft: spacing.sm, paddingRight: spacing.xs,
    paddingVertical: spacing.xs, borderRadius: radii.lg,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.canvas,
  },
  input: {
    flex: 1, minHeight: 42, maxHeight: 96, paddingVertical: spacing.sm,
    color: colors.ink, fontFamily: type.body, fontSize: 15,
  },
  sendButton: {
    width: 42, height: 42, alignItems: 'center', justifyContent: 'center',
    borderRadius: radii.pill, backgroundColor: colors.moss,
  },
  sendButtonDisabled: { opacity: 0.4 },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginHorizontal: spacing.sm, marginBottom: spacing.xs,
    padding: spacing.sm, borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  trustCopy: { textAlign: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  flex: { flex: 1 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
});
