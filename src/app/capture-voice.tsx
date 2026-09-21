import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { useCreateFileSource, useHandoff, useRole } from '@/features/relay/queries';
import { colors, radii, spacing } from '@/theme/tokens';

const MAX_RECORDING_SECONDS = 600;

function durationLabel(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function CaptureVoiceScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const mutation = useCreateFileSource();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const stopping = useRef(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [title, setTitle] = useState('Voice handoff notes');
  const [localError, setLocalError] = useState<string | null>(null);

  async function stopRecording() {
    if (stopping.current || !recorderState.isRecording) return;
    stopping.current = true;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri ?? recorder.getStatus().url;
      if (!uri) throw new Error('Relay could not save this recording. Please record it again.');
      setRecordingUri(uri);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Relay could not stop the recording.');
    } finally {
      stopping.current = false;
    }
  }

  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= MAX_RECORDING_SECONDS * 1000) {
      void stopRecording();
    }
  }, [recorderState.durationMillis, recorderState.isRecording]);

  useEffect(() => () => {
    if (recorder.isRecording) void recorder.stop();
    void setAudioModeAsync({ allowsRecording: false });
  }, [recorder]);

  if (!handoffId) return <Screen><MessageState icon="alert-circle-outline" title="Choose a handoff first" body="Voice notes must belong to a handoff." /></Screen>;
  if (handoffQuery.isPending || (handoffQuery.data && roleQuery.isPending)) return <Screen><LoadingState label="Preparing voice capture…" /></Screen>;
  if (handoffQuery.error || roleQuery.error || !handoffQuery.data || !roleQuery.data) {
    return <Screen><MessageState icon="microphone-message" title="Handoff unavailable" body={(handoffQuery.error ?? roleQuery.error)?.message ?? 'This handoff could not be opened.'} /></Screen>;
  }

  async function startRecording() {
    setLocalError(null);
    setRecordingUri(null);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return setLocalError('Microphone access is needed to record. You can still use typed or manual capture.');
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: MAX_RECORDING_SECONDS });
    } catch {
      setLocalError('Relay could not start recording. Check microphone access and try again.');
    }
  }

  async function save() {
    setLocalError(null);
    if (!recordingUri) return setLocalError('Record a voice note first.');
    if (!title.trim()) return setLocalError('Give this recording a title.');
    const web = Platform.OS === 'web';
    await mutation.mutateAsync({
      organizationId: handoffQuery.data!.organizationId,
      handoffId,
      kind: 'voice',
      title,
      file: {
        uri: recordingUri,
        name: `voice-${Date.now()}.${web ? 'webm' : 'm4a'}`,
        mimeType: web ? 'audio/webm' : 'audio/mp4',
      },
    });
    router.replace((`/handoff/${handoffId}`) as Href);
  }

  const recorded = Boolean(recordingUri);
  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{roleQuery.data.title.toUpperCase()}</AppText>
        <AppText variant="display">Talk through the role</AppText>
        <AppText color={colors.inkMuted}>Speak naturally. Include people, deadlines, processes, mistakes, and what you wish you had known.</AppText>
      </View>

      <View style={[styles.recorderCard, recorderState.isRecording && styles.recorderActive]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recorderState.isRecording ? 'Stop recording' : 'Start recording'}
          disabled={mutation.isPending}
          onPress={() => recorderState.isRecording ? void stopRecording() : void startRecording()}
          style={({ pressed }) => [styles.recordButton, recorderState.isRecording && styles.stopButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons color={colors.white} name={recorderState.isRecording ? 'stop' : 'microphone'} size={38} />
        </Pressable>
        <AppText variant="title">{durationLabel(recorderState.durationMillis)}</AppText>
        <AppText variant="label" color={recorderState.isRecording ? colors.emergency : colors.moss}>
          {recorderState.isRecording ? 'Recording · tap to stop' : recorded ? 'Recording ready' : 'Tap to start'}
        </AppText>
        <AppText variant="caption" color={colors.inkMuted}>Maximum 10 minutes · foreground recording only</AppText>
      </View>

      {recorded && !recorderState.isRecording ? (
        <View style={styles.details}>
          <FormInput label="Source title" maxLength={160} value={title} onChangeText={setTitle} />
          <Button icon="microphone-outline" label="Record again" tone="secondary" onPress={() => void startRecording()} />
        </View>
      ) : null}

      <View style={styles.note}>
        <MaterialCommunityIcons color={colors.saffron} name="shield-lock-outline" size={24} />
        <View style={styles.noteCopy}>
          <AppText variant="label">Private until you approve knowledge</AppText>
          <AppText variant="caption" color={colors.inkMuted}>If transcription fails, the recording remains saved and you can add an editable transcript manually.</AppText>
        </View>
      </View>

      {localError || mutation.error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.errorCopy}>{localError ?? mutation.error?.message}</AppText>
        </View>
      ) : null}
      <Button disabled={!recorded || recorderState.isRecording || mutation.isPending} icon="content-save-outline" label={mutation.isPending ? 'Saving securely…' : 'Save and transcribe'} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  recorderCard: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  recorderActive: { borderColor: '#DEAAA2', backgroundColor: '#FFF9F7' },
  recordButton: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.moss },
  stopButton: { backgroundColor: colors.emergency },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  details: { gap: spacing.md, marginTop: spacing.lg },
  note: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.saffronSoft },
  noteCopy: { flex: 1, gap: spacing.xxs },
  error: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1' },
  errorCopy: { flex: 1 },
});
