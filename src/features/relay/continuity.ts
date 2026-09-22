import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/features/auth/auth-provider';
import { requireSupabase } from '@/lib/supabase';

const overviewSchema = z.object({
  isOwner: z.boolean(),
  members: z.array(z.object({ userId: z.string(), name: z.string() })),
  pendingTransfer: z.object({ id: z.string(), toUserId: z.string(), expiresAt: z.string() }).nullable(),
  roles: z.array(z.object({
    roleId: z.string(), title: z.string(),
    assignments: z.array(z.object({ id: z.string(), userId: z.string(), name: z.string(), servicePeriod: z.string() })),
    handoffs: z.array(z.object({
      id: z.string(), servicePeriod: z.string(), status: z.string(), stage: z.string(), updatedAt: z.string(),
      canMaintain: z.boolean(), approvedCount: z.number(), unresolvedCount: z.number(),
      preflightStatus: z.string().nullable(), publicationStatus: z.string().nullable(),
    })),
  })),
});
export const inviteSchema = z.object({ organizationName: z.string(), roleTitle: z.string(), servicePeriod: z.string(), expiresAt: z.string(), replacement: z.boolean() });
export function checkContinuityError(error: { message: string } | null) {
  if (error) throw new Error(error.message.includes('RELAY_PRO_REQUIRED')
    ? 'This Organization needs Relay Pro to start another service period. Its Owner can upgrade it.' : error.message);
}
export function useContinuity(organizationId?: string) {
  const { status } = useAuth();
  return useQuery({
    queryKey: ['relay','continuity',organizationId], enabled: !!organizationId && status === 'authenticated',
    queryFn: async () => {
      const { data, error } = await requireSupabase().rpc('get_organization_continuity', { requested_organization_id: organizationId! });
      checkContinuityError(error); return overviewSchema.parse(data);
    },
  });
}
export function useContinuityAction<T>(action: (input: T) => Promise<unknown>) {
  const cache = useQueryClient();
  return useMutation({ mutationFn: action, onSuccess: () => cache.invalidateQueries({ queryKey: ['relay'] }) });
}
export async function createAssignmentInvite(roleId: string, servicePeriod: string, replaceExisting: boolean) {
  const { data, error } = await requireSupabase().rpc('create_role_assignment_invite', {
    requested_role_id: roleId, requested_service_period: servicePeriod.trim(), replace_existing: replaceExisting,
  });
  checkContinuityError(error);
  return z.object({ token: z.string(), expiresAt: z.string() }).parse(data);
}
export async function acceptAssignment(token: string) {
  const { data, error } = await requireSupabase().rpc('accept_role_assignment_invite', { requested_token: token });
  checkContinuityError(error); return data;
}
