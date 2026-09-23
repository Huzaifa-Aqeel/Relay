import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { AppText } from '@/components/ui/app-text';
import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { HandoffDocument } from '@/features/relay/handoff-document';
import {
  useHandoff,
  useHandoffPublication,
  useHandoffPublicationItems,
  useKnowledgeItems,
  useOrganization,
  usePublishHandoff,
  useReplaceHandoffLink,
  useRevokeHandoffLink,
  useRole,
} from '@/features/relay/queries';
import { sharedHandoffUrl } from '@/features/relay/share-link';
import type { PublishedHandoffItem } from '@/features/relay/types';
import { colors, radii, spacing } from '@/theme/tokens';

function confirmAction(title: string, message: string, actionLabel: string, destructive: boolean, action: () => void) {
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${message}`)) action();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: actionLabel, style: destructive ? 'destructive' : 'default', onPress: action },
  ]);
}

export default function HandoffPreviewScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId?: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const organizationQuery = useOrganization(handoffQuery.data?.organizationId);
  const knowledgeQuery = useKnowledgeItems(handoffId);
  const publicationQuery = useHandoffPublication(handoffId);
  const publicationItemsQuery = useHandoffPublicationItems(publicationQuery.data?.id);
  const publishMutation = usePublishHandoff();
  const revokeMutation = useRevokeHandoffLink();
  const replaceMutation = useReplaceHandoffLink();
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);

  const pending = handoffQuery.isPending
    || knowledgeQuery.isPending
    || publicationQuery.isPending
    || (handoffQuery.data?.status === 'published' && publicationQuery.isFetching)
    || (handoffQuery.data && (roleQuery.isPending || organizationQuery.isPending))
    || (publicationQuery.data && publicationItemsQuery.isPending);
  const error = handoffQuery.error
    ?? roleQuery.error
    ?? organizationQuery.error
    ?? knowledgeQuery.error
    ?? publicationQuery.error
    ?? publicationItemsQuery.error;

  if (!handoffId) {
    return <Screen><MessageState icon="eye-off-outline" title="Preview unavailable" body="Choose a handoff before opening Preview." /></Screen>;
  }
  if (pending) return <Screen><LoadingState label="Building the exact recipient preview…" /></Screen>;
  if (error || !handoffQuery.data || !roleQuery.data || !organizationQuery.data || !knowledgeQuery.data) {
    return <Screen><MessageState icon="eye-off-outline" title="Preview unavailable" body={error?.message ?? 'This handoff could not be previewed.'} /></Screen>;
  }

  const targetHandoffId = handoffId;
  const handoff = handoffQuery.data;
  const publication = publicationQuery.data;
  const isPublished = handoff.status === 'published';
  if (isPublished && !publication) {
    return (
      <Screen>
        <MessageState
          icon="link-variant-off"
          title="Published snapshot unavailable"
          body="Relay could not verify the recipient snapshot. Return to the handoff and try again."
          actionLabel="Back to handoff"
          onAction={() => router.replace((`/handoff/${targetHandoffId}`) as Href)}
        />
      </Screen>
    );
  }
  const draftItems: PublishedHandoffItem[] = knowledgeQuery.data
    .filter((item) => item.status === 'approved')
    .map((item) => ({
      id: item.id,
      knowledgeType: item.knowledgeType,
      title: item.title,
      content: item.content,
      sortOrder: item.sortOrder,
    }));
  const items = isPublished ? publicationItemsQuery.data ?? [] : draftItems;
  const documentData = publication && isPublished ? {
    organizationName: publication.organizationName,
    organizationInstitution: publication.organizationInstitution,
    roleTitle: publication.roleTitle,
    roleDescription: publication.roleDescription,
    servicePeriod: publication.servicePeriod,
    publishedAt: publication.publishedAt,
  } : {
    organizationName: organizationQuery.data.name,
    organizationInstitution: organizationQuery.data.institution,
    roleTitle: roleQuery.data.title,
    roleDescription: roleQuery.data.description,
    servicePeriod: handoff.servicePeriod,
    publishedAt: null,
  };
  const shareUrl = publication?.status === 'active' ? sharedHandoffUrl(publication.accessToken) : null;
  const mutating = publishMutation.isPending || revokeMutation.isPending || replaceMutation.isPending;
  const mutationError = publishMutation.error ?? revokeMutation.error ?? replaceMutation.error;

  function publish() {
    confirmAction(
      'Publish this handoff?',
      'Relay will create a recipient snapshot containing only the approved knowledge shown above. Anyone with its unguessable link can open it without signing in.',
      'Publish handoff',
      false,
      () => publishMutation.mutate({ handoffId: targetHandoffId }),
    );
  }

  function revoke() {
    confirmAction(
      'Revoke this link?',
      'The recipient page will stop opening immediately. The underlying handoff and its published snapshot will remain safe.',
      'Revoke link',
      true,
      () => revokeMutation.mutate({ handoffId: targetHandoffId }),
    );
  }

  function replaceLink() {
    confirmAction(
      publication?.status === 'revoked' ? 'Create a new link?' : 'Replace the current link?',
      'The previous link will no longer open. Relay will keep the same approved published snapshot.',
      publication?.status === 'revoked' ? 'Create link' : 'Replace link',
      publication?.status !== 'revoked',
      () => replaceMutation.mutate({ handoffId: targetHandoffId }),
    );
  }

  async function copyLink() {
    if (!shareUrl) return;
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
  }

  async function shareLink() {
    if (!shareUrl) return;
    await Share.share({ message: `${documentData.roleTitle} handoff from ${documentData.organizationName}\n${shareUrl}` });
  }

  if (!isPublished && handoff.stage !== 'preview') {
    return (
      <Screen>
        <MessageState
          icon="shield-check-outline"
          title="Finish the handoff check first"
          body="Exact Preview becomes available after the latest handoff-check decision."
          actionLabel="Open handoff check"
          onAction={() => router.replace((`/handoff-preflight?handoffId=${handoffId}`) as Href)}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.heading}>
        <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>{isPublished ? 'PUBLISHED HANDOFF' : 'PREVIEW BEFORE PUBLISHING'}</AppText>
        <AppText variant="display">See exactly what they’ll receive</AppText>
        <AppText color={colors.inkMuted}>The recipient page below uses the same layout and snapshot data as the public link.</AppText>
      </View>

      <HandoffDocument {...documentData} items={items} preview />

      {!isPublished ? (
        <View style={styles.publishCard}>
          <View style={styles.cardIcon}><MaterialCommunityIcons color={colors.moss} name="publish" size={29} /></View>
          <AppText variant="caption" color={colors.moss} style={styles.eyebrow}>READY TO PUBLISH</AppText>
          <AppText variant="heading">Prepare to transfer the Role</AppText>
          <AppText color={colors.inkMuted}>Publish when preparing a leadership transition. Early publication and deliberate republication are available when plans change.</AppText>
          <AppText color={colors.inkMuted}>Publishing includes these {items.length} approved items. Private captures, files, rejected suggestions, and handoff-check details stay private.</AppText>
          <Button disabled={mutating} icon="publish" label={publishMutation.isPending ? 'Publishing…' : 'Publish and create link'} onPress={publish} />
        </View>
      ) : null}

      {isPublished && publication ? (
        <View style={styles.shareCard}>
          <View style={styles.shareHeading}>
            <View style={[styles.cardIcon, publication.status === 'revoked' && styles.revokedIcon]}>
              <MaterialCommunityIcons color={publication.status === 'active' ? colors.moss : colors.emergency} name={publication.status === 'active' ? 'link-variant' : 'link-variant-off'} size={29} />
            </View>
            <View style={styles.flex}>
              <AppText variant="caption" color={publication.status === 'active' ? colors.moss : colors.emergency} style={styles.eyebrow}>
                {publication.status === 'active' ? 'RECIPIENT LINK ACTIVE' : 'RECIPIENT LINK REVOKED'}
              </AppText>
              <AppText variant="heading">{publication.status === 'active' ? 'Share this Handoff' : 'The published snapshot is still safe'}</AppText>
            </View>
          </View>

          {publication.status === 'active' && shareUrl ? (
            <>
              <View style={styles.linkBox}><AppText selectable variant="caption" color={colors.inkMuted}>{shareUrl}</AppText></View>
              <View style={styles.actions}>
                <Button style={styles.flex} disabled={mutating} icon={copied ? 'check' : 'content-copy'} label={copied ? 'Copied' : 'Copy link'} tone="secondary" onPress={() => void copyLink()} />
                <Button style={styles.flex} disabled={mutating} icon="share-variant-outline" label="Share" onPress={() => void shareLink()} />
              </View>
              <Button icon="qrcode" label={showQr ? 'Hide QR code' : 'Show QR code'} tone="ghost" onPress={() => setShowQr((current) => !current)} />
              {showQr ? (
                <View style={styles.qrCard}>
                  <View accessibilityLabel={`QR code for the ${documentData.roleTitle} handoff`} style={styles.qrSurface}>
                    <QRCode value={shareUrl} size={220} color={colors.ink} backgroundColor={colors.white} />
                  </View>
                  <AppText variant="caption" color={colors.inkMuted} style={styles.center}>Scanning opens this same Handoff in a browser. No Relay account is required.</AppText>
                </View>
              ) : null}
              <Button disabled={mutating} icon="link-variant-off" label="Revoke link" tone="emergency" onPress={revoke} />
              <Button disabled={mutating} icon="link-variant-plus" label="Replace compromised link" tone="ghost" onPress={replaceLink} />
            </>
          ) : publication.status === 'active' ? (
            <View style={styles.configurationNotice}>
              <MaterialCommunityIcons color={colors.saffron} name="web-off" size={23} />
              <AppText color={colors.inkMuted} style={styles.flex}>Add the deployed Relay web address to this native build before distributing its recipient link.</AppText>
            </View>
          ) : (
            <>
              <AppText color={colors.inkMuted}>Recipients using the old link now see only an unavailable message. Create a new link when you are ready to share this unchanged snapshot again.</AppText>
              <Button disabled={mutating} icon="link-variant-plus" label={replaceMutation.isPending ? 'Creating link…' : 'Create a new link'} onPress={replaceLink} />
            </>
          )}
        </View>
      ) : null}

      {mutationError ? <AppText accessibilityLiveRegion="polite" variant="caption" color={colors.emergency}>{mutationError.message}</AppText> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: spacing.xs, marginTop: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.1 },
  flex: { flex: 1 },
  publishCard: { gap: spacing.md, marginTop: spacing.xxl, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.mossSoft },
  shareCard: { gap: spacing.md, marginTop: spacing.xxl, padding: spacing.lg, borderWidth: 1, borderColor: colors.line, borderRadius: radii.lg, backgroundColor: colors.surface },
  shareHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surface },
  revokedIcon: { backgroundColor: '#F8E5E1' },
  linkBox: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.canvas },
  actions: { flexDirection: 'row', gap: spacing.sm },
  qrCard: { alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.canvas },
  qrSurface: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.white },
  center: { textAlign: 'center' },
  configurationNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.saffronSoft },
});
