import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';

import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Screen } from '@/components/ui/screen';
import { KnowledgeEditor, type KnowledgeEditorValues } from '@/features/relay/knowledge-editor';
import { broadKnowledgeType } from '@/features/relay/types';
import {
  useDeleteKnowledgeItem,
  useKnowledgeItem,
  useResolvePreflightFinding,
  useUpdateKnowledgeItem,
} from '@/features/relay/queries';

export default function EditKnowledgeScreen() {
  const { id, returnTo, findingId, runId } = useLocalSearchParams<{
    id: string;
    returnTo?: string;
    findingId?: string;
    runId?: string;
  }>();
  const itemQuery = useKnowledgeItem(id);
  const updateMutation = useUpdateKnowledgeItem();
  const deleteMutation = useDeleteKnowledgeItem();
  const resolveMutation = useResolvePreflightFinding();

  if (itemQuery.isPending) return <Screen><LoadingState label="Opening knowledge…" /></Screen>;
  if (itemQuery.error || !itemQuery.data) {
    return (
      <Screen>
        <MessageState
          icon="text-box-remove-outline"
          title="Knowledge unavailable"
          body={itemQuery.error?.message ?? 'This item no longer exists or you do not have access.'}
        />
      </Screen>
    );
  }

  const item = itemQuery.data;
  const destination = returnTo === 'review'
    ? (`/handoff-review?handoffId=${item.handoffId}`) as Href
    : returnTo === 'preflight'
      ? (`/handoff-preflight?handoffId=${item.handoffId}`) as Href
      : (`/handoff/${item.handoffId}`) as Href;
  async function submit(values: KnowledgeEditorValues) {
    if (returnTo === 'preflight' && findingId && runId) {
      await resolveMutation.mutateAsync({
        findingId,
        runId,
        handoffId: item.handoffId,
        knowledgeItemId: item.id,
        ...values,
      });
    } else {
      await updateMutation.mutateAsync({ id: item.id, handoffId: item.handoffId, input: values });
    }
    router.replace(destination);
  }
  function confirmDelete() {
    Alert.alert(
      'Delete this knowledge?',
      'It will be removed from the draft. This does not delete any original source.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteMutation.mutateAsync({ id: item.id, handoffId: item.handoffId });
            router.replace(destination);
          },
        },
      ],
    );
  }

  return (
    <KnowledgeEditor
      eyebrow={`${item.status} · ${item.origin}`}
      title="Edit knowledge"
      description="Keep the instruction accurate, actionable, and easy for a new leader to scan."
      defaultValues={{ knowledgeType: broadKnowledgeType(item.knowledgeType), title: item.title, content: item.content }}
      error={updateMutation.error?.message ?? resolveMutation.error?.message ?? deleteMutation.error?.message}
      isPending={updateMutation.isPending || resolveMutation.isPending}
      isDeleting={deleteMutation.isPending}
      submitLabel="Save changes"
      onDelete={item.origin === 'manual' && returnTo !== 'preflight' ? confirmDelete : undefined}
      onSubmit={submit}
    />
  );
}
