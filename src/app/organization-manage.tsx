import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { Screen } from '@/components/ui/screen';
import { useContinuity } from '@/features/relay/continuity';
import {
  useDecideOrganizationMembershipRequest,
  useOrganization,
  usePendingMembershipRequests,
  useUpdateOrganizationContent,
} from '@/features/relay/queries';
import { youtubeVideoId } from '@/features/relay/youtube-video';
import { colors, radii, spacing } from '@/theme/tokens';

type PendingFile = {
  id: string;
  title: string;
  file: DocumentPicker.DocumentPickerAsset;
};

export default function ManageOrganizationScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const organization = useOrganization(organizationId);
  const continuity = useContinuity(organizationId);

  if (organization.isPending || continuity.isPending) return <Screen><LoadingState label="Opening organization settings…" /></Screen>;
  if (organization.error || continuity.error || !organization.data || !continuity.data?.isOwner) {
    return (
      <Screen>
        <MessageState
          icon="shield-lock-outline"
          title="Owner access required"
          body="Only the Organization Owner can manage this page."
          actionLabel="Return to organization"
          onAction={() => router.replace(`/organization/${organizationId}` as Href)}
        />
      </Screen>
    );
  }

  return <ManageOrganizationForm key={organization.data.updatedAt} organizationId={organizationId} />;
}

function ManageOrganizationForm({ organizationId }: { organizationId: string }) {
  const organization = useOrganization(organizationId);
  const continuity = useContinuity(organizationId);
  const requests = usePendingMembershipRequests(organizationId, continuity.data?.isOwner === true);
  const update = useUpdateOrganizationContent();
  const decide = useDecideOrganizationMembershipRequest();
  const [description, setDescription] = useState(organization.data?.description ?? '');
  const [youtubeUrl, setYoutubeUrl] = useState(organization.data?.youtubeVideoUrl ?? '');
  const [addingFile, setAddingFile] = useState(false);
  const [fileTitle, setFileTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [removedFileIds, setRemovedFileIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!organization.data || !continuity.data) return <Screen><LoadingState label="Opening organization settings…" /></Screen>;

  async function choosePdf() {
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    const file = result.assets[0];
    if (file.size && file.size > 25 * 1024 * 1024) {
      setValidationError('Choose a PDF smaller than 25 MB.');
      return;
    }
    setValidationError(null);
    setSelectedFile(file);
  }

  function attachPdf() {
    const title = fileTitle.trim();
    if (!title) return setValidationError('Enter a title for this file.');
    if (title.length > 120) return setValidationError('Keep the file title under 120 characters.');
    if (!selectedFile) return setValidationError('Choose a PDF to attach.');
    setPendingFiles((current) => [...current, { id: Crypto.randomUUID(), title, file: selectedFile }]);
    setFileTitle('');
    setSelectedFile(null);
    setAddingFile(false);
    setValidationError(null);
  }

  async function save() {
    setValidationError(null);
    const trimmedUrl = youtubeUrl.trim();
    if (description.trim().length > 800) return setValidationError('Keep the organization description under 800 characters.');
    if (trimmedUrl && !youtubeVideoId(trimmedUrl)) return setValidationError('Enter a valid YouTube video link.');
    try {
      await update.mutateAsync({
        organizationId,
        description,
        youtubeVideoUrl: trimmedUrl || null,
        addedFiles: pendingFiles.map((pending) => ({
          title: pending.title,
          file: {
            uri: pending.file.uri,
            name: pending.file.name,
            mimeType: pending.file.mimeType,
            size: pending.file.size,
          },
        })),
        removedFileIds,
      });
      router.replace(`/organization/${organizationId}` as Href);
    } catch {
      // The mutation exposes its safe error in the form.
    }
  }

  const existingFiles = organization.data.files.filter((file) => !removedFileIds.includes(file.id));

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="display">Manage organization</AppText>
        <AppText color={colors.inkMuted}>Maintain the information every accepted member sees.</AppText>
      </View>

      <View style={styles.editorSection}>
        <FormInput
          label="About the organization"
          multiline
          maxLength={800}
          value={description}
          onChangeText={setDescription}
          placeholder="What the organization does, who it serves, and what members should know"
        />
        <FormInput
          label="YouTube promotional video"
          optional
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={youtubeUrl}
          onChangeText={setYoutubeUrl}
          placeholder="https://www.youtube.com/watch?v=…"
        />
      </View>

      <View style={styles.editorSection}>
        <View style={styles.sectionHeading}>
          <AppText variant="heading">Organization files</AppText>
        </View>

        {existingFiles.map((file) => (
          <OrganizationFileRow
            fileName={file.fileName}
            key={file.id}
            onRemove={() => setRemovedFileIds((current) => [...current, file.id])}
            title={file.title}
            uri={file.url}
          />
        ))}
        {pendingFiles.map((pending) => (
          <OrganizationFileRow
            fileName={pending.file.name}
            key={pending.id}
            onRemove={() => setPendingFiles((current) => current.filter((file) => file.id !== pending.id))}
            title={pending.title}
            uri={pending.file.uri}
          />
        ))}
        {!existingFiles.length && !pendingFiles.length ? (
          <AppText color={colors.inkMuted}>No files added yet.</AppText>
        ) : null}

        {addingFile ? (
          <View style={styles.addFileFields}>
            <FormInput
              label="File title"
              maxLength={120}
              onChangeText={setFileTitle}
              placeholder="Constitution, safety guidance, member handbook…"
              value={fileTitle}
            />
            <Button
              icon="file-pdf-box"
              label={selectedFile?.name ?? 'Choose PDF'}
              tone="secondary"
              onPress={() => void choosePdf()}
            />
            <View style={styles.addFileActions}>
              <Button label="Cancel" tone="ghost" onPress={() => {
                setAddingFile(false);
                setFileTitle('');
                setSelectedFile(null);
              }} />
              <Button label="Attach file" onPress={attachPdf} />
            </View>
          </View>
        ) : (
          <Button icon="paperclip" label="Add file" tone="secondary" onPress={() => setAddingFile(true)} />
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <AppText variant="heading">Current committee</AppText>
        </View>
        <View style={styles.list}>
          {continuity.data.roles.map((role) => {
            const holder = role.assignments[0];
            return (
              <View key={role.roleId} style={styles.row}>
                <View style={styles.rowCopy}>
                  <AppText variant="label">{role.title}</AppText>
                  <AppText variant="caption" color={colors.inkMuted}>
                    {holder ? `${holder.name || 'Assigned member'} · ${holder.servicePeriod}` : 'No current holder'}
                  </AppText>
                </View>
              </View>
            );
          })}
        </View>
        <Button icon="plus" label="Add role" tone="secondary" onPress={() => router.push(`/role-new?organizationId=${organizationId}` as Href)} />
      </View>

      {validationError || update.error ? (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <MaterialCommunityIcons color={colors.emergency} name="alert-circle-outline" size={18} />
          <AppText variant="caption" color={colors.emergency} style={styles.flex}>
            {validationError ?? update.error?.message}
          </AppText>
        </View>
      ) : null}

      <Button disabled={update.isPending} label={update.isPending ? 'Saving…' : 'Save organization page'} onPress={() => void save()} />

      <View style={styles.section}>
        <View style={styles.sectionHeading}>
          <AppText variant="heading">Membership requests</AppText>
          <AppText color={colors.inkMuted}>Accepting someone adds them as a Member.</AppText>
        </View>
        {requests.isPending ? <LoadingState label="Loading requests…" /> : null}
        {requests.data?.length ? (
          <View style={styles.list}>
            {requests.data.map((request) => (
              <View key={request.requestId} style={styles.requestCard}>
                <View style={styles.rowCopy}>
                  <AppText variant="label">{request.name || 'Relay member'}</AppText>
                  <AppText variant="caption" color={colors.inkMuted}>
                    Requested {new Date(request.requestedAt).toLocaleDateString()}
                  </AppText>
                </View>
                <View style={styles.requestActions}>
                  <Button
                    disabled={decide.isPending}
                    label="Accept"
                    onPress={() => decide.mutate({ requestId: request.requestId, decision: 'accepted', organizationId })}
                  />
                  <Button
                    disabled={decide.isPending}
                    label="Reject"
                    tone="ghost"
                    onPress={() => decide.mutate({ requestId: request.requestId, decision: 'rejected', organizationId })}
                  />
                </View>
              </View>
            ))}
          </View>
        ) : !requests.isPending ? <AppText color={colors.inkMuted}>No pending membership requests.</AppText> : null}
        {requests.error || decide.error ? (
          <AppText variant="caption" color={colors.emergency}>{requests.error?.message ?? decide.error?.message}</AppText>
        ) : null}
      </View>

      <Button
        label="Organization ownership"
        tone="secondary"
        onPress={() => router.push(`/ownership-transfer?organizationId=${organizationId}` as Href)}
      />
    </Screen>
  );
}

function OrganizationFileRow({ title, fileName, uri, onRemove }: {
  title: string;
  fileName: string;
  uri: string | null;
  onRemove: () => void;
}) {
  return (
    <View style={styles.fileRow}>
      <MaterialCommunityIcons color={colors.emergency} name="file-pdf-box" size={25} />
      <View style={styles.fileTextRow}>
        <AppText variant="label">{title}</AppText>
        <AppText variant="caption" color={colors.inkMuted}>—</AppText>
        <Pressable disabled={!uri} onPress={uri ? () => void Linking.openURL(uri) : undefined}>
          <AppText variant="caption" color={colors.moss} style={styles.fileLink}>{fileName}</AppText>
        </Pressable>
      </View>
      <Pressable accessibilityLabel={`Remove ${title}`} accessibilityRole="button" onPress={onRemove} style={styles.removeFile}>
        <MaterialCommunityIcons color={colors.inkMuted} name="close" size={21} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginBottom: spacing.md },
  editorSection: {
    gap: spacing.md, marginTop: spacing.md, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  section: {
    gap: spacing.md, marginTop: spacing.lg, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface,
  },
  sectionHeading: { gap: spacing.xxs },
  list: { gap: spacing.sm },
  row: {
    minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas,
  },
  rowCopy: { flex: 1, gap: spacing.xxs },
  fileRow: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  fileTextRow: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  fileLink: { textDecorationLine: 'underline' },
  removeFile: { padding: spacing.xs },
  addFileFields: { gap: spacing.md, paddingTop: spacing.xs },
  addFileActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xs },
  requestCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  requestActions: { gap: spacing.xs },
  error: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs,
    marginVertical: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: '#FFF4F1',
  },
  flex: { flex: 1 },
});
