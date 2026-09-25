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
  compareRoleHandoffs,
  confirmMemoryChangeReason,
  deleteKnowledgeItem,
  decideKnowledgeProposal,
  decidePreflightFinding,
  getHandoff,
  getRelayAccess,
  getHandoffPublication,
  getHandoffSource,
  findExactDocumentDuplicate,
  getSharedHandoff,
  generateCaptureProposals,
  getKnowledgeItem,
  getLatestPreflightRun,
  getLatestRoleMemoryComparison,
  getOrganization,
  getOrganizationPlan,
  getRole,
  listHandoffSources,
  listHandoffCaptures,
  listCaptureAttachments,
  listHandoffPublicationItems,
  listKnowledgeItems,
  listKnowledgeProvenance,
  listMemoryRoles,
  listMyAssignedRoles,
  listPreflightEvidence,
  listPreflightFindings,
  listOrganizationHandoffs,
  listOrganizations,
  listMyMembershipRequests,
  listPendingMembershipRequests,
  listRoleHandoffs,
  listRolePublications,
  listRoleMemoryChanges,
  listRoleLessons,
  listRoles,
  moveKnowledgeItem,
  publishHandoff,
  replaceHandoffLink,
  resolvePreflightFinding,
  revokeHandoffLink,
  returnHandoffToCapture,
  runPreflight,
  submitCapture,
  startGoogleDriveImport,
  discardCaptureDraft,
  rollbackCaptureAttachment,
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
  PreflightResolutionInput,
  RoleInput,
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
  preflightRun: (handoffId: string) => ['relay', 'preflight-run', handoffId] as const,
  preflightFindings: (runId: string) => ['relay', 'preflight-findings', runId] as const,
  preflightEvidence: (runId: string) => ['relay', 'preflight-evidence', runId] as const,
  publication: (handoffId: string) => ['relay', 'publication', handoffId] as const,
  publicationItems: (publicationId: string) => ['relay', 'publication-items', publicationId] as const,
  sharedHandoff: (token: string) => ['relay', 'shared-handoff', token] as const,
  memoryRoles: ['relay', 'memory-roles'] as const,
  roleMemoryComparison: (roleId: string) => ['relay', 'role-memory-comparison', roleId] as const,
  roleMemoryChanges: (comparisonId: string) => ['relay', 'role-memory-changes', comparisonId] as const,
  roleLessons: (roleId: string) => ['relay', 'role-lessons', roleId] as const,
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
  return useQuery({
    queryKey: relayKeys.handoffCaptures(handoffId ?? ''),
    queryFn: () => listHandoffCaptures(handoffId!),
    enabled,
  });
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

export function usePreflightRun(handoffId: string | undefined) {
  const enabled = useCloudQueryEnabled(Boolean(handoffId));
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !handoffId) return;
    const client = requireSupabase();
    const channel = client
      .channel(`preflight-run:${handoffId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'preflight_runs', filter: `handoff_id=eq.${handoffId}` },
        (payload) => {
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: relayKeys.preflightRun(handoffId) }),
            queryClient.invalidateQueries({ queryKey: relayKeys.handoff(handoffId) }),
          ]);
          const newRow = payload.new as { id?: unknown };
          const runId = typeof newRow.id === 'string' ? newRow.id : null;
          if (runId) {
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: relayKeys.preflightFindings(runId) }),
              queryClient.invalidateQueries({ queryKey: relayKeys.preflightEvidence(runId) }),
            ]);
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void queryClient.invalidateQueries({ queryKey: relayKeys.preflightRun(handoffId) });
        }
      });
    return () => { void client.removeChannel(channel); };
  }, [enabled, handoffId, queryClient]);

  return useQuery({
    queryKey: relayKeys.preflightRun(handoffId ?? ''),
    queryFn: () => getLatestPreflightRun(handoffId!),
    enabled,
  });
}

export function usePreflightFindings(runId: string | undefined) {
  const enabled = useCloudQueryEnabled(Boolean(runId));
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || !runId) return;
    const client = requireSupabase();
    const channel = client
      .channel(`preflight-findings:${runId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'preflight_findings', filter: `run_id=eq.${runId}` },
        () => { void queryClient.invalidateQueries({ queryKey: relayKeys.preflightFindings(runId) }); },
      )
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [enabled, queryClient, runId]);

  return useQuery({
    queryKey: relayKeys.preflightFindings(runId ?? ''),
    queryFn: () => listPreflightFindings(runId!),
    enabled,
  });
}

export function usePreflightEvidence(runId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.preflightEvidence(runId ?? ''),
    queryFn: () => listPreflightEvidence(runId!),
    enabled: useCloudQueryEnabled(Boolean(runId)),
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
    enabled: useCloudQueryEnabled(Boolean(roleId)),
  });
}

export function useRoleMemoryChanges(comparisonId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.roleMemoryChanges(comparisonId ?? ''),
    queryFn: () => listRoleMemoryChanges(comparisonId!),
    enabled: useCloudQueryEnabled(Boolean(comparisonId)),
  });
}

export function useRoleLessons(roleId: string | undefined) {
  return useQuery({
    queryKey: relayKeys.roleLessons(roleId ?? ''),
    queryFn: () => listRoleLessons(roleId!),
    enabled: useCloudQueryEnabled(Boolean(roleId)),
  });
}

export function useAskRelay() {
  return useMutation({
    mutationFn: ({ token, question }: { token: string; question: string }) => askRelay(token, question),
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

export function useGoogleDriveImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ captureId, returnUrl }: { captureId: string; returnUrl: string; handoffId: string }) => {
      const started = await startGoogleDriveImport(captureId, returnUrl);
      return started;
    },
    onSettled: (_, __, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.handoffCaptures(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.handoffSources(variables.handoffId) }),
    ]),
  });
}

export function useDiscardCaptureDraft() {
  return useMutation({ mutationFn: (captureId: string) => discardCaptureDraft(captureId) });
}

export function useRollbackCaptureAttachment() {
  return useMutation({
    mutationFn: ({ captureId, sourceId }: { captureId: string; sourceId: string }) =>
      rollbackCaptureAttachment(captureId, sourceId),
  });
}

export async function refreshCaptureAttachments(captureId: string) {
  return listCaptureAttachments(captureId);
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

export function useGenerateCaptureProposals() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ captureId }: { captureId: string; handoffId: string }) =>
      generateCaptureProposals(captureId),
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

export function useRunPreflight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ handoffId }: { handoffId: string }) => runPreflight(handoffId),
    onSettled: (_, __, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.preflightRun(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: ['relay', 'preflight-findings'] }),
      queryClient.invalidateQueries({ queryKey: ['relay', 'preflight-evidence'] }),
    ]),
  });
}

export function useDecidePreflightFinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: {
      id: string;
      runId: string;
      decision: 'skipped' | 'unknown';
    }) => decidePreflightFinding(id, decision),
    onSuccess: (_, variables) =>
      queryClient.invalidateQueries({ queryKey: relayKeys.preflightFindings(variables.runId) }),
  });
}

export function useResolvePreflightFinding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PreflightResolutionInput & { runId: string }) => resolvePreflightFinding(input),
    onSuccess: (_, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.preflightFindings(input.runId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.preflightRun(input.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.knowledgeItems(input.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(input.handoffId) }),
    ]),
  });
}

export function useAdvanceHandoffToPreview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ handoffId, acknowledgeCritical }: {
      handoffId: string;
      acknowledgeCritical: boolean;
    }) => advanceHandoffToPreview(handoffId, acknowledgeCritical),
    onSuccess: (_, variables) => Promise.all([
      queryClient.invalidateQueries({ queryKey: relayKeys.handoff(variables.handoffId) }),
      queryClient.invalidateQueries({ queryKey: relayKeys.preflightRun(variables.handoffId) }),
    ]),
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

export function useConfirmMemoryChangeReason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      changeId: string;
      comparisonId: string;
      reasonCategory: 'lesson_driven' | 'leadership_preference' | 'contact_resource' | 'unknown';
      explanation: string;
      lessonKnowledgeItemId?: string | null;
    }) => confirmMemoryChangeReason(input),
    onSuccess: (_, input) => queryClient.invalidateQueries({ queryKey: relayKeys.roleMemoryChanges(input.comparisonId) }),
  });
}
