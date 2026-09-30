import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useEffect } from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import { requireSupabase } from '@/lib/supabase';
import {
  beginHandoffReview,
  advanceHandoffToPreview,
  askRelay,
  createHandoff,
  createCaptureDraft,
  createOrganization,
  createRole,
  updateRole,
  compareRoleHandoffs,
  deleteKnowledgeItem,
  decideKnowledgeProposal,
  getHandoff,
  getRelayAccess,
  getHandoffPublication,
  getHandoffSource,
  findExactDocumentDuplicate,
  getSharedHandoff,
  generateCaptureProposals,
  getKnowledgeItem,
  getLatestRoleMemoryComparison,
  getOrganization,
  getOrganizationPlan,
  getRole,
  listHandoffSources,
  listHandoffCaptures,
  listHandoffPublicationItems,
  listKnowledgeItems,
  listKnowledgeProvenance,
  listMemoryRoles,
  listMyAssignedRoles,
  listOrganizationHandoffs,
  listOrganizations,
  listMyMembershipRequests,
  listPendingMembershipRequests,
  listRoleHandoffs,
  listRolePublications,
  listRoleMemoryChanges,
  listRoles,
  moveKnowledgeItem,
  publishHandoff,
  replaceHandoffLink,
  revokeHandoffLink,
  returnHandoffToCapture,
  submitCapture,
  discardCaptureDraft,
  transcribeVoiceRecording,
  updateKnowledgeItem,
  updateOrganizationContent,
  searchOrganizationsForMembership,
  requestOrganizationMembership,
  decideOrganizationMembershipRequest,
} from '@/features/relay/repository';
import type {
  HandoffInput,
  CaptureDraftInput,
  CaptureInput,
  DocumentDuplicateCheckInput,
  KnowledgeItemUpdateInput,
  OrganizationInput,
  OrganizationContentInput,
  RoleInput,
  RoleUpdateInput,
  VoiceRecordingInput,
} from '@/features/relay/types';

export const relayKeys = {
  access: ['relay', 'access'] as const,
  assignedRoles: ['relay', 'assigned-roles'] as const,
  organizations: ['relay', 'organizations'] as const,
  membershipRequests: ['relay', 'membership-requests'] as const,
  pendingMembershipRequests: (organizationId: string) => ['relay', 'pending-membership-requests', organizationId] as const,
  organization: (id: string) => ['relay', 'organization', id] as const,
  organizationPlan: (id: string) => ['relay', 'organization-plan', id] as const,
  roles: (organizationId: string) => ['relay', 'roles', organizationId] as const,
  role: (id: string) => ['relay', 'role', id] as const,
  organizationHandoffs: (organizationId: string) => ['relay', 'organization-handoffs', organizationId] as const,
  roleHandoffs: (roleId: string) => ['relay', 'role-handoffs', roleId] as const,
  handoff: (id: string) => ['relay', 'handoff', id] as const,
  handoffSources: (handoffId: string) => ['relay', 'handoff-sources', handoffId] as const,
  handoffCaptures: (handoffId: string) => ['relay', 'handoff-captures', handoffId] as const,
  knowledgeItems: (handoffId: string) => ['relay', 'knowledge-items', handoffId] as const,
  knowledgeItem: (id: string) => ['relay', 'knowledge-item', id] as const,
  source: (id: string) => ['relay', 'source', id] as const,
  knowledgeProvenance: (handoffId: string) => ['relay', 'knowledge-provenance', handoffId] as const,
  publication: (handoffId: string) => ['relay', 'publication', handoffId] as const,
  publicationItems: (publicationId: string) => ['relay', 'publication-items', publicationId] as const,
  sharedHandoff: (token: string) => ['relay', 'shared-handoff', token] as const,
  memoryRoles: ['relay', 'memory-roles'] as const,
  roleMemoryComparison: (roleId: string) => ['relay', 'role-memory-comparison', roleId] as const,
  roleMemoryChanges: (comparisonId: string) => ['relay', 'role-memory-changes', comparisonId] as const,
};

function realtimeTopic(scope: string, id: string) {
  return `${scope}:${id}:${Crypto.randomUUID()}`;
}

function useCloudQueryEnabled(extra = true) {
  const { isCloudEnabled, status } = useAuth();
  return isCloudEnabled && status === 'authenticated' && extra;
}

export function useOrganizations() {
  return useQuery({ queryKey: relayKeys.organizations, queryFn: listOrganizations, enabled: useCloudQueryEnabled() });
}

export function useRelayAccess() {
  return useQuery({ queryKey: relayKeys.access, queryFn: getRelayAccess, enabled: useCloudQueryEnabled() });
}

export function useMyAssignedRoles() {
  return useQuery({
    queryKey: relayKeys.assignedRoles,
    queryFn: listMyAssignedRoles,
    enabled: useCloudQueryEnabled(),
  });
}

export function useMyMembershipRequests() {
  return useQuery({
    queryKey: relayKeys.membershipRequests,
    queryFn: listMyMembershipRequests,
    enabled: useCloudQueryEnabled(),
  });
}

export function useSearchOrganizationsForMembership() {
  return useMutation({ mutationFn: searchOrganizationsForMembership });
}

export function useRequestOrganizationMembership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: requestOrganizationMembership,
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.membershipRequests }),
      queryClient.invalidateQueries({ queryKey: relayKeys.access }),
    ]),
  });
}

export function usePendingMembershipRequests(organizationId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: relayKeys.pendingMembershipRequests(organizationId ?? ''),
    queryFn: () => listPendingMembershipRequests(organizationId!),
    enabled: useCloudQueryEnabled(Boolean(organizationId) && enabled),
  });
}

export function useDecideOrganizationMembershipRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, decision }: { requestId: string; decision: 'accepted' | 'rejected'; organizationId: string }) =>
      decideOrganizationMembershipRequest(requestId, decision),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.pendingMembershipRequests(variables.organizationId) }),
      queryClient.invalidateQueries({ queryKey: ['relay', 'continuity', variables.organizationId] }),
    ]),
  });
}

export function useUpdateOrganizationContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OrganizationContentInput) => updateOrganizationContent(input),
    onSuccess: (_, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.organization(input.organizationId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.organizations }),
    ]),
  });
}

export function useOrganization(id: string | undefined) {
  return useQuery({
    queryKey: relayKeys.organization(id ?? ''),
    queryFn: () => getOrganization(id!),
    enabled: useCloudQueryEnabled(Boolean(id)),
  });
}

export function useOrganizationPlan(organizationId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.organizationPlan(organizationId ?? ''),
    queryFn: () => getOrganizationPlan(organizationId!),
    enabled: useCloudQueryEnabled(Boolean(organizationId)),
  });
}

export function useRoles(organizationId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.roles(organizationId ?? ''),
    queryFn: () => listRoles(organizationId!),
    enabled: useCloudQueryEnabled(Boolean(organizationId)),
  });
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: relayKeys.role(id ?? ''),
    queryFn: () => getRole(id!),
    enabled: useCloudQueryEnabled(Boolean(id)),
  });
}

export function useOrganizationHandoffs(organizationId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.organizationHandoffs(organizationId ?? ''),
    queryFn: () => listOrganizationHandoffs(organizationId!),
    enabled: useCloudQueryEnabled(Boolean(organizationId)),
  });
}

export function useRoleHandoffs(roleId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.roleHandoffs(roleId ?? ''),
    queryFn: () => listRoleHandoffs(roleId!),
    enabled: useCloudQueryEnabled(Boolean(roleId)),
  });
}

export function useHandoff(id: string | undefined) {
  return useQuery({
    queryKey: relayKeys.handoff(id ?? ''),
    queryFn: () => getHandoff(id!),
    enabled: useCloudQueryEnabled(Boolean(id)),
  });
}

export function useRolePublications(roleId: string | undefined) {
  return useQuery({ queryKey: ['relay','role-publications',roleId], queryFn: () => listRolePublications(roleId!), enabled: useCloudQueryEnabled(Boolean(roleId)) });
}

export function useHandoffSources(handoffId: string | undefined) {
  const enabled = useCloudQueryEnabled(Boolean(handoffId));
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !handoffId) return;
    const client = requireSupabase();
    const channel = client
      .channel(realtimeTopic('handoff-sources', handoffId))
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sources', filter: `handoff_id=eq.${handoffId}` },
        () => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: relayKeys.handoffSources(handoffId) }),
            queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(handoffId) }),
            queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeProvenance(handoffId) }),
          ]);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void queryClient.invalidateQueries({ queryKey: relayKeys.handoffSources(handoffId) });
        }
      });
    return () => { void client.removeChannel(channel); };
  }, [enabled, handoffId, queryClient]);

  return useQuery({
    queryKey: relayKeys.handoffSources(handoffId ?? ''),
    queryFn: () => listHandoffSources(handoffId!),
    enabled,
  });
}

export function useHandoffCaptures(handoffId: string | undefined) {
  const enabled = useCloudQueryEnabled(Boolean(handoffId));
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !handoffId) return;
    const client = requireSupabase();
    const refresh = () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: relayKeys.handoffCaptures(handoffId) }),
        queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(handoffId) }),
        queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeProvenance(handoffId) }),
      ]);
    };
    const channel = client
      .channel(realtimeTopic('handoff-captures', handoffId))
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'captures', filter: `handoff_id=eq.${handoffId}`,
      }, refresh)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'sources', filter: `handoff_id=eq.${handoffId}`,
      }, refresh)
      .subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
    return () => { void client.removeChannel(channel); };
  }, [enabled, handoffId, queryClient]);
  const query = useQuery({
    queryKey: relayKeys.handoffCaptures(handoffId ?? ''),
    queryFn: () => listHandoffCaptures(handoffId!),
    enabled,
  });
  useEffect(() => {
    if (!enabled || !handoffId || !query.data) return;
    const leaseExpirations = query.data.flatMap((capture) => [
      ...(capture.structuringStatus === 'processing'
        ? [Date.parse(capture.updatedAt) + (3 * 60_000)]
        : []),
      ...capture.attachments
        .filter((source) => source.processingStatus === 'processing')
        .map((source) => Date.parse(source.updatedAt) + (10 * 60_000)),
    ]).filter(Number.isFinite);
    if (!leaseExpirations.length) return;

    // Re-read once just after the applicable model/document lease expires.
    // The normal query invokes the authorized stale-work sweep, so a worker
    // that disappeared without emitting Realtime cannot leave an open UI
    // spinning forever. This is lease expiry, not continuous polling.
    const nextLeaseExpiry = Math.min(...leaseExpirations) + 2_000;
    const timer = setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: relayKeys.handoffCaptures(handoffId) });
    }, Math.max(1_000, nextLeaseExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [enabled, handoffId, query.data, queryClient]);
  return query;
}

export function useHandoffSource(id: string | undefined) {
  const enabled = useCloudQueryEnabled(Boolean(id));
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !id) return;
    const client = requireSupabase();
    const channel = client
      .channel(realtimeTopic('source', id))
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sources', filter: `id=eq.${id}` },
        (payload) => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: relayKeys.source(id) }),
          ]);
          const handoffId = typeof payload.new?.handoff_id === 'string' ? payload.new.handoff_id : null;
          if (handoffId) {
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: relayKeys.handoffSources(handoffId) }),
              queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(handoffId) }),
              queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeProvenance(handoffId) }),
            ]);
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void queryClient.invalidateQueries({ queryKey: relayKeys.source(id) });
      });
    return () => { void client.removeChannel(channel); };
  }, [enabled, id, queryClient]);

  return useQuery({
    queryKey: relayKeys.source(id ?? ''),
    queryFn: () => getHandoffSource(id!),
    enabled,
  });
}

export function useKnowledgeItems(handoffId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.knowledgeItems(handoffId ?? ''),
    queryFn: () => listKnowledgeItems(handoffId!),
    enabled: useCloudQueryEnabled(Boolean(handoffId)),
  });
}

export function useKnowledgeProvenance(handoffId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.knowledgeProvenance(handoffId ?? ''),
    queryFn: () => listKnowledgeProvenance(handoffId!),
    enabled: useCloudQueryEnabled(Boolean(handoffId)),
  });
}

export function useKnowledgeItem(id: string | undefined) {
  return useQuery({
    queryKey: relayKeys.knowledgeItem(id ?? ''),
    queryFn: () => getKnowledgeItem(id!),
    enabled: useCloudQueryEnabled(Boolean(id)),
  });
}

export function useHandoffPublication(handoffId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.publication(handoffId ?? ''),
    queryFn: () => getHandoffPublication(handoffId!),
    enabled: useCloudQueryEnabled(Boolean(handoffId)),
  });
}

export function useHandoffPublicationItems(publicationId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.publicationItems(publicationId ?? ''),
    queryFn: () => listHandoffPublicationItems(publicationId!),
    enabled: useCloudQueryEnabled(Boolean(publicationId)),
  });
}

export function useSharedHandoff(token: string | undefined) {
  return useQuery({
    queryKey: relayKeys.sharedHandoff(token ?? ''),
    queryFn: () => getSharedHandoff(token!),
    enabled: Boolean(token) && /^[0-9a-f]{64}$/.test(token!),
    retry: false,
  });
}

export function useMemoryRoles() {
  return useQuery({
    queryKey: relayKeys.memoryRoles,
    queryFn: listMemoryRoles,
    enabled: useCloudQueryEnabled(),
  });
}

export function useRoleMemoryComparison(roleId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.roleMemoryComparison(roleId ?? ''),
    queryFn: () => getLatestRoleMemoryComparison(roleId!),
    refetchInterval: (query) => query.state.data?.runStatus === 'processing' ? 2000 : false,
    enabled: useCloudQueryEnabled(Boolean(roleId)),
  });
}

export function useRoleMemoryChanges(comparisonId: string | undefined, processing = false, completedAt?: string | null) {
  return useQuery({
    queryKey: [...relayKeys.roleMemoryChanges(comparisonId ?? ''), completedAt],
    queryFn: () => listRoleMemoryChanges(comparisonId!),
    refetchInterval: processing ? 3000 : false,
    enabled: useCloudQueryEnabled(Boolean(comparisonId)),
  });
}

export function useAskRelay() {
  return useMutation({
    mutationFn: ({ handoffId, question, history }: { handoffId: string; question: string; history?: { question: string; answer: string; itemIds: string[] }[] }) => askRelay(handoffId, question, history),
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: OrganizationInput) => createOrganization(input),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.organizations }),
      queryClient.invalidateQueries({ queryKey: relayKeys.access }),
    ]),
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RoleInput) => createRole(input),
    onSuccess: (_, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.roles(input.organizationId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.organization(input.organizationId) }),
    ]),
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RoleUpdateInput) => updateRole(input),
    onSuccess: (_, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.role(input.roleId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.roles(input.organizationId) }),
      queryClient.invalidateQueries({ queryKey: ['relay', 'continuity', input.organizationId] }),
    ]),
  });
}

export function useCreateHandoff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HandoffInput) => createHandoff(input),
    onSuccess: (_, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.roleHandoffs(input.roleId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.organizationHandoffs(input.organizationId) }),
    ]),
  });
}

export function useSubmitCapture() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  return useMutation({
    mutationFn: (input: CaptureInput) => {
      if (!session?.user.id) throw new Error('Sign in again to save this capture.');
      return submitCapture(input, session.user.id);
    },
    onSuccess: (_, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.handoffCaptures(input.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.handoffSources(input.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(input.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(input.handoffId) }),
    ]),
  });
}

export function useCreateCaptureDraft() {
  return useMutation({ mutationFn: (input: CaptureDraftInput) => createCaptureDraft(input) });
}

export function useDiscardCaptureDraft() {
  return useMutation({ mutationFn: (captureId: string) => discardCaptureDraft(captureId) });
}

export function useFindExactDocumentDuplicate() {
  return useMutation({
    mutationFn: (input: DocumentDuplicateCheckInput) => findExactDocumentDuplicate(input),
  });
}

export function useTranscribeVoiceRecording() {
  return useMutation({
    mutationFn: (input: VoiceRecordingInput) => transcribeVoiceRecording(input),
  });
}

// Serialize explicit Organize requests on this client. The server owns its one
// evidence-repair attempt and durable job state; the client never multiplies
// model calls with a second retry loop.
let organizeQueue: Promise<unknown> = Promise.resolve();

function enqueueOrganize(captureId: string) {
  const run = organizeQueue.then(
    () => generateCaptureProposals(captureId),
    () => generateCaptureProposals(captureId),
  );
  // Keep the queue alive for the next caller regardless of whether this run succeeded.
  organizeQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function useGenerateCaptureProposals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ captureId }: { captureId: string; handoffId: string }) =>
      enqueueOrganize(captureId),
    onSettled: (_, __, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.handoffCaptures(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeProvenance(variables.handoffId) }),
    ]),
  });
}

export function useUpdateKnowledgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: {
      id: string;
      handoffId: string;
      input: KnowledgeItemUpdateInput;
    }) => updateKnowledgeItem(id, input),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItem(variables.id) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
    ]),
  });
}

export function useDeleteKnowledgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; handoffId: string }) => deleteKnowledgeItem(id),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItem(variables.id) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
    ]),
  });
}

export function useMoveKnowledgeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, direction }: { id: string; handoffId: string; direction: 'up' | 'down' }) =>
      moveKnowledgeItem(id, direction),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(variables.handoffId) }),
  });
}

export function useBeginHandoffReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ handoffId }: { handoffId: string }) => beginHandoffReview(handoffId),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
  });
}

export function useReturnHandoffToCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ handoffId }: { handoffId: string }) => returnHandoffToCapture(handoffId),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
  });
}

export function useDecideKnowledgeProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: {
      id: string;
      handoffId: string;
      decision: 'approved' | 'rejected';
    }) => decideKnowledgeProposal(id, decision),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItem(variables.id) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
    ]),
  });
}

export function useAdvanceHandoffToPreview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ handoffId }: { handoffId: string }) => advanceHandoffToPreview(handoffId),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
  });
}

export function usePublishHandoff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ handoffId }: { handoffId: string }) => publishHandoff(handoffId),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.publication(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: ['relay', 'publication-items'] }),
    ]),
  });
}

export function useRevokeHandoffLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ handoffId }: { handoffId: string }) => revokeHandoffLink(handoffId),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.publication(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: ['relay', 'shared-handoff'] }),
    ]),
  });
}

export function useReplaceHandoffLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ handoffId }: { handoffId: string }) => replaceHandoffLink(handoffId),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.publication(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: ['relay', 'shared-handoff'] }),
    ]),
  });
}

export function useCompareRoleHandoffs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId }: { roleId: string }) => compareRoleHandoffs(roleId),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.roleMemoryComparison(variables.roleId) }),
      queryClient.invalidateQueries({ queryKey: ['relay', 'role-memory-changes'] }),
      queryClient.invalidateQueries({ queryKey: relayKeys.memoryRoles }),
    ]),
  });
}
