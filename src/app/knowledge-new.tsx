import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';

import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Screen } from '@/components/ui/screen';
import { KnowledgeEditor, type KnowledgeEditorValues } from '@/features/relay/knowledge-editor';
import { useCreateManualKnowledgeItem, useHandoff, useRole } from '@/features/relay/queries';

export default function CreateKnowledgeScreen() {
  const { handoffId } = useLocalSearchParams<{ handoffId: string }>();
  const handoffQuery = useHandoff(handoffId);
  const roleQuery = useRole(handoffQuery.data?.roleId);
  const mutation = useCreateManualKnowledgeItem();

  if (!handoffId) {
    return <Screen><MessageState icon="alert-circle-outline" title="Choose a handoff first" body="Knowledge must belong to a handoff." /></Screen>;
  }
  if (handoffQuery.isPending || (handoffQuery.data && roleQuery.isPending)) {
    return <Screen><LoadingState label="Opening editor…" /></Screen>;
  }
  if (handoffQuery.error || roleQuery.error || !handoffQuery.data || !roleQuery.data) {
    return (
      <Screen>
        <MessageState
          icon="file-document-alert-outline"
          title="Handoff unavailable"
          body={(handoffQuery.error ?? roleQuery.error)?.message ?? 'This handoff could not be opened.'}
        />
      </Screen>
    );
  }

  async function submit(values: KnowledgeEditorValues) {
    await mutation.mutateAsync({
      organizationId: handoffQuery.data!.organizationId,
      handoffId,
      ...values,
    });
    router.replace((`/handoff/${handoffId}`) as Href);
  }

  return (
    <KnowledgeEditor
      eyebrow={roleQuery.data.title}
      title="Add approved knowledge"
      description="Use this when you already know exactly what the next leader should receive."
      defaultValues={{ knowledgeType: 'responsibility', title: '', content: '' }}
      error={mutation.error?.message}
      isPending={mutation.isPending}
      submitLabel="Add to handoff"
      onSubmit={submit}
    />
  );
}
