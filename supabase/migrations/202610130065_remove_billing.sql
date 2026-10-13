-- Relay is free for every Organization. Remove the subscription system:
-- plan checks, the billing table, and every billing function behind them.
-- Membership, Role Assignment, and ownership checks in each caller remain.

-- Role entitlement now only confirms the Role is active in the Organization.
create or replace function public.organization_role_is_entitled(
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
  );
$$;

create or replace function public.create_organization(
  organization_name text,
  organization_institution text default '',
  organization_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  created_organization_id uuid;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(organization_name, ''))) not between 1 and 100 then
    raise exception 'Organization name must be between 1 and 100 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(organization_institution, '')) > 160
    or char_length(coalesce(organization_description, '')) > 800 then
    raise exception 'Organization details are too long' using errcode = '22023';
  end if;

  insert into public.organizations (created_by, name, institution, description)
  values (
    actor,
    btrim(organization_name),
    btrim(coalesce(organization_institution, '')),
    btrim(coalesce(organization_description, ''))
  )
  returning id into created_organization_id;

  insert into public.organization_members (organization_id, user_id, member_role)
  values (created_organization_id, actor, 'admin');

  return created_organization_id;
end;
$$;

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

  insert into public.roles (organization_id, created_by, title, description)
  values (
    requested_organization_id,
    actor,
    btrim(requested_title),
    btrim(coalesce(requested_description, ''))
  )
  returning id into created_role_id;
  return created_role_id;
end;
$$;

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

  select id into created_handoff_id
  from public.handoffs
  where role_id = requested_role_id and service_period = btrim(requested_service_period);
  if created_handoff_id is not null then return created_handoff_id; end if;

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
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into role_record
  from public.roles
  where id = requested_role_id and archived_at is null;
  if role_record.id is null then
    raise exception 'Role unavailable' using errcode = '42501';
  end if;

  perform 1 from public.organizations
  where id = role_record.organization_id for update;
  requested_service_period := public.canonical_role_period(
    role_record.id, requested_service_period
  );

  select * into outgoing_assignment
  from public.role_assignments
  where role_id = role_record.id and status = 'active'
  order by public.service_period_start(service_period) desc,
    accepted_at desc, id desc
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
    raise exception 'Only the Organization Owner or current Role Holder can invite for this Role'
      using errcode = '42501';
  end if;

  if selected_assignment.id is not null then
    if selected_assignment.id is distinct from outgoing_assignment.id then
      raise exception 'Assignment changed; refresh this Role and try again'
        using errcode = '22023';
    end if;
    if not replace_existing then
      raise exception 'Confirm replacement of the existing Role Holder'
        using errcode = '22023';
    end if;
  elsif replace_existing then
    raise exception 'There is no current Role Holder to replace for this service period'
      using errcode = '22023';
  elsif outgoing_assignment.id is not null
    and public.service_period_start(requested_service_period)
      <= public.service_period_start(outgoing_assignment.service_period) then
    raise exception 'Choose a service period after the current assignment'
      using errcode = '22023';
  end if;

  update public.role_assignment_invites set status = 'revoked'
  where role_id = role_record.id
    and service_period = requested_service_period
    and status = 'pending';

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

-- Every Organization gets the same Ask Relay daily allowance.
create or replace function public.claim_role_holder_ask_request(requested_handoff_id uuid)
returns table (
  claim_id uuid,
  publication_id uuid,
  organization_id uuid,
  handoff_id uuid,
  remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  publication public.handoff_publications;
  effective_limit integer := 100;
  current_count integer;
  created_claim_id uuid;
begin
  if actor is null or not public.can_ask_previous_handoff(requested_handoff_id) then
    raise exception 'Previous handoff unavailable' using errcode = 'P0002';
  end if;
  select candidate.* into publication
  from public.handoff_publications candidate
  where candidate.handoff_id = requested_handoff_id;
  if publication.id is null then
    raise exception 'Previous handoff unavailable' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    publication.id::text || actor::text || current_date::text, 0
  ));

  update public.ask_role_usage_claims claim
  set status = 'failed', completed_at = now()
  where claim.publication_id = publication.id
    and claim.user_id = actor
    and claim.status = 'pending'
    and claim.created_at < now() - interval '3 minutes';

  select count(*)::integer into current_count
  from public.ask_role_usage_claims claim
  where claim.publication_id = publication.id
    and claim.user_id = actor
    and claim.usage_date = current_date
    and claim.status in ('pending', 'succeeded');

  if current_count >= effective_limit then
    raise exception 'ASK_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.ask_role_usage_claims(publication_id, user_id, effective_limit)
  values(publication.id, actor, effective_limit)
  returning id into created_claim_id;

  return query select
    created_claim_id,
    publication.id,
    publication.organization_id,
    publication.handoff_id,
    greatest(effective_limit - current_count - 1, 0);
end;
$$;

-- Billing functions and data are gone.
drop function if exists public.get_organization_plan(uuid);
drop function if exists public.sync_verified_organization_subscription(
  uuid, uuid, text, boolean, text, text, timestamptz
);
drop function if exists public.purchaser_has_active_relay_pro(uuid);
drop function if exists public.organization_has_relay_pro(uuid);
drop function if exists public.organization_free_role_id(uuid);

alter table public.organizations
  drop constraint if exists organizations_free_role_belongs_to_organization;
alter table public.organizations drop column if exists free_role_id;

drop table if exists public.organization_subscriptions;
