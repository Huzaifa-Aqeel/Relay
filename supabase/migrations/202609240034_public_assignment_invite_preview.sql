-- A possession-based invitation may disclose only the small amount of context
-- needed to decide whether to authenticate. The token still grants no
-- membership, Role authority, workspace access, or acceptance without auth.
create or replace function public.preview_role_assignment_invite(requested_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if requested_token is null or requested_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invite unavailable or expired' using errcode = '22023';
  end if;

  select jsonb_build_object(
    'organizationName', organization.name,
    'roleTitle', role.title,
    'servicePeriod', invite.service_period,
    'expiresAt', invite.expires_at,
    'replacement', invite.replacement_assignment_id is not null
  )
  into result
  from public.role_assignment_invites invite
  join public.organizations organization on organization.id = invite.organization_id
  join public.roles role on role.id = invite.role_id
  where invite.token_hash = encode(extensions.digest(requested_token, 'sha256'), 'hex')
    and invite.status = 'pending'
    and invite.expires_at > now()
    and role.archived_at is null
    and public.current_role_assignment_id(invite.role_id) is not distinct from invite.outgoing_assignment_id
    and public.can_issue_role_assignment_invite(
      invite.organization_id,
      invite.role_id,
      invite.service_period,
      invite.created_by,
      invite.replacement_assignment_id
    );

  if result is null then
    raise exception 'Invite unavailable or expired' using errcode = '22023';
  end if;
  return result;
end;
$$;

revoke all on function public.preview_role_assignment_invite(text) from public;
grant execute on function public.preview_role_assignment_invite(text) to anon, authenticated;
