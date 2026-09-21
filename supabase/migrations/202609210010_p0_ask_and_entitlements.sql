create table public.billing_entitlements (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  entitlement_identifier text not null,
  is_pro boolean not null default false,
  product_identifier text,
  store text,
  expires_at timestamptz,
  revenuecat_checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(btrim(entitlement_identifier)) between 1 and 100),
  check (product_identifier is null or char_length(product_identifier) <= 200),
  check (store is null or char_length(store) <= 40)
);

create trigger billing_entitlements_set_updated_at before update on public.billing_entitlements
for each row execute function public.set_updated_at();

alter table public.billing_entitlements enable row level security;

create policy "users read their billing entitlement" on public.billing_entitlements
for select to authenticated
using (user_id = (select auth.uid()));

create or replace function public.has_relay_pro(requested_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select entitlement.is_pro
      and (entitlement.expires_at is null or entitlement.expires_at > now())
    from public.billing_entitlements entitlement
    where entitlement.user_id = requested_user_id
  ), false);
$$;

revoke all on function public.has_relay_pro(uuid) from public;
grant execute on function public.has_relay_pro(uuid) to service_role;

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
  if not public.has_relay_pro(actor) and exists (
    select 1 from public.organizations organization where organization.created_by = actor
  ) then
    raise exception 'RELAY_PRO_REQUIRED:organization' using errcode = 'P0001';
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

drop policy "admins create roles" on public.roles;

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
  if not public.is_organization_admin(requested_organization_id) then
    raise exception 'Organization admin access required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(requested_title, ''))) not between 1 and 100
    or char_length(coalesce(requested_description, '')) > 800 then
    raise exception 'Role details are invalid' using errcode = '22023';
  end if;
  if not public.has_relay_pro(actor) and exists (
    select 1 from public.roles role
    where role.created_by = actor and role.archived_at is null
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
  return created_role_id;
end;
$$;

revoke all on function public.create_role(uuid, text, text) from public;
grant execute on function public.create_role(uuid, text, text) to authenticated;

drop policy "admins create handoffs" on public.handoffs;

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
  actor uuid := (select auth.uid());
  created_handoff_id uuid;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not public.is_organization_admin(requested_organization_id) then
    raise exception 'Organization admin access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.roles role
    where role.id = requested_role_id
      and role.organization_id = requested_organization_id
      and role.archived_at is null
  ) then
    raise exception 'Active role unavailable' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(requested_service_period, ''))) not between 1 and 40 then
    raise exception 'Service period is invalid' using errcode = '22023';
  end if;
  if not public.has_relay_pro(actor) and exists (
    select 1 from public.handoffs handoff
    where handoff.created_by = actor and handoff.status <> 'archived'
  ) then
    raise exception 'RELAY_PRO_REQUIRED:handoff' using errcode = 'P0001';
  end if;

  insert into public.handoffs (
    organization_id, role_id, created_by, service_period, status, stage
  ) values (
    requested_organization_id,
    requested_role_id,
    actor,
    btrim(requested_service_period),
    'draft',
    'capture'
  )
  returning id into created_handoff_id;
  return created_handoff_id;
end;
$$;

revoke all on function public.create_handoff(uuid, uuid, text) from public;
grant execute on function public.create_handoff(uuid, uuid, text) to authenticated;

alter table public.handoff_publication_items
add column citation_sources jsonb not null default '[]'::jsonb
check (jsonb_typeof(citation_sources) = 'array');

create or replace function public.publish_handoff(requested_handoff_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_handoff public.handoffs;
  target_run public.preflight_runs;
  target_organization public.organizations;
  target_role public.roles;
  created_publication_id uuid;
  issued_token text := public.new_handoff_access_token();
begin
  select * into target_handoff
  from public.handoffs
  where id = requested_handoff_id and status = 'draft'
  for update;

  if actor is null or target_handoff.id is null
    or not public.is_organization_admin(target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;
  if target_handoff.stage <> 'preview' then
    raise exception 'Preview this handoff before publishing' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'proposed'
  ) then
    raise exception 'Review every proposal before publishing' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'approved'
  ) then
    raise exception 'Approve at least one knowledge item before publishing' using errcode = '22023';
  end if;

  select * into target_run
  from public.preflight_runs run
  where run.handoff_id = target_handoff.id and run.status = 'ready'
  order by run.created_at desc, run.id desc
  limit 1;
  if target_run.id is null then
    raise exception 'Run Preflight after the latest knowledge changes' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.preflight_findings finding
    where finding.run_id = target_run.id
      and finding.severity = 'critical'
      and finding.status <> 'resolved'
  ) and target_run.critical_acknowledged_at is null then
    raise exception 'Critical findings require deliberate acknowledgement' using errcode = '22023';
  end if;

  select * into target_organization
  from public.organizations where id = target_handoff.organization_id;
  select * into target_role
  from public.roles where id = target_handoff.role_id;

  insert into public.handoff_publications (
    organization_id, handoff_id, access_token, status,
    organization_name, organization_institution,
    role_title, role_description, service_period,
    published_by, published_at, revoked_by, revoked_at
  ) values (
    target_handoff.organization_id,
    target_handoff.id,
    issued_token,
    'active',
    target_organization.name,
    target_organization.institution,
    target_role.title,
    target_role.description,
    target_handoff.service_period,
    actor,
    now(),
    null,
    null
  )
  on conflict (handoff_id) do update set
    access_token = excluded.access_token,
    status = 'active',
    organization_name = excluded.organization_name,
    organization_institution = excluded.organization_institution,
    role_title = excluded.role_title,
    role_description = excluded.role_description,
    service_period = excluded.service_period,
    published_by = excluded.published_by,
    published_at = excluded.published_at,
    revoked_by = null,
    revoked_at = null
  returning id into created_publication_id;

  delete from public.handoff_publication_items item
  where item.publication_id = created_publication_id;

  insert into public.handoff_publication_items (
    publication_id, organization_id, handoff_id, source_knowledge_item_id,
    knowledge_type, title, content, sort_order, citation_sources
  )
  select
    created_publication_id,
    item.organization_id,
    item.handoff_id,
    item.id,
    item.knowledge_type,
    item.title,
    item.content,
    item.sort_order,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', source.title,
        'locator', link.source_locator
      ) order by source.created_at, source.id)
      from public.knowledge_item_sources link
      join public.sources source on source.id = link.source_id
      where link.knowledge_item_id = item.id
    ), '[]'::jsonb)
  from public.knowledge_items item
  where item.handoff_id = target_handoff.id and item.status = 'approved'
  order by item.sort_order, item.created_at, item.id;

  update public.handoffs
  set status = 'published', stage = 'published', published_at = now()
  where id = target_handoff.id;

  return issued_token;
end;
$$;

create table public.ask_usage_daily (
  publication_id uuid not null references public.handoff_publications(id) on delete cascade,
  usage_date date not null default current_date,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (publication_id, usage_date)
);

create index ask_usage_daily_owner_idx
on public.ask_usage_daily(owner_user_id, usage_date);

alter table public.ask_usage_daily enable row level security;

create or replace function public.claim_public_ask_request(
  requested_token text,
  requested_free_limit integer,
  requested_pro_limit integer
)
returns table (
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
  publication public.handoff_publications;
  current_count integer;
  effective_limit integer;
  caller_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  );
begin
  if caller_role <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if requested_free_limit < 1 or requested_free_limit > 1000
    or requested_pro_limit < requested_free_limit or requested_pro_limit > 10000 then
    raise exception 'Invalid Ask limit' using errcode = '22023';
  end if;

  select candidate.* into publication
  from public.handoff_publications candidate
  where candidate.access_token = requested_token and candidate.status = 'active';
  if publication.id is null then
    raise exception 'Published handoff unavailable' using errcode = 'P0002';
  end if;

  effective_limit := case
    when public.has_relay_pro(publication.published_by) then requested_pro_limit
    else requested_free_limit
  end;

  perform pg_advisory_xact_lock(hashtextextended(publication.id::text || current_date::text, 0));
  select usage.request_count into current_count
  from public.ask_usage_daily usage
  where usage.publication_id = publication.id and usage.usage_date = current_date;
  current_count := coalesce(current_count, 0);
  if current_count >= effective_limit then
    raise exception 'ASK_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.ask_usage_daily (publication_id, usage_date, owner_user_id, request_count)
  values (publication.id, current_date, publication.published_by, 1)
  on conflict on constraint ask_usage_daily_pkey do update
  set request_count = public.ask_usage_daily.request_count + 1,
      updated_at = now()
  returning request_count into current_count;

  return query select
    publication.id,
    publication.organization_id,
    publication.handoff_id,
    greatest(effective_limit - current_count, 0);
end;
$$;

revoke all on function public.claim_public_ask_request(text, integer, integer) from public;
grant execute on function public.claim_public_ask_request(text, integer, integer) to service_role;
