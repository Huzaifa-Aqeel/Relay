alter table public.billing_entitlements rename to organization_subscriptions;
alter table public.organization_subscriptions rename column user_id to purchaser_user_id;
alter table public.organization_subscriptions rename column entitlement_identifier to entitlement_id;

drop trigger billing_entitlements_set_updated_at on public.organization_subscriptions;
drop policy "users read their billing entitlement" on public.organization_subscriptions;

alter table public.organization_subscriptions
  add column id uuid not null default gen_random_uuid(),
  add column organization_id uuid,
  add column revenuecat_app_user_id text,
  add column status text;

update public.organization_subscriptions subscription
set revenuecat_app_user_id = subscription.purchaser_user_id::text,
    status = case when subscription.is_pro then 'active' else 'inactive' end,
    organization_id = (
      select organization.id
      from public.organizations organization
      where organization.created_by = subscription.purchaser_user_id
      order by organization.created_at, organization.id
      limit 1
    )
where (
  select count(*) from public.organizations organization
  where organization.created_by = subscription.purchaser_user_id
) = 1;

update public.organization_subscriptions subscription
set revenuecat_app_user_id = subscription.purchaser_user_id::text,
    status = case when subscription.is_pro then 'active' else 'inactive' end
where subscription.revenuecat_app_user_id is null;

alter table public.organization_subscriptions
  drop constraint billing_entitlements_pkey,
  drop constraint billing_entitlements_user_id_fkey,
  drop column is_pro,
  alter column purchaser_user_id drop not null,
  alter column revenuecat_app_user_id set not null,
  alter column status set not null,
  add constraint organization_subscriptions_pkey primary key (id),
  add constraint organization_subscriptions_purchaser_fkey
    foreign key (purchaser_user_id) references public.profiles(id) on delete set null,
  add constraint organization_subscriptions_organization_fkey
    foreign key (organization_id) references public.organizations(id) on delete set null,
  add constraint organization_subscriptions_revenuecat_entitlement_key
    unique (revenuecat_app_user_id, entitlement_id),
  add constraint organization_subscriptions_organization_key unique (organization_id),
  add constraint organization_subscriptions_status_check check (status in ('active', 'inactive')),
  add constraint organization_subscriptions_revenuecat_id_check
    check (char_length(btrim(revenuecat_app_user_id)) between 1 and 255);

create index organization_subscriptions_purchaser_idx
on public.organization_subscriptions(purchaser_user_id, status);

create trigger organization_subscriptions_set_updated_at
before update on public.organization_subscriptions
for each row execute function public.set_updated_at();

create policy "purchasers read their subscription association"
on public.organization_subscriptions
for select to authenticated
using (purchaser_user_id = (select auth.uid()));

create or replace function public.organization_has_relay_pro(requested_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_subscriptions subscription
    where subscription.organization_id = requested_organization_id
      and subscription.status = 'active'
      and (subscription.expires_at is null or subscription.expires_at > now())
  );
$$;

create or replace function public.purchaser_has_active_relay_pro(requested_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_subscriptions subscription
    where subscription.purchaser_user_id = requested_user_id
      and subscription.organization_id is not null
      and subscription.status = 'active'
      and (subscription.expires_at is null or subscription.expires_at > now())
  );
$$;

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
    'expiresAt', subscription.expires_at
  );
end;
$$;

revoke all on function public.organization_has_relay_pro(uuid) from public;
revoke all on function public.purchaser_has_active_relay_pro(uuid) from public;
revoke all on function public.get_organization_plan(uuid) from public;
grant execute on function public.organization_has_relay_pro(uuid) to service_role;
grant execute on function public.purchaser_has_active_relay_pro(uuid) to service_role;
grant execute on function public.get_organization_plan(uuid) to authenticated;

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
  if not public.purchaser_has_active_relay_pro(actor) and exists (
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
  if not public.organization_has_relay_pro(requested_organization_id) and exists (
    select 1 from public.handoffs handoff
    where handoff.organization_id = requested_organization_id and handoff.status <> 'archived'
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
    when public.organization_has_relay_pro(publication.organization_id) then requested_pro_limit
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

drop function public.has_relay_pro(uuid);
