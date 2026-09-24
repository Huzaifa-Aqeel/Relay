import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';

import { LoadingState, MessageState } from '@/components/ui/async-state';
import { Screen } from '@/components/ui/screen';
import { KnowledgeEditor, type KnowledgeEditorValues } from '@/features/relay/knowledge-editor';
import { usePreflightFindings, useResolvePreflightFinding } from '@/features/relay/queries';
import { broadKnowledgeType } from '@/features/relay/types';

export default function ResolvePreflightFindingScreen() {
  const { handoffId, runId, findingId } = useLocalSearchParams<{
    handoffId?: string;
    runId?: string;
    findingId?: string;
  }>();
  const findingsQuery = usePreflightFindings(runId);
  const resolveMutation = useResolvePreflightFinding();

  if (!handoffId || !runId || !findingId) {
    return (
      <Screen>
        <MessageState
          icon="shield-alert-outline"
          title="Finding unavailable"
          body="Open this resolution from a handoff-check finding."
        />
      </Screen>
    );
  }
  if (findingsQuery.isPending) {
    return <Screen><LoadingState label="Opening the question…" /></Screen>;
  }

  const finding = findingsQuery.data?.find((item) => item.id === findingId);
  if (findingsQuery.error || !finding) {
    return (
      <Screen>
        <MessageState
          icon="shield-alert-outline"
          title="Finding unavailable"
          body={findingsQuery.error?.message ?? 'This finding no longer exists or you do not have access.'}
        />
      </Screen>
    );
  }

  const targetHandoffId = handoffId;
  const targetRunId = runId;
  const targetFindingId = findingId;

  async function submit(values: KnowledgeEditorValues) {
    await resolveMutation.mutateAsync({
      findingId: targetFindingId,
      runId: targetRunId,
      handoffId: targetHandoffId,
      knowledgeItemId: null,
      ...values,
    });
    router.replace((`/handoff-preflight?handoffId=${targetHandoffId}`) as Href);
  }

  return (
    <KnowledgeEditor
      eyebrow={`${finding.severity} handoff-check finding`}
      title="Turn the answer into approved knowledge"
      description={`${finding.question} Your answer becomes part of the handoff. Relay will ask you to check it again so readiness reflects the change.`}
      defaultValues={{
        knowledgeType: finding.suggestedKnowledgeType
          ? broadKnowledgeType(finding.suggestedKnowledgeType)
          : 'process',
        title: finding.title,
        content: '',
      }}
      error={resolveMutation.error?.message}
      isPending={resolveMutation.isPending}
      submitLabel="Resolve with this answer"
      onSubmit={submit}
    />
  );
}
