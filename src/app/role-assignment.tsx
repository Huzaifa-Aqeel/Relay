import * as Clipboard from 'expo-clipboard';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Share } from 'react-native';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { useRole } from '@/features/relay/queries';
import { acceptAssignment, checkContinuityError, createAssignmentInvite, useContinuity, useContinuityAction } from '@/features/relay/continuity';
import { sharedHandoffUrl } from '@/features/relay/share-link';
import { requireSupabase } from '@/lib/supabase';

export default function RoleAssignmentScreen() {
  const { roleId } = useLocalSearchParams<{ roleId: string }>();
  const role = useRole(roleId);
  const overview = useContinuity(role.data?.organizationId);
  const [period,setPeriod] = useState('');
  const [replace,setReplace] = useState(false);
  const [issued,setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const [notice,setNotice] = useState('');
  const action = useContinuityAction(async (kind: 'invite' | 'self' | string) => {
    if (kind === 'invite' || kind === 'self') {
      const invite = await createAssignmentInvite(roleId,period,replace);
      if (kind === 'self') { const id = await acceptAssignment(invite.token); router.replace(`/handoff/${id}` as Href); }
      else setIssued(invite);
    } else {
      const { error } = await requireSupabase().rpc('end_role_assignment',{ requested_assignment_id: kind });
      checkContinuityError(error); setNotice('Assignment ended. Private workspace access has been removed.');
    }
  });
  const assignments = overview.data?.roles.find(r => r.roleId === roleId)?.assignments ?? [];
  const url = issued ? sharedHandoffUrl(issued.token)?.replace('/shared/','/assignment/') : null;
  return <Screen>
    <AppText variant="display">{role.data?.title ?? 'Role assignment'}</AppText>
    <AppText>One Role Holder maintains each service period. A replacement continues that period’s existing workspace with attribution preserved.</AppText>
    {overview.data?.isOwner ? <>
      {assignments.map(a => <ScreenAssignment key={a.id} label={`${a.name || 'Role Holder'} · ${a.servicePeriod}`} onEnd={() => action.mutate(a.id)} disabled={action.isPending} />)}
      <FormInput label="Service period" value={period} onChangeText={value => { setPeriod(value); setReplace(false); setIssued(null); }} placeholder="2027–2028" />
      <Button tone="secondary" label={replace ? 'Replacement confirmed' : 'Confirm replacing an existing holder for this period'} onPress={() => setReplace(!replace)} />
      <Button label="Create 7-day assignment invite" disabled={!period.trim() || action.isPending} onPress={() => action.mutate('invite')} />
      <Button tone="secondary" label="Assign myself and open workspace" disabled={!period.trim() || action.isPending} onPress={() => action.mutate('self')} />
      {issued ? <><AppText>Single-use invite expires {new Date(issued.expiresAt).toLocaleDateString()}. The recipient must sign in and accept.</AppText>
        {url ? <><Button label="Copy invite link" onPress={() => void Clipboard.setStringAsync(url).then(() => setNotice('Invite copied.'))} /><Button tone="secondary" label="Share invite" onPress={() => void Share.share({ message: url })} /></> : <AppText>Configure the Relay web origin to share this invite.</AppText>}
      </> : null}
    </> : <AppText>{overview.isPending ? 'Loading…' : 'Only the Organization Owner manages assignments.'}</AppText>}
    {action.error ? <AppText>{action.error.message}</AppText> : null}
    {notice ? <AppText>{notice}</AppText> : null}
  </Screen>;
}
function ScreenAssignment({label,onEnd,disabled}:{label:string;onEnd:()=>void;disabled:boolean}) {
  const [confirm,setConfirm] = useState(false);
  return <><AppText variant="heading">{label}</AppText><Button tone="secondary" disabled={disabled} label={confirm ? 'Confirm end assignment' : 'End assignment'} onPress={() => confirm ? onEnd() : setConfirm(true)} /></>;
}
