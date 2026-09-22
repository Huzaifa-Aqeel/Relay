-- Let the current holder plan succession for their own Role without granting organization-wide assignment powers.
create function public.service_period_start(value text)
returns integer language sql immutable set search_path = '' as $$
  select left(public.normalize_service_period(value),4)::integer;
$$;

create function public.can_issue_role_assignment_invite(
  requested_organization_id uuid,
  requested_role_id uuid,
  requested_service_period text,
  requested_creator_id uuid,
  requested_replacement_assignment_id uuid
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare current_assignment public.role_assignments;
begin
  if exists (
    select 1 from public.organizations o
    join public.organization_members m on m.organization_id = o.id and m.user_id = o.created_by
    where o.id = requested_organization_id and o.created_by = requested_creator_id and m.status = 'active'
  ) then return true; end if;

  select a.* into current_assignment
  from public.role_assignments a
  join public.organization_members m on m.organization_id = a.organization_id and m.user_id = a.user_id
  where a.organization_id = requested_organization_id and a.role_id = requested_role_id
    and a.status = 'active' and m.status = 'active'
  order by public.service_period_start(a.service_period) desc, a.accepted_at desc, a.id desc
  limit 1;

  if current_assignment.id is null or current_assignment.user_id <> requested_creator_id then return false; end if;
  if requested_replacement_assignment_id is not null then
    return requested_replacement_assignment_id = current_assignment.id
      and requested_service_period = current_assignment.service_period;
  end if;
  return public.service_period_start(requested_service_period)
    > public.service_period_start(current_assignment.service_period);
end;
$$;

revoke all on function public.service_period_start(text),
  public.can_issue_role_assignment_invite(uuid,uuid,text,uuid,uuid) from public,anon,authenticated;

create or replace function public.create_role_assignment_invite(
  requested_role_id uuid,
  requested_service_period text,
  replace_existing boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.roles;
  a public.role_assignments;
  token text := public.new_handoff_access_token();
  invite public.role_assignment_invites;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into r from public.roles where id = requested_role_id and archived_at is null;
  if r.id is null then raise exception 'Role unavailable' using errcode = '42501'; end if;

  perform 1 from public.organizations where id = r.organization_id for update;
  requested_service_period := public.canonical_role_period(r.id,requested_service_period);
  select * into a from public.role_assignments
  where role_id = r.id and service_period = requested_service_period and status = 'active'
  for update;

  if not public.can_issue_role_assignment_invite(
    r.organization_id,r.id,requested_service_period,auth.uid(),a.id
  ) then
    raise exception 'Only the Organization Owner or current Role Holder can invite for this Role' using errcode = '42501';
  end if;
  if a.id is not null and not replace_existing then
    raise exception 'Confirm replacement of the existing Role Holder' using errcode = '22023';
  end if;
  if a.id is null and replace_existing then
    raise exception 'There is no current Role Holder to replace for this service period' using errcode = '22023';
  end if;

  update public.role_assignment_invites set status = 'revoked'
  where role_id = r.id and service_period = requested_service_period and status = 'pending';
  insert into public.role_assignment_invites(
    organization_id,role_id,service_period,token_hash,created_by,replacement_assignment_id
  ) values (
    r.organization_id,r.id,requested_service_period,encode(extensions.digest(token,'sha256'),'hex'),auth.uid(),a.id
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
  if i.status <> 'pending' or i.expires_at <= now() or r.id is null
    or not public.can_issue_role_assignment_invite(
      i.organization_id,i.role_id,i.service_period,i.created_by,i.replacement_assignment_id
    ) then
    raise exception 'Invite unavailable or expired' using errcode = '22023';
  end if;

  select id into current_assignment from public.role_assignments
  where role_id = i.role_id and service_period = i.service_period and status = 'active'
  for update;
  if current_assignment is distinct from i.replacement_assignment_id then
    raise exception 'Assignment changed; request a new invite' using errcode = '22023';
  end if;

  update public.role_assignments set status = 'ended',ended_at = now() where id = current_assignment;
  insert into public.organization_members(organization_id,user_id,member_role,status)
  values(i.organization_id,auth.uid(),case when auth.uid() = owner_id then 'admin' else 'member' end,'active')
  on conflict (organization_id,user_id) do update set status = 'active',ended_at = null;
  insert into public.role_assignments(organization_id,role_id,user_id,service_period,assigned_by)
  values(i.organization_id,i.role_id,auth.uid(),i.service_period,i.created_by);
  h := public.create_handoff(i.organization_id,i.role_id,i.service_period);
  update public.role_assignment_invites set status = 'accepted',accepted_by = auth.uid(),accepted_at = now()
  where id = i.id;
  return h;
end;
$$;

revoke all on function public.create_role_assignment_invite(uuid,text,boolean),
  public.preview_role_assignment_invite(text), public.accept_role_assignment_invite(text) from public;
grant execute on function public.create_role_assignment_invite(uuid,text,boolean),
  public.preview_role_assignment_invite(text), public.accept_role_assignment_invite(text) to authenticated;

-- Stable ordering makes the newest active service period the visible/current holder in the client.
create or replace function public.get_organization_continuity(requested_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_organization_member(requested_organization_id) then
    raise exception 'Organization unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'isOwner',public.is_organization_admin(requested_organization_id),
    'members',case when public.is_organization_admin(requested_organization_id) then coalesce((
      select jsonb_agg(jsonb_build_object('userId',m.user_id,'name',p.display_name))
      from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = requested_organization_id and m.status = 'active'
    ),'[]'::jsonb) else '[]'::jsonb end,
    'roles',coalesce((select jsonb_agg(jsonb_build_object(
      'roleId',r.id,'title',r.title,
      'assignments',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'userId',a.user_id,'name',p.display_name,'servicePeriod',a.service_period
      ) order by public.service_period_start(a.service_period) desc,a.accepted_at desc)
        from public.role_assignments a join public.profiles p on p.id = a.user_id
        where a.role_id = r.id and a.status = 'active'),'[]'::jsonb),
      'handoffs',coalesce((select jsonb_agg(jsonb_build_object(
        'id',h.id,'servicePeriod',h.service_period,'status',h.status,'stage',h.stage,'updatedAt',h.updated_at,
        'canMaintain',public.is_role_holder_for_handoff(h.id),
        'approvedCount',(select count(*) from public.knowledge_items k where k.handoff_id = h.id and k.status = 'approved'),
        'preflightStatus',(select status from public.preflight_runs where handoff_id = h.id order by created_at desc,id desc limit 1),
        'unresolvedCount',(select count(*) from public.preflight_findings f where f.run_id = (
          select id from public.preflight_runs where handoff_id = h.id order by created_at desc,id desc limit 1
        ) and f.status <> 'resolved'),
        'publicationStatus',(select status from public.handoff_publications where handoff_id = h.id)
      ) order by public.service_period_start(h.service_period) desc,h.updated_at desc)
        from public.handoffs h where h.role_id = r.id
          and (public.is_organization_admin(requested_organization_id) or public.can_view_role_history(r.id))
      ),'[]'::jsonb)
    ) order by r.title) from public.roles r
      where r.organization_id = requested_organization_id and r.archived_at is null),'[]'::jsonb),
    'pendingTransfer',(select jsonb_build_object('id',t.id,'toUserId',t.to_user_id,'expiresAt',t.expires_at)
      from public.organization_ownership_transfers t
      where t.organization_id = requested_organization_id and t.status = 'pending' and t.expires_at > now()
        and auth.uid() in (t.from_user_id,t.to_user_id))
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_organization_continuity(uuid) from public;
grant execute on function public.get_organization_continuity(uuid) to authenticated;
