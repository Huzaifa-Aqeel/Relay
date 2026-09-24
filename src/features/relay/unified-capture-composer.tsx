import { MaterialCommunityIcons } from '@expo/vector-icons';
import { makeRedirectUri } from 'expo-auth-session';
import * as DocumentPicker from 'expo-document-picker';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  getRecordingPermissionsAsync,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import {
  CAPTURE_PROMPTS,
  deriveCaptureDisplayTitle,
  type CapturePrompt,
} from '@/features/relay/capture-prompts';
import {
  refreshCaptureAttachments,
  useCreateCaptureDraft,
  useDiscardCaptureDraft,
  useFindExactDocumentDuplicate,
  useGoogleDriveImport,
  useRollbackCaptureAttachment,
  useSubmitCapture,
  useTranscribeVoiceRecording,
} from '@/features/relay/queries';
import type { HandoffCapture, VoiceTranscriptPreview } from '@/features/relay/types';
import { durationLabel, VoiceWaveButton } from '@/features/relay/voice-wave-button';
import { colors, radii, shadow, spacing } from '@/theme/tokens';

const MAX_RECORDING_SECONDS = 600;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/bmp',
  'image/heic',
  'image/jpeg',
  'image/png',
];

const EXTENSION_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  bmp: 'image/bmp',
  heic: 'image/heic',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

type Attachment = {
  key: string;
  asset?: DocumentPicker.DocumentPickerAsset;
  sourceId?: string;
  name: string;
  size?: number | null;
  mimeType: string;
  title: string;
  contentHash?: string | null;
};

function mimeFor(name: string, reported?: string) {
  if (reported && SUPPORTED_TYPES.includes(reported)) return reported;
  return EXTENSION_MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

function titleFor(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 160) || 'Handoff document';
}

function fileSizeLabel(size?: number) {
  if (!size) return 'Size checked before upload';
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function UnifiedCaptureComposer({
  organizationId,
  handoffId,
  editingCapture,
  onEditComplete,
}: {
  organizationId: string;
  handoffId: string;
  editingCapture?: HandoffCapture | null;
  onEditComplete?: () => void;
}) {
  const captureMutation = useSubmitCapture();
  const createDraftMutation = useCreateCaptureDraft();
  const driveImportMutation = useGoogleDriveImport();
  const discardDraftMutation = useDiscardCaptureDraft();
  const rollbackAttachmentMutation = useRollbackCaptureAttachment();
  const duplicateMutation = useFindExactDocumentDuplicate();
  const transcribeMutation = useTranscribeVoiceRecording();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const stopping = useRef(false);
  const [composerOpen, setComposerOpen] = useState(Boolean(editingCapture));
  const [selectedPrompt, setSelectedPrompt] = useState<CapturePrompt | undefined>(() => (
    editingCapture ? CAPTURE_PROMPTS.find((prompt) => prompt.id === editingCapture.promptId) : undefined
  ));
  const [composerText, setComposerText] = useState(editingCapture?.textContent ?? '');
  const [voicePreview, setVoicePreview] = useState<VoiceTranscriptPreview | null>(null);
  const [recordingUri, setRecordingUri] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>(() => (
    editingCapture?.attachments.map((source) => ({
      key: source.id,
      sourceId: source.id,
      name: source.title,
      size: source.sizeBytes,
      mimeType: source.mimeType ?? 'application/octet-stream',
      title: source.title,
      contentHash: source.contentHash,
    })) ?? []
  ));
  const [draftCaptureId, setDraftCaptureId] = useState<string | null>(null);
  const [driveImportedSourceIds, setDriveImportedSourceIds] = useState<string[]>([]);
  const [driveImporting, setDriveImporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const stopRecordingAtLimit = useEffectEvent(() => {
    void stopRecording();
  });

  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= MAX_RECORDING_SECONDS * 1000) {
      stopRecordingAtLimit();
    }
  }, [recorderState.durationMillis, recorderState.isRecording]);

  useEffect(() => () => {
    // useAudioRecorder owns and releases the native recorder. Reading it from
    // this cleanup can race with that release and crash on Android.
    void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);

  async function transcribeRecording(uri: string) {
    setLocalError(null);
    const web = Platform.OS === 'web';
    try {
      const result = await transcribeMutation.mutateAsync({
        organizationId,
        handoffId,
        file: {
          uri,
          name: `voice-${Date.now()}.${web ? 'webm' : 'm4a'}`,
          mimeType: web ? 'audio/webm' : 'audio/mp4',
        },
      });
      setVoicePreview(result);
      setComposerText((current) => [current.trim(), result.transcript.trim()].filter(Boolean).join('\n\n'));
    } catch {
      setVoicePreview(null);
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

  async function startRecording() {
    setLocalError(null);
    transcribeMutation.reset();
    setRecordingUri(null);
    setVoicePreview(null);
    try {
      let permission = await getRecordingPermissionsAsync();
      if (!permission.granted) {
        permission = await requestRecordingPermissionsAsync();
      }
      if (!permission.granted) {
        setLocalError('Microphone access is needed to record. You can still write the note instead.');
        if (Platform.OS !== 'web') {
          Alert.alert(
            'Allow microphone access',
            'Microphone access is turned off for Relay. Enable it in your device settings to record a note.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => void Linking.openSettings() },
            ],
          );
        }
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, shouldPlayInBackground: false });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: MAX_RECORDING_SECONDS });
    } catch (caught) {
      setLocalError(caught instanceof Error
        ? caught.message
        : 'Relay could not start recording. Check microphone access and try again.');
    }
  }

  function writeInstead() {
    transcribeMutation.reset();
    setRecordingUri(null);
    setVoicePreview(null);
    setLocalError(null);
  }

  async function chooseFiles() {
    setLocalError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: SUPPORTED_TYPES,
      copyToCacheDirectory: true,
      multiple: true,
      base64: false,
    });
    if (result.canceled) return;

    const next: Attachment[] = [];
    const duplicateNames: string[] = [];
    for (const asset of result.assets) {
      if (asset.size && asset.size > MAX_SOURCE_BYTES) {
        setLocalError(`${asset.name} is larger than 25 MB.`);
        continue;
      }
      const mimeType = mimeFor(asset.name, asset.mimeType);
      if (!mimeType) {
        setLocalError(`${asset.name} is not a supported file type.`);
        continue;
      }
      try {
        const checked = await duplicateMutation.mutateAsync({
          organizationId,
          handoffId,
          file: { uri: asset.uri, name: asset.name, size: asset.size },
        });
        const alreadySelected = [...attachments, ...next]
          .some((attachment) => attachment.contentHash === checked.contentHash);
        if (checked.duplicate || alreadySelected) {
          duplicateNames.push(asset.name);
          continue;
        }
        next.push({
          key: `${asset.uri}:${asset.name}:${asset.size ?? 0}`,
          asset,
          name: asset.name,
          size: asset.size,
          mimeType,
          title: titleFor(asset.name),
          contentHash: checked.contentHash,
        });
      } catch (caught) {
        setLocalError(caught instanceof Error ? caught.message : `Relay could not check ${asset.name}.`);
      }
    }
    setAttachments((current) => {
      const existing = new Set(current.map((attachment) => attachment.key));
      return [...current, ...next.filter((attachment) => !existing.has(attachment.key))];
    });
    if (duplicateNames.length) {
      Alert.alert(
        duplicateNames.length === 1 ? 'File already exists' : 'Files already exist',
        duplicateNames.length === 1
          ? `${duplicateNames[0]} already exists in this Handoff and was not added.`
          : `${duplicateNames.join(', ')} already exist in this Handoff and were not added.`,
      );
    }
  }

  function displayTitle() {
    return deriveCaptureDisplayTitle({
      promptTitle: selectedPrompt?.title,
      textContent: composerText,
      attachmentTitles: attachments.map((attachment) => attachment.title),
    });
  }

  async function chooseDriveFiles() {
    setLocalError(null);
    setDriveImporting(true);
    try {
      let captureId = editingCapture?.id ?? draftCaptureId;
      if (!captureId) {
        captureId = await createDraftMutation.mutateAsync({
          organizationId,
          handoffId,
          title: displayTitle(),
          promptId: selectedPrompt?.id ?? null,
          textContent: composerText.trim() || null,
        });
        setDraftCaptureId(captureId);
      }

      const persistedBefore = await refreshCaptureAttachments(captureId);
      const before = new Set(persistedBefore.map((source) => source.id));
      const returnUrl = makeRedirectUri({ scheme: 'relay', path: 'drive-import' });
      const { authUrl } = await driveImportMutation.mutateAsync({ captureId, returnUrl, handoffId });
      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);
      if (result.type !== 'success') return;

      const parsed = Linking.parse(result.url);
      const status = typeof parsed.queryParams?.drive_status === 'string'
        ? parsed.queryParams.drive_status
        : 'failed';
      if (status === 'cancelled') return;
      if (status !== 'success') throw new Error('Google Drive could not import those files. Try again.');

      const persistedAfter = await refreshCaptureAttachments(captureId);
      const imported = persistedAfter.filter((source) => !before.has(source.id));
      const newSourceIds = imported.map((source) => source.id);
      setDriveImportedSourceIds((current) => [...new Set([...current, ...newSourceIds])]);
      setAttachments((current) => {
        const currentSourceIds = new Set(current.flatMap((attachment) => attachment.sourceId ? [attachment.sourceId] : []));
        const importedHashes = new Set(imported.map((source) => source.contentHash).filter(Boolean));
        const local = current.filter((attachment) => attachment.sourceId || !attachment.contentHash
          || !importedHashes.has(attachment.contentHash));
        const serverAttachments = imported
          .filter((source) => !currentSourceIds.has(source.id))
          .map((source): Attachment => ({
            key: source.id,
            sourceId: source.id,
            name: source.title,
            size: source.sizeBytes,
            mimeType: source.mimeType ?? 'application/octet-stream',
            title: source.title,
            contentHash: source.contentHash,
          }));
        return [...local, ...serverAttachments];
      });

      const duplicateCount = Number(parsed.queryParams?.drive_duplicates ?? 0);
      const skippedCount = Number(parsed.queryParams?.drive_skipped ?? 0);
      if (duplicateCount || skippedCount) {
        const details = [
          duplicateCount ? `${duplicateCount} duplicate ${duplicateCount === 1 ? 'file was' : 'files were'} not added` : '',
          skippedCount ? `${skippedCount} unsupported, unavailable, or oversized ${skippedCount === 1 ? 'file was' : 'files were'} not added` : '',
        ].filter(Boolean).join('. ');
        Alert.alert('Some files were not added', `${details}.`);
      }
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Google Drive could not be opened. Try again.');
    } finally {
      setDriveImporting(false);
    }
  }

  async function removeAttachment(attachment: Attachment) {
    if (attachment.sourceId && driveImportedSourceIds.includes(attachment.sourceId)) {
      setLocalError(null);
      try {
        const captureId = editingCapture?.id ?? draftCaptureId;
        if (!captureId) throw new Error('This attachment is unavailable.');
        await rollbackAttachmentMutation.mutateAsync({ captureId, sourceId: attachment.sourceId });
        setDriveImportedSourceIds((current) => current.filter((sourceId) => sourceId !== attachment.sourceId));
      } catch (caught) {
        setLocalError(caught instanceof Error ? caught.message : 'Relay could not remove this file. Try again.');
        return;
      }
    }
    setAttachments((current) => current.filter((item) => item.key !== attachment.key));
  }

  async function saveCapture() {
    if (!composerText.trim() && attachments.length === 0) {
      return setLocalError('Write, record, or add a file first.');
    }

    setSubmitting(true);
    setLocalError(null);
    try {
      const result = await captureMutation.mutateAsync({
        captureId: editingCapture?.id ?? draftCaptureId,
        organizationId,
        handoffId,
        title: displayTitle(),
        promptId: selectedPrompt?.id ?? null,
        textContent: composerText.trim() || null,
        retainedAttachmentSourceIds: attachments.flatMap((attachment) => attachment.sourceId ? [attachment.sourceId] : []),
        attachments: attachments.flatMap((attachment) => attachment.asset ? [{
          uri: attachment.asset.uri,
          name: attachment.asset.name,
          mimeType: attachment.mimeType,
          size: attachment.asset.size,
          title: attachment.title,
        }] : []),
      });
      if (result.duplicateTitles.length) {
        Alert.alert(
          result.duplicateTitles.length === 1 ? 'File already added' : 'Files already added',
          'Relay linked the existing file evidence without uploading or processing it again.',
        );
      }

      setComposerText('');
      setVoicePreview(null);
      setRecordingUri(null);
      setAttachments([]);
      setDraftCaptureId(null);
      setDriveImportedSourceIds([]);
      setSelectedPrompt(undefined);
      duplicateMutation.reset();
      transcribeMutation.reset();
      setComposerOpen(false);
      onEditComplete?.();
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Relay could not save this capture. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const transcribing = transcribeMutation.isPending;
  const transcriptionFailed = Boolean(recordingUri && transcribeMutation.error && !transcribing);
  const busy = submitting || captureMutation.isPending || duplicateMutation.isPending || driveImporting
    || createDraftMutation.isPending || discardDraftMutation.isPending || rollbackAttachmentMutation.isPending;

  function openComposer(prompt?: CapturePrompt) {
    onEditComplete?.();
    setSelectedPrompt(prompt);
    setComposerText('');
    setAttachments([]);
    setDraftCaptureId(null);
    setDriveImportedSourceIds([]);
    setVoicePreview(null);
    setRecordingUri(null);
    captureMutation.reset();
    duplicateMutation.reset();
    transcribeMutation.reset();
    setLocalError(null);
    setComposerOpen(true);
  }

  async function closeComposer() {
    if (busy || recorderState.isRecording || transcribing) return;
    setLocalError(null);
    try {
      if (editingCapture) {
        for (const sourceId of driveImportedSourceIds) {
          await rollbackAttachmentMutation.mutateAsync({ captureId: editingCapture.id, sourceId });
        }
      } else if (draftCaptureId) {
        await discardDraftMutation.mutateAsync(draftCaptureId);
      }
      setDraftCaptureId(null);
      setDriveImportedSourceIds([]);
      setComposerOpen(false);
      onEditComplete?.();
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'Relay could not close this Capture safely. Try again.');
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>CAPTURE</AppText>
        <AppText variant="heading">Capture what the next leader should know</AppText>
      </View>

      <View style={styles.launcher}>
        <Pressable
          accessibilityRole="button"
          onPress={() => openComposer()}
          style={({ pressed }) => [styles.addSomething, pressed && styles.pressed]}>
          <AppText color={colors.inkMuted}>Add something…</AppText>
        </Pressable>
      </View>

      <View style={styles.prompts}>
        <AppText variant="label">Not sure what to add?</AppText>
        <View style={styles.promptList}>
          {CAPTURE_PROMPTS.map((prompt) => {
            const selected = selectedPrompt?.id === prompt.id;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                disabled={busy || recorderState.isRecording || transcribing}
                key={prompt.id}
                onPress={() => openComposer(prompt)}
                style={({ pressed }) => [styles.promptChip, selected && styles.promptChipSelected, pressed && styles.pressed]}>
                <AppText variant="caption" color={selected ? colors.white : colors.moss}>{prompt.title}</AppText>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => void closeComposer()}
        statusBarTranslucent
        transparent
        visible={composerOpen}>
        <View style={styles.modalBackdrop}>
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <AppText variant="heading" style={styles.sheetTitle}>{editingCapture ? 'Edit capture' : 'Add to your handoff'}</AppText>
              <Pressable
                accessibilityLabel="Close capture"
                accessibilityRole="button"
                disabled={busy || recorderState.isRecording || transcribing}
                onPress={() => void closeComposer()}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <MaterialCommunityIcons color={colors.ink} name="close" size={24} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              {selectedPrompt ? (
                <View style={styles.guidance}>
                  <AppText accessibilityRole="header" variant="heading">{selectedPrompt.title}</AppText>
                  <AppText>{selectedPrompt.question}</AppText>
                </View>
              ) : null}

              <View style={styles.composer}>
                {recorderState.isRecording ? (
                  <View style={styles.recordingState}>
                    <VoiceWaveButton disabled={stopping.current} isRecording onPress={() => void stopRecording()} />
                    <AppText variant="title">{durationLabel(recorderState.durationMillis)}</AppText>
                    <AppText variant="label" color={colors.emergency}>Recording · tap to stop</AppText>
                    <AppText variant="caption" color={colors.inkMuted}>Maximum 10 minutes</AppText>
                  </View>
                ) : transcribing ? (
                  <View accessibilityLiveRegion="polite" style={styles.processingState}>
                    <AppText variant="heading">Transcribing your recording…</AppText>
                    <AppText color={colors.inkMuted}>This usually takes a few seconds.</AppText>
                  </View>
                ) : transcriptionFailed ? (
                  <View accessibilityLiveRegion="polite" style={styles.processingState}>
                    <AppText variant="heading">We couldn&apos;t transcribe this recording.</AppText>
                    <View style={styles.failureActions}>
                      <Button disabled={busy} label="Record again" onPress={() => void startRecording()} />
                      <Button disabled={busy} label="Write instead" tone="secondary" onPress={writeInstead} />
                    </View>
                  </View>
                ) : (
                  <>
                    {voicePreview ? (
                      <View style={styles.reviewHeading}>
                        <AppText variant="label">Review your transcript</AppText>
                        <AppText variant="caption" color={colors.inkMuted}>Make any corrections before Relay organizes it.</AppText>
                      </View>
                    ) : null}
                    <FormInput
                      editable={!busy}
                      label={voicePreview ? 'Transcript' : attachments.length ? 'Your note (optional)' : 'Your note'}
                      maxLength={50000}
                      multiline
                      placeholder="Write or paste something…"
                      style={styles.textArea}
                      value={composerText}
                      onChangeText={setComposerText}
                    />
                  </>
                )}

                {attachments.length ? (
                  <View style={styles.attachments}>
                    {attachments.map((attachment) => (
                      <View key={attachment.key} style={styles.fileCard}>
                        <View style={styles.fileIcon}>
                          <MaterialCommunityIcons color={colors.moss} name="file-document-outline" size={23} />
                        </View>
                        <View style={styles.fileCopy}>
                          <AppText variant="label" numberOfLines={2}>{attachment.name}</AppText>
                          <AppText variant="caption" color={colors.inkMuted}>{fileSizeLabel(attachment.size ?? undefined)}</AppText>
                        </View>
                        <Pressable
                          accessibilityLabel={`Remove ${attachment.name}`}
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={() => void removeAttachment(attachment)}
                          style={({ pressed }) => [styles.removeFile, pressed && styles.pressed]}>
                          <MaterialCommunityIcons color={colors.inkMuted} name="close" size={21} />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                {!recorderState.isRecording && !transcribing && !transcriptionFailed ? (
                  <View style={styles.captureActions}>
                    <Button
                      disabled={busy}
                      icon="microphone-outline"
                      label="Record"
                      style={styles.actionButton}
                      tone="secondary"
                      onPress={() => void startRecording()}
                    />
                    <View style={styles.attachmentActions}>
                      <Button
                        disabled={busy}
                        icon="paperclip"
                        label={duplicateMutation.isPending ? 'Checking files…' : 'Add files'}
                        style={styles.actionButton}
                        tone="secondary"
                        onPress={() => void chooseFiles()}
                      />
                      <Button
                        disabled={busy}
                        icon="google-drive"
                        label={driveImporting ? 'Opening Drive…' : 'Google Drive'}
                        style={styles.actionButton}
                        tone="secondary"
                        onPress={() => void chooseDriveFiles()}
                      />
                    </View>
                  </View>
                ) : null}

                {localError || captureMutation.error || duplicateMutation.error || driveImportMutation.error ? (
                  <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.emergency}>
                    {localError ?? captureMutation.error?.message ?? duplicateMutation.error?.message
                      ?? driveImportMutation.error?.message}
                  </AppText>
                ) : null}

                <Button
                  disabled={busy || recorderState.isRecording || transcribing || transcriptionFailed
                    || (!composerText.trim() && attachments.length === 0)}
                  label={submitting || captureMutation.isPending ? 'Saving…' : 'Save'}
                  onPress={() => void saveCapture()}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  heading: { gap: spacing.xxs },
  eyebrow: { letterSpacing: 1.2 },
  launcher: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadow,
  },
  addSomething: { minHeight: 82, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  prompts: { gap: spacing.xs },
  promptList: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  promptChip: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  promptChipSelected: { borderColor: colors.moss, backgroundColor: colors.moss },
  guidance: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mossSoft },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(22,20,17,0.48)' },
  sheet: {
    width: '100%',
    maxWidth: 720,
    maxHeight: '94%',
    alignSelf: 'center',
    overflow: 'hidden',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: colors.canvas,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    backgroundColor: colors.surface,
  },
  sheetTitle: { flex: 1 },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  sheetContent: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xxl },
  composer: {
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadow,
  },
  textArea: { minHeight: 180 },
  reviewHeading: { gap: spacing.xxs },
  recordingState: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  processingState: { gap: spacing.md, paddingVertical: spacing.lg },
  failureActions: { gap: spacing.sm },
  captureActions: { gap: spacing.sm },
  attachmentActions: { flexDirection: 'row', gap: spacing.sm },
  actionButton: { flex: 1 },
  attachments: { gap: spacing.xs },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.mossSoft,
  },
  fileIcon: { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  fileCopy: { flex: 1, gap: spacing.xxs },
  removeFile: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  pressed: { opacity: 0.76 },
});
