-- A Free Organization keeps one stable Role usable after a Pro downgrade.
-- Extra Roles and their data remain intact, but their private workspaces are
-- unavailable until the Organization is entitled again.
alter table public.organizations add column free_role_id uuid;

update public.organizations organization
set free_role_id = coalesce(
  (
    select role.id
    from public.roles role
    join public.role_assignments assignment
      on assignment.organization_id = role.organization_id
      and assignment.role_id = role.id
      and assignment.user_id = organization.created_by
      and assignment.status = 'active'
    where role.organization_id = organization.id and role.archived_at is null
    order by role.created_at, role.id
    limit 1
  ),
  (
    select role.id
    from public.roles role
    where role.organization_id = organization.id and role.archived_at is null
    order by role.created_at, role.id
    limit 1
  )
);

alter table public.organizations
  add constraint organizations_free_role_belongs_to_organization
  foreign key (free_role_id, id) references public.roles(id, organization_id)
  deferrable initially deferred;

create function public.organization_free_role_id(requested_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization.free_role_id
  from public.organizations organization
  where organization.id = requested_organization_id;
$$;

create function public.organization_role_is_entitled(
  requested_organization_id uuid,
  requested_role_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roles role
    where role.id = requested_role_id
      and role.organization_id = requested_organization_id
      and role.archived_at is null
      and (
        public.organization_has_relay_pro(requested_organization_id)
        or role.id = public.organization_free_role_id(requested_organization_id)
      )
  );
$$;

revoke all on function public.organization_free_role_id(uuid),
  public.organization_role_is_entitled(uuid, uuid) from public, anon, authenticated;

create or replace function public.is_role_holder_for_handoff(requested_handoff_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.handoffs handoff
    join public.role_assignments assignment
      on assignment.organization_id = handoff.organization_id
      and assignment.role_id = handoff.role_id
      and assignment.service_period = handoff.service_period
    join public.organization_members member
      on member.organization_id = assignment.organization_id
      and member.user_id = assignment.user_id
    where handoff.id = requested_handoff_id
      and assignment.user_id = auth.uid()
      and assignment.status = 'active'
      and member.status = 'active'
      and public.organization_role_is_entitled(handoff.organization_id, handoff.role_id)
  );
$$;

create or replace function public.can_view_role_history(requested_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.roles role
    where role.id = requested_role_id
      and public.organization_role_is_entitled(role.organization_id, role.id)
      and (
        public.is_organization_admin(role.organization_id)
        or (
          public.is_organization_member(role.organization_id)
          and exists (
            select 1
            from public.role_assignments assignment
            where assignment.role_id = role.id
              and assignment.user_id = auth.uid()
              and assignment.status = 'active'
          )
        )
      )
  );
$$;

revoke all on function public.is_role_holder_for_handoff(uuid),
  public.can_view_role_history(uuid) from public;
grant execute on function public.is_role_holder_for_handoff(uuid),
  public.can_view_role_history(uuid) to authenticated;

create or replace function public.get_organization_plan(requested_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  subscription public.organization_subscriptions;
begin
  if actor is null or not public.is_organization_member(requested_organization_id) then
    raise exception 'Organization unavailable' using errcode = '42501';
  end if;

  select candidate.* into subscription
  from public.organization_subscriptions candidate
  where candidate.organization_id = requested_organization_id;

  return jsonb_build_object(
    'organizationId', requested_organization_id,
    'plan', case
      when subscription.id is not null
        and subscription.status = 'active'
        and (subscription.expires_at is null or subscription.expires_at > now())
      then 'pro'
      else 'free'
    end,
    'freeRoleId', public.organization_free_role_id(requested_organization_id),
    'expiresAt', subscription.expires_at,
    'willRenew', subscription.will_renew,
    'store', subscription.store,
    'isPurchaser', coalesce(subscription.purchaser_user_id = actor, false)
  );
end;
$$;

revoke all on function public.get_organization_plan(uuid) from public, anon;
grant execute on function public.get_organization_plan(uuid) to authenticated;

create or replace function public.create_role(
  requested_organization_id uuid,
  requested_title text,
  requested_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  created_role_id uuid;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = requested_organization_id for update;
  if not public.is_organization_admin(requested_organization_id) then
    raise exception 'Organization admin access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(requested_title, ''))) not between 1 and 100
    or char_length(coalesce(requested_description, '')) > 800 then
    raise exception 'Role details are invalid' using errcode = '22023';
  end if;
  if not public.organization_has_relay_pro(requested_organization_id) and exists (
    select 1 from public.roles role
    where role.organization_id = requested_organization_id and role.archived_at is null
  ) then
    raise exception 'RELAY_PRO_REQUIRED:role' using errcode = 'P0001';
  end if;

  insert into public.roles (organization_id, created_by, title, description)
  values (
    requested_organization_id,
    actor,
    btrim(requested_title),
    btrim(coalesce(requested_description, ''))
  )
  returning id into created_role_id;

  update public.organizations
  set free_role_id = created_role_id
  where id = requested_organization_id and free_role_id is null;
  return created_role_id;
end;
$$;

revoke all on function public.create_role(uuid, text, text) from public;
grant execute on function public.create_role(uuid, text, text) to authenticated;

create or replace function public.create_handoff(
  requested_organization_id uuid,
  requested_role_id uuid,
  requested_service_period text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_handoff_id uuid;
  previous public.handoff_publications;
begin
  perform 1 from public.organizations where id = requested_organization_id for update;
  if not public.is_organization_member(requested_organization_id) or not exists (
    select 1
    from public.role_assignments assignment
    join public.roles role on role.id = assignment.role_id
    where assignment.organization_id = requested_organization_id
      and assignment.role_id = requested_role_id
      and assignment.user_id = auth.uid()
      and assignment.service_period = btrim(requested_service_period)
      and assignment.status = 'active'
      and role.archived_at is null
  ) then
    raise exception 'Active Role Assignment required' using errcode = '42501';
  end if;
  if not public.organization_role_is_entitled(requested_organization_id, requested_role_id) then
    raise exception 'RELAY_PRO_REQUIRED:role_access' using errcode = 'P0001';
  end if;

  select id into created_handoff_id
  from public.handoffs
  where role_id = requested_role_id and service_period = btrim(requested_service_period);
  if created_handoff_id is not null then return created_handoff_id; end if;

  if not public.organization_has_relay_pro(requested_organization_id) and exists (
    select 1 from public.handoffs
    where organization_id = requested_organization_id and status <> 'archived'
  ) then
    raise exception 'RELAY_PRO_REQUIRED:handoff' using errcode = 'P0001';
  end if;

  insert into public.handoffs (organization_id, role_id, created_by, service_period)
  values (requested_organization_id, requested_role_id, auth.uid(), btrim(requested_service_period))
  returning id into created_handoff_id;

  select publication.* into previous
  from public.handoff_publications publication
  join public.handoffs old_handoff on old_handoff.id = publication.handoff_id
  where old_handoff.role_id = requested_role_id
    and old_handoff.organization_id = requested_organization_id
    and old_handoff.service_period < btrim(requested_service_period)
  order by old_handoff.service_period desc, publication.published_at desc
  limit 1;

  if previous.id is not null then
    insert into public.knowledge_items (
      organization_id, handoff_id, created_by, knowledge_type, title, content,
      status, origin, sort_order, lineage_id, inherited_from_handoff_id,
      inherited_from_service_period, inherited_citation_sources
    )
    select requested_organization_id, created_handoff_id,
      coalesce(knowledge.created_by, previous.published_by), item.knowledge_type,
      item.title, item.content, 'approved', 'inherited', item.sort_order,
      item.knowledge_lineage_id, previous.handoff_id, previous.service_period,
      item.citation_sources
    from public.handoff_publication_items item
    left join public.knowledge_items knowledge on knowledge.id = item.source_knowledge_item_id
    where item.publication_id = previous.id;
  end if;
  return created_handoff_id;
end;
$$;

revoke all on function public.create_handoff(uuid, uuid, text) from public;
grant execute on function public.create_handoff(uuid, uuid, text) to authenticated;

create or replace function public.create_role_assignment_invite(
  requested_role_id uuid,
  requested_service_period text,
  replace_existing boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_record public.roles;
  selected_assignment public.role_assignments;
  outgoing_assignment public.role_assignments;
  token text := public.new_handoff_access_token();
  invite public.role_assignment_invites;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into role_record from public.roles where id = requested_role_id and archived_at is null;
  if role_record.id is null then raise exception 'Role unavailable' using errcode = '42501'; end if;

  perform 1 from public.organizations where id = role_record.organization_id for update;
  if not public.organization_role_is_entitled(role_record.organization_id, role_record.id) then
    raise exception 'RELAY_PRO_REQUIRED:role_access' using errcode = 'P0001';
  end if;
  requested_service_period := public.canonical_role_period(role_record.id, requested_service_period);
  select * into outgoing_assignment
  from public.role_assignments
  where role_id = role_record.id and status = 'active'
  order by public.service_period_start(service_period) desc, accepted_at desc, id desc
  limit 1 for update;
  select * into selected_assignment
  from public.role_assignments
  where role_id = role_record.id
    and service_period = requested_service_period
    and status = 'active'
  for update;

  if not public.can_issue_role_assignment_invite(
    role_record.organization_id, role_record.id, requested_service_period,
    auth.uid(), selected_assignment.id
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

  update public.role_assignment_invites set status = 'revoked'
  where role_id = role_record.id and service_period = requested_service_period and status = 'pending';
  insert into public.role_assignment_invites (
    organization_id, role_id, service_period, token_hash, created_by,
    replacement_assignment_id, outgoing_assignment_id
  ) values (
    role_record.organization_id, role_record.id, requested_service_period,
    encode(extensions.digest(token, 'sha256'), 'hex'), auth.uid(),
    selected_assignment.id, outgoing_assignment.id
  ) returning * into invite;
  return jsonb_build_object('token', token, 'expiresAt', invite.expires_at);
end;
$$;

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
    'replacement', invite.replacement_assignment_id is not null,
    'planAvailable', public.organization_role_is_entitled(invite.organization_id, invite.role_id)
  ) into result
  from public.role_assignment_invites invite
  join public.organizations organization on organization.id = invite.organization_id
  join public.roles role on role.id = invite.role_id
  where invite.token_hash = encode(extensions.digest(requested_token, 'sha256'), 'hex')
    and invite.status = 'pending'
    and invite.expires_at > now()
    and role.archived_at is null
    and public.current_role_assignment_id(invite.role_id) is not distinct from invite.outgoing_assignment_id
    and public.can_issue_role_assignment_invite(
      invite.organization_id, invite.role_id, invite.service_period,
      invite.created_by, invite.replacement_assignment_id
    );

  if result is null then raise exception 'Invite unavailable or expired' using errcode = '22023'; end if;
  return result;
end;
$$;

create or replace function public.accept_role_assignment_invite(requested_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.role_assignment_invites;
  role_record public.roles;
  selected_assignment uuid;
  current_assignment uuid;
  handoff_id uuid;
  owner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into invite
  from public.role_assignment_invites
  where token_hash = encode(extensions.digest(requested_token, 'sha256'), 'hex');
  if invite.id is null then raise exception 'Invite unavailable or expired' using errcode = '22023'; end if;

  select created_by into owner_id
  from public.organizations where id = invite.organization_id for update;
  select * into invite from public.role_assignment_invites where id = invite.id for update;
  select * into role_record from public.roles where id = invite.role_id and archived_at is null;
  select id into current_assignment
  from public.role_assignments
  where role_id = invite.role_id and status = 'active'
  order by public.service_period_start(service_period) desc, accepted_at desc, id desc
  limit 1 for update;

  if invite.status <> 'pending' or invite.expires_at <= now() or role_record.id is null
    or current_assignment is distinct from invite.outgoing_assignment_id
    or not public.can_issue_role_assignment_invite(
      invite.organization_id, invite.role_id, invite.service_period,
      invite.created_by, invite.replacement_assignment_id
    ) then
    raise exception 'Invite unavailable or expired' using errcode = '22023';
  end if;
  if not public.organization_role_is_entitled(invite.organization_id, invite.role_id) then
    raise exception 'RELAY_PRO_REQUIRED:role_access' using errcode = 'P0001';
  end if;

  select id into selected_assignment
  from public.role_assignments
  where role_id = invite.role_id
    and service_period = invite.service_period
    and status = 'active'
  for update;
  if selected_assignment is distinct from invite.replacement_assignment_id then
    raise exception 'Assignment changed; request a new invite' using errcode = '22023';
  end if;

  update public.role_assignments set status = 'ended', ended_at = now()
  where role_id = invite.role_id and status = 'active';
  insert into public.organization_members (organization_id, user_id, member_role, status)
  values (
    invite.organization_id, auth.uid(),
    case when auth.uid() = owner_id then 'admin' else 'member' end, 'active'
  )
  on conflict (organization_id, user_id)
  do update set status = 'active', ended_at = null;
  insert into public.role_assignments (
    organization_id, role_id, user_id, service_period, assigned_by
  ) values (
    invite.organization_id, invite.role_id, auth.uid(),
    invite.service_period, invite.created_by
  );
  handoff_id := public.create_handoff(invite.organization_id, invite.role_id, invite.service_period);
  update public.role_assignment_invites
  set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
  where id = invite.id;
  update public.role_assignment_invites set status = 'revoked'
  where role_id = invite.role_id and status = 'pending' and id <> invite.id;
  return handoff_id;
end;
$$;

revoke all on function public.create_role_assignment_invite(uuid, text, boolean),
  public.preview_role_assignment_invite(text),
  public.accept_role_assignment_invite(text) from public;
grant execute on function public.create_role_assignment_invite(uuid, text, boolean),
  public.accept_role_assignment_invite(text) to authenticated;
grant execute on function public.preview_role_assignment_invite(text) to anon, authenticated;
