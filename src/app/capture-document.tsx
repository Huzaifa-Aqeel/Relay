import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput, FormSection } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { useCreateFileSource, useHandoff, useRole } from '@/features/relay/queries';
import { colors, radii, spacing } from '@/theme/tokens';

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
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  bmp: 'image/bmp', heic: 'image/heic',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
};

function mimeFor(name: string, reported?: string) {
  if (reported && SUPPORTED_TYPES.includes(reported)) return reported;
  return EXTENSION_MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

function titleFor(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 160) || 'Handoff document';
}

function fileSizeLabel(size?: number) {
  if (!size) return 'Size will be checked before upload';
  return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function CaptureDocumentScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const mutation = useCreateFileSource();
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  if (!handoffId) return <Screen><MessageState icon="alert-circle-outline" title="Choose a handoff first" body="Documents must belong to a handoff." /></Screen>;
  if (handoffQuery.isPending || (handoffQuery.data && roleQuery.isPending)) return <Screen><LoadingState label="Opening document capture…" /></Screen>;
  if (handoffQuery.error || roleQuery.error || !handoffQuery.data || !roleQuery.data) {
    return <Screen><MessageState icon="file-alert-outline" title="Handoff unavailable" body={(handoffQuery.error ?? roleQuery.error)?.message ?? 'This handoff could not be opened.'} /></Screen>;
  }

  async function chooseDocument() {
    setLocalError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: SUPPORTED_TYPES,
      copyToCacheDirectory: true,
      multiple: false,
      base64: false,
    });
    if (result.canceled) return;
    const chosen = result.assets[0];
    if (chosen.size && chosen.size > MAX_SOURCE_BYTES) {
      setAsset(null);
      return setLocalError('Choose a document smaller than 25 MB.');
    }
    if (!mimeFor(chosen.name, chosen.mimeType)) {
      setAsset(null);
      return setLocalError('Choose a PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, JPEG, PNG, BMP, or HEIC file.');
    }
    setAsset(chosen);
    setTitle(titleFor(chosen.name));
  }

  async function save(versionDecision?: 'new_version' | 'separate', supersedesSourceId?: string) {
    setLocalError(null);
    if (!asset) return setLocalError('Choose a document first.');
    if (!title.trim()) return setLocalError('Give this source a title.');
    const mimeType = mimeFor(asset.name, asset.mimeType);
    if (!mimeType) return setLocalError('This file type is not supported.');
    const result = await mutation.mutateAsync({
      organizationId: handoffQuery.data!.organizationId,
      handoffId,
      kind: 'document',
      title,
      file: { uri: asset.uri, name: asset.name, mimeType, size: asset.size },
      versionDecision,
      supersedesSourceId,
    });
    if (result.status === 'duplicate') {
      Alert.alert(
        'This file already exists',
        `${result.title} has the same content, so Relay did not upload or process it again.`,
        [
          { text: 'Stay here', style: 'cancel' },
          { text: 'Open existing source', onPress: () => router.replace((`/source/${result.sourceId}`) as Href) },
        ],
      );
      return;
    }
    if (result.status === 'confirmation_required') {
      Alert.alert(
        'Possible updated version',
        `This looks like an updated version of ${result.title}. Treat it as a new version?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Keep separate', onPress: () => void save('separate') },
          { text: 'New version', onPress: () => void save('new_version', result.sourceId) },
        ],
      );
      return;
    }
    router.replace((`/handoff/${handoffId}`) as Href);
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{roleQuery.data.title.toUpperCase()}</AppText>
        <AppText variant="display">Add a source document</AppText>
        <AppText color={colors.inkMuted}>Relay keeps the original file private, detects duplicates and likely updates, and keeps every linked version for evidence.</AppText>
      </View>

      <FormSection eyebrow="Document source" title="Choose existing material">
        <Button icon="file-upload-outline" label={asset ? 'Choose a different document' : 'Choose document'} tone="secondary" onPress={() => void chooseDocument()} />
        {asset ? (
          <View style={styles.fileCard}>
            <View style={styles.fileIcon}><MaterialCommunityIcons color={colors.moss} name="file-document-outline" size={27} /></View>
            <View style={styles.fileCopy}>
              <AppText variant="label" numberOfLines={2}>{asset.name}</AppText>
              <AppText variant="caption" color={colors.inkMuted}>{fileSizeLabel(asset.size)}</AppText>
            </View>
            <MaterialCommunityIcons color={colors.moss} name="check-circle" size={23} />
          </View>
        ) : null}
        <FormInput
          label="Source title"
          maxLength={160}
          placeholder="RoboFest planning guide"
          value={title}
          onChangeText={setTitle}
        />
      </FormSection>

      <View style={styles.note}>
        <MaterialCommunityIcons color={colors.saffron} name="shield-lock-outline" size={24} />
        <View style={styles.noteCopy}>
          <AppText variant="label">Private source · 25 MB maximum</AppText>
          <AppText variant="caption" color={colors.inkMuted}>Uploading never publishes this file. You can leave while Relay processes it. If processing fails, the original remains available and manual entry still works.</AppText>
        </View>
      </View>

      {localError || mutation.error ? (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.errorCopy}>{localError ?? mutation.error?.message}</AppText>
        </View>
      ) : null}
      <Button disabled={!asset || mutation.isPending} icon="arrow-up" label={mutation.isPending ? 'Uploading securely…' : 'Upload source'} onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.2 },
  fileCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.mossSoft,
  },
  fileIcon: { width: 44, height: 44, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  fileCopy: { flex: 1, gap: spacing.xxs },
  note: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.lg, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.saffronSoft },
  noteCopy: { flex: 1, gap: spacing.xxs },
  error: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1' },
  errorCopy: { flex: 1 },
});
