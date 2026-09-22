import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { checkContinuityError, useContinuity, useContinuityAction } from '@/features/relay/continuity';
import { requireSupabase } from '@/lib/supabase';

export default function OwnershipTransferScreen() {
  const { organizationId } = useLocalSearchParams<{ organizationId: string }>();
  const { session } = useAuth();
  const overview = useContinuity(organizationId);
  const [selected,setSelected] = useState('');
  const [notice,setNotice] = useState('');
  const action = useContinuityAction(async (accept:boolean) => {
    const result = accept
      ? await requireSupabase().rpc('accept_organization_ownership_transfer',{ requested_transfer_id:overview.data!.pendingTransfer!.id })
      : await requireSupabase().rpc('request_organization_ownership_transfer',{requested_organization_id:organizationId,requested_user_id:selected});
    checkContinuityError(result.error); setNotice(accept ? 'Ownership transferred. Organization history and subscription association are preserved.' : 'Transfer offered. The selected member can accept from this Organization’s page within 7 days.');
  });
  return <Screen>
    <AppText variant="display">Organization ownership</AppText>
    <AppText>The new Owner oversees continuity and manages assignments. Role editing still requires a Role assignment. The purchaser’s store billing account stays with the purchaser.</AppText>
    {overview.data?.isOwner ? <>
      <AppText variant="heading">Select an active member</AppText>
      {overview.data.members.filter(m => m.userId !== session?.user.id).map(m => <Button key={m.userId} tone={selected === m.userId ? 'primary' : 'secondary'} label={m.name || 'Organization member'} onPress={() => setSelected(m.userId)} />)}
      <Button label="Offer ownership transfer" disabled={!selected || action.isPending} onPress={() => action.mutate(false)} />
    </> : null}
    {overview.data?.pendingTransfer?.toUserId === session?.user.id ? <Button label="Accept Organization ownership" disabled={action.isPending} onPress={() => action.mutate(true)} /> : null}
    {notice ? <AppText>{notice}</AppText> : null}
    {overview.error || action.error ? <AppText>{(overview.error ?? action.error)?.message}</AppText> : null}
  </Screen>;
}
