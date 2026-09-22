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
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import {
  useHandoff,
  useRole,
  useSaveVoiceSource,
  useTranscribeVoiceRecording,
} from '@/features/relay/queries';
import type { VoiceTranscriptPreview } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

const MAX_RECORDING_SECONDS = 600;
const WAVE_HEIGHTS = [24, 38, 52, 38, 24];
const IDLE_LEVELS = [0.42, 0.68, 1, 0.68, 0.42];

function durationLabel(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function VoiceWaveButton({
  disabled,
  isRecording,
  onPress,
}: {
  disabled: boolean;
  isRecording: boolean;
  onPress: () => void;
}) {
  const levels = useRef(WAVE_HEIGHTS.map((_, index) => new Animated.Value(IDLE_LEVELS[index]))).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isRecording) {
      levels.forEach((level, index) => level.setValue(IDLE_LEVELS[index]));
      pulse.setValue(0);
      return;
    }

    const waveform = levels.map((level, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(level, {
            duration: 260 + index * 45,
            easing: Easing.inOut(Easing.ease),
            toValue: 1,
            useNativeDriver: true,
          }),
          Animated.timing(level, {
            duration: 320 + index * 35,
            easing: Easing.inOut(Easing.ease),
            toValue: 0.22,
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    const halo = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 850,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 850,
          easing: Easing.in(Easing.ease),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    const animation = Animated.parallel([...waveform, halo], { stopTogether: false });
    animation.start();

    return () => {
      animation.stop();
      levels.forEach((level, index) => level.setValue(IDLE_LEVELS[index]));
      pulse.setValue(0);
    };
  }, [isRecording, levels, pulse]);

  return (
    <View style={styles.waveButtonFrame}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.waveHalo,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0, 0.42] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] }) }],
          },
        ]}
      />
      <Pressable
        accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.waveButton,
          isRecording && styles.waveButtonRecording,
          disabled && styles.waveButtonDisabled,
          pressed && styles.pressed,
        ]}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.waveform}>
          {levels.map((level, index) => (
            <Animated.View
              key={`wave-${index}`}
              style={[
                styles.waveBar,
                {
                  height: WAVE_HEIGHTS[index],
                  transform: [{ scaleY: level }],
                },
              ]}
            />
          ))}
        </View>
      </Pressable>
    </View>
  );
}

export default function CaptureVoiceScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const transcribeMutation = useTranscribeVoiceRecording();
  const saveMutation = useSaveVoiceSource();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const stopping = useRef(false);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [preview, setPreview] = useState<VoiceTranscriptPreview | null>(null);
  const [title, setTitle] = useState('Voice handoff notes');
  const [transcript, setTranscript] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function transcribeRecording(uri: string) {
    if (!handoffQuery.data) return;
    setLocalError(null);
    const web = Platform.OS === 'web';
    try {
      const result = await transcribeMutation.mutateAsync({
        organizationId: handoffQuery.data.organizationId,
        handoffId: handoffQuery.data.id,
        file: {
          uri,
          name: `voice-${Date.now()}.${web ? 'webm' : 'm4a'}`,
          mimeType: web ? 'audio/webm' : 'audio/mp4',
        },
      });
      setPreview(result);
      setTranscript(result.transcript);
    } catch {
      setPreview(null);
      setTranscript('');
    }
  }

  async function stopRecording() {
    if (stopping.current || !recorderState.isRecording) return;
    stopping.current = true;
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri ?? recorder.getStatus().url;
      if (!uri) throw new Error('Relay could not finish the recording. Please record it again.');
      setRecordingUri(uri);
      await transcribeRecording(uri);
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
    transcribeMutation.reset();
    saveMutation.reset();
    setRecordingUri(null);
    setPreview(null);
    setTitle('Voice handoff notes');
    setTranscript('');
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) return setLocalError('Microphone access is needed to record. You can still write the note instead.');
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
    if (!preview) return setLocalError('Record and transcribe a voice note first.');
    if (!title.trim()) return setLocalError('Give this voice note a title.');
    if (!transcript.trim()) return setLocalError('Review the transcript before continuing.');
    try {
      await saveMutation.mutateAsync({
        recording: {
          ...preview,
          transcript: transcript.trim(),
        },
        title: title.trim(),
      });
      router.replace((`/handoff/${handoffId}`) as Href);
    } catch {
      // The mutation exposes a user-safe error below the transcript.
    }
  }

  const recorded = Boolean(recordingUri);
  const transcribing = transcribeMutation.isPending;
  const saving = saveMutation.isPending;
  const transcriptionFailed = Boolean(transcribeMutation.error && !transcribing);
  const showRecorder = !recorded || recorderState.isRecording;

  return (
    <Screen>
      {showRecorder ? (
        <>
          <View style={styles.heading}>
            <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{roleQuery.data.title.toUpperCase()}</AppText>
            <AppText variant="display">Talk through the role</AppText>
            <AppText color={colors.inkMuted}>Speak naturally. Include people, deadlines, processes, mistakes, and what you wish you had known.</AppText>
          </View>

          <View style={styles.recorder}>
            <VoiceWaveButton
              disabled={stopping.current}
              isRecording={recorderState.isRecording}
              onPress={() => recorderState.isRecording ? void stopRecording() : void startRecording()}
            />
            <AppText variant="title">{durationLabel(recorderState.durationMillis)}</AppText>
            <AppText variant="label" color={recorderState.isRecording ? colors.emergency : colors.moss}>
              {recorderState.isRecording ? 'Recording · tap to stop' : 'Tap to start'}
            </AppText>
            <AppText variant="caption" color={colors.inkMuted}>Maximum 10 minutes</AppText>
          </View>

          {localError ? (
            <AppText accessibilityLiveRegion="polite" color={colors.emergency} style={styles.inlineError} variant="caption">
              {localError}
            </AppText>
          ) : null}
        </>
      ) : null}

      {recorded && transcribing ? (
        <View accessibilityLiveRegion="polite" style={styles.state}>
          <AppText variant="display">Transcribing your recording…</AppText>
          <AppText color={colors.inkMuted}>This usually takes a few seconds.</AppText>
        </View>
      ) : null}

      {recorded && transcriptionFailed ? (
        <View accessibilityLiveRegion="polite" style={styles.state}>
          <AppText variant="display">We couldn&apos;t transcribe this recording.</AppText>
          <View style={styles.actions}>
            <Button disabled={saving} label="Record again" onPress={() => void startRecording()} />
            <Button
              disabled={saving}
              label="Write instead"
              tone="secondary"
              onPress={() => router.replace((`/capture-text?handoffId=${handoffId}`) as Href)}
            />
          </View>
        </View>
      ) : null}

      {preview && !transcribing ? (
        <View style={styles.state}>
          <View style={styles.reviewHeading}>
            <AppText variant="display">Review your transcript</AppText>
            <AppText color={colors.inkMuted}>Make any corrections before Relay organizes it.</AppText>
          </View>
          <FormInput
            editable={!saving}
            label="Source title"
            maxLength={160}
            value={title}
            onChangeText={setTitle}
          />
          <FormInput
            editable={!saving}
            label="Review transcript"
            maxLength={50000}
            multiline
            style={styles.transcript}
            value={transcript}
            onChangeText={setTranscript}
          />
          {localError || saveMutation.error ? (
            <AppText accessibilityLiveRegion="polite" color={colors.emergency} variant="caption">
              {localError ?? saveMutation.error?.message}
            </AppText>
          ) : null}
          <Button
            disabled={!title.trim() || !transcript.trim() || saving}
            label={saving ? 'Continuing…' : 'Continue'}
            onPress={() => void save()}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  recorder: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  waveButtonFrame: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  waveHalo: { position: 'absolute', width: 116, height: 116, borderRadius: 58, backgroundColor: '#F2B9B0' },
  waveButton: {
    width: 104,
    height: 104,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 52,
    backgroundColor: colors.moss,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 6,
  },
  waveButtonRecording: { backgroundColor: colors.emergency },
  waveButtonDisabled: { opacity: 0.58 },
  waveform: { height: 56, flexDirection: 'row', alignItems: 'center', gap: 5 },
  waveBar: { width: 5, borderRadius: radii.pill, backgroundColor: colors.white },
  pressed: { opacity: 0.82, transform: [{ scale: 0.97 }] },
  state: { gap: spacing.lg, marginTop: spacing.xl },
  reviewHeading: { gap: spacing.xs },
  transcript: { minHeight: 260 },
  actions: { gap: spacing.sm },
  inlineError: { marginTop: spacing.lg, textAlign: 'center' },
});
