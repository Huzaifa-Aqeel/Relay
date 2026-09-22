import { useQuery } from '@tanstack/react-query';
import type { Href } from 'expo-router';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Screen } from '@/components/ui/screen';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { FormInput } from '@/components/ui/form-controls';
import { useAuth } from '@/features/auth/auth-provider';
import { acceptAssignment, checkContinuityError, inviteSchema, useContinuityAction } from '@/features/relay/continuity';
import { requireSupabase } from '@/lib/supabase';

export default function AssignmentInviteScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const auth = useAuth();
  const [email,setEmail] = useState('');
  const [password,setPassword] = useState('');
  const [name,setName] = useState('');
  const [signup,setSignup] = useState(false);
  const [notice,setNotice] = useState('');
  const valid = /^[0-9a-f]{64}$/.test(token ?? '');
  const preview = useQuery({ queryKey:['relay','assignment-invite',token,auth.session?.user.id], enabled:valid && auth.status === 'authenticated', retry:false,
    queryFn:async () => {
      const { data,error } = await requireSupabase().rpc('preview_role_assignment_invite',{requested_token:token});
      checkContinuityError(error); return inviteSchema.parse(data);
    } });
  const action = useContinuityAction(async (accept:boolean) => {
    if (accept) { const id = await acceptAssignment(token); router.replace(`/handoff/${id}` as Href); }
    else if (signup) {
      const result = await auth.signUp(name,email,password,`/assignment/${token}`);
      if (result.needsEmailConfirmation) setNotice('Confirm your email on this device. Relay will bring you back to this invitation.');
    } else await auth.signIn(email,password);
  });
  return <Screen>
    <AppText variant="display">Role assignment invitation</AppText>
    {!valid ? <AppText>This invite is unavailable.</AppText> : auth.status !== 'authenticated' ? <>
      <AppText>Sign in or create an account to continue with this Role invitation.</AppText>
      {signup ? <FormInput label="Your name" value={name} onChangeText={setName} /> : null}
      <FormInput label="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <FormInput label="Password" secureTextEntry value={password} onChangeText={setPassword} />
      <Button disabled={action.isPending || !email || !password || (signup && !name)} label={signup ? 'Create account' : 'Sign in'} onPress={() => action.mutate(false)} />
      <Button tone="secondary" label={signup ? 'Use an existing account' : 'Create a Relay account'} onPress={() => setSignup(!signup)} />
    </> : preview.data ? <>
      <AppText variant="heading">{preview.data.organizationName}</AppText>
      <AppText>{preview.data.roleTitle} · {preview.data.servicePeriod}</AppText>
      <AppText>{preview.data.replacement ? 'Accepting replaces the current holder and gives you the existing workspace for this service period.' : 'Accepting authorizes you to maintain this Role’s workspace for the stated service period.'}</AppText>
      <AppText>Signed in as {auth.session?.user.email}</AppText>
      <Button disabled={action.isPending} label="Accept Role assignment" onPress={() => action.mutate(true)} />
    </> : <AppText>{preview.error?.message ?? 'Loading invitation…'}</AppText>}
    {notice ? <AppText>{notice}</AppText> : null}
    {action.error ? <AppText>{action.error.message}</AppText> : null}
  </Screen>;
}
