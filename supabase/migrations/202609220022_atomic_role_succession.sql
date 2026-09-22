-- Bind every new invitation to the exact assignment it is intended to succeed. This prevents an
-- old Owner-created link from replacing a holder whose assignment changed after the link was issued.
alter table public.role_assignment_invites
add column outgoing_assignment_id uuid references public.role_assignments(id);

update public.role_assignment_invites i
set outgoing_assignment_id = coalesce(i.replacement_assignment_id,(
  select a.id from public.role_assignments a
  where a.role_id = i.role_id and a.status = 'active'
  order by case when a.service_period ~ '^[0-9]{4}' then left(a.service_period,4)::integer else 0 end desc,
    a.accepted_at desc,a.id desc
  limit 1
))
where i.status = 'pending';

create function public.current_role_assignment_id(requested_role_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.role_assignments a
  where a.role_id = requested_role_id and a.status = 'active'
  order by public.service_period_start(a.service_period) desc,a.accepted_at desc,a.id desc
  limit 1;
$$;

revoke all on function public.current_role_assignment_id(uuid) from public,anon,authenticated;

create or replace function public.create_role_assignment_invite(
  requested_role_id uuid,
  requested_service_period text,
  replace_existing boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.roles;
  selected_assignment public.role_assignments;
  outgoing_assignment public.role_assignments;
  token text := public.new_handoff_access_token();
  invite public.role_assignment_invites;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into r from public.roles where id = requested_role_id and archived_at is null;
  if r.id is null then raise exception 'Role unavailable' using errcode = '42501'; end if;

  perform 1 from public.organizations where id = r.organization_id for update;
  requested_service_period := public.canonical_role_period(r.id,requested_service_period);
  select * into outgoing_assignment from public.role_assignments
  where role_id = r.id and status = 'active'
  order by public.service_period_start(service_period) desc,accepted_at desc,id desc
  limit 1 for update;
  select * into selected_assignment from public.role_assignments
  where role_id = r.id and service_period = requested_service_period and status = 'active'
  for update;

  if not public.can_issue_role_assignment_invite(
    r.organization_id,r.id,requested_service_period,auth.uid(),selected_assignment.id
  ) then
    raise exception 'Only the Organization Owner or current Role Holder can invite for this Role' using errcode = '42501';
  end if;

  if selected_assignment.id is not null then
    if selected_assignment.id is distinct from outgoing_assignment.id then
      raise exception 'Assignment changed; refresh this Role and try again' using errcode = '22023';
    end if;
    if not replace_existing then
      raise exception 'Confirm replacement of the existing Role Holder' using errcode = '22023';
    end if;
  elsif replace_existing then
    raise exception 'There is no current Role Holder to replace for this service period' using errcode = '22023';
  elsif outgoing_assignment.id is not null and public.service_period_start(requested_service_period)
    <= public.service_period_start(outgoing_assignment.service_period) then
    raise exception 'Choose a service period after the current assignment' using errcode = '22023';
  end if;

  -- Reissuing an invitation for the same period deliberately invalidates the older link.
  update public.role_assignment_invites set status = 'revoked'
  where role_id = r.id and service_period = requested_service_period and status = 'pending';
  insert into public.role_assignment_invites(
    organization_id,role_id,service_period,token_hash,created_by,
    replacement_assignment_id,outgoing_assignment_id
  ) values (
    r.organization_id,r.id,requested_service_period,
    encode(extensions.digest(token,'sha256'),'hex'),auth.uid(),
    selected_assignment.id,outgoing_assignment.id
  ) returning * into invite;
  return jsonb_build_object('token',token,'expiresAt',invite.expires_at);
end;
$$;

create or replace function public.preview_role_assignment_invite(requested_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'organizationName',o.name,
    'roleTitle',r.title,
    'servicePeriod',i.service_period,
    'expiresAt',i.expires_at,
    'replacement',i.replacement_assignment_id is not null
  ) into result
  from public.role_assignment_invites i
  join public.organizations o on o.id = i.organization_id
  join public.roles r on r.id = i.role_id
  where i.token_hash = encode(extensions.digest(requested_token,'sha256'),'hex')
    and i.status = 'pending' and i.expires_at > now() and r.archived_at is null
    and public.current_role_assignment_id(i.role_id) is not distinct from i.outgoing_assignment_id
    and public.can_issue_role_assignment_invite(
      i.organization_id,i.role_id,i.service_period,i.created_by,i.replacement_assignment_id
    );
  if result is null then raise exception 'Invite unavailable or expired' using errcode = '22023'; end if;
  return result;
end;
$$;

create or replace function public.accept_role_assignment_invite(requested_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  i public.role_assignment_invites;
  r public.roles;
  selected_assignment uuid;
  current_assignment uuid;
  h uuid;
  owner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into i from public.role_assignment_invites
  where token_hash = encode(extensions.digest(requested_token,'sha256'),'hex');
  if i.id is null then raise exception 'Invite unavailable or expired' using errcode = '22023'; end if;

  select created_by into owner_id from public.organizations where id = i.organization_id for update;
  select * into i from public.role_assignment_invites where id = i.id for update;
  select * into r from public.roles where id = i.role_id and archived_at is null;
  select id into current_assignment from public.role_assignments
  where role_id = i.role_id and status = 'active'
  order by public.service_period_start(service_period) desc,accepted_at desc,id desc
  limit 1 for update;
  if i.status <> 'pending' or i.expires_at <= now() or r.id is null
    or current_assignment is distinct from i.outgoing_assignment_id
    or not public.can_issue_role_assignment_invite(
      i.organization_id,i.role_id,i.service_period,i.created_by,i.replacement_assignment_id
    ) then
    raise exception 'Invite unavailable or expired' using errcode = '22023';
  end if;

  select id into selected_assignment from public.role_assignments
  where role_id = i.role_id and service_period = i.service_period and status = 'active'
  for update;
  if selected_assignment is distinct from i.replacement_assignment_id then
    raise exception 'Assignment changed; request a new invite' using errcode = '22023';
  end if;

  -- Same-period replacement and new-period succession intentionally share this atomic boundary.
  -- create_handoff returns the existing workspace for the same period, or creates/inherits a new one.
  update public.role_assignments set status = 'ended',ended_at = now()
  where role_id = i.role_id and status = 'active';
  insert into public.organization_members(organization_id,user_id,member_role,status)
  values(i.organization_id,auth.uid(),case when auth.uid() = owner_id then 'admin' else 'member' end,'active')
  on conflict (organization_id,user_id) do update set status = 'active',ended_at = null;
  insert into public.role_assignments(organization_id,role_id,user_id,service_period,assigned_by)
  values(i.organization_id,i.role_id,auth.uid(),i.service_period,i.created_by);
  h := public.create_handoff(i.organization_id,i.role_id,i.service_period);
  update public.role_assignment_invites set status = 'accepted',accepted_by = auth.uid(),accepted_at = now()
  where id = i.id;
  update public.role_assignment_invites set status = 'revoked'
  where role_id = i.role_id and status = 'pending' and id <> i.id;
  return h;
end;
$$;

create or replace function public.end_role_assignment(requested_assignment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.role_assignments;
begin
  select * into a from public.role_assignments where id = requested_assignment_id;
  if a.id is null or not public.is_organization_admin(a.organization_id) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = a.organization_id for update;
  if not public.is_organization_admin(a.organization_id) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  update public.role_assignments set status = 'ended',ended_at = now()
  where id = a.id and status = 'active';
  update public.role_assignment_invites set status = 'revoked'
  where status = 'pending' and (
    replacement_assignment_id = a.id or outgoing_assignment_id = a.id
  );
end;
$$;

revoke all on function public.create_role_assignment_invite(uuid,text,boolean),
  public.preview_role_assignment_invite(text), public.accept_role_assignment_invite(text),
  public.end_role_assignment(uuid) from public;
grant execute on function public.create_role_assignment_invite(uuid,text,boolean),
  public.preview_role_assignment_invite(text), public.accept_role_assignment_invite(text),
  public.end_role_assignment(uuid) to authenticated;
