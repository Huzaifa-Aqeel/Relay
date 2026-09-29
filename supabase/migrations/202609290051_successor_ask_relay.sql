-- Ask Relay belongs to the active incoming Role Holder and reads only the
-- immediately previous published Handoff for the same Organization + Role.
-- New-period drafts start empty; previous knowledge remains in immutable
-- History rather than being copied into the working draft.

create table public.ask_role_usage_claims (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.handoff_publications(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_date date not null default current_date,
  effective_limit integer not null check (effective_limit > 0),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'pending') = (completed_at is null))
);

create index ask_role_usage_claims_limit_idx
on public.ask_role_usage_claims(publication_id, user_id, usage_date, status, created_at);

alter table public.ask_role_usage_claims enable row level security;
revoke all on table public.ask_role_usage_claims from public, anon, authenticated;

create function public.can_ask_previous_handoff(requested_handoff_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.handoffs;
  current_assignment public.role_assignments;
  previous_handoff_id uuid;
begin
  if actor is null then return false; end if;

  select handoff.* into target
  from public.handoffs handoff
  where handoff.id = requested_handoff_id;
  if target.id is null or not exists (
    select 1 from public.handoff_publications publication
    where publication.handoff_id = target.id
  ) then return false; end if;
  if not coalesce(public.can_view_role_history(target.role_id), false) then return false; end if;

  select assignment.* into current_assignment
  from public.role_assignments assignment
  join public.organization_members member
    on member.organization_id = assignment.organization_id
    and member.user_id = assignment.user_id
    and member.status = 'active'
  where assignment.organization_id = target.organization_id
    and assignment.role_id = target.role_id
    and assignment.user_id = actor
    and assignment.status = 'active'
  order by public.service_period_start(assignment.service_period) desc,
    assignment.accepted_at desc, assignment.id desc
  limit 1;

  if current_assignment.id is null
    or public.service_period_start(current_assignment.service_period)
      <= public.service_period_start(target.service_period) then
    return false;
  end if;

  select previous_handoff.id into previous_handoff_id
  from public.handoff_publications publication
  join public.handoffs previous_handoff on previous_handoff.id = publication.handoff_id
  where previous_handoff.organization_id = target.organization_id
    and previous_handoff.role_id = target.role_id
    and public.service_period_start(previous_handoff.service_period)
      < public.service_period_start(current_assignment.service_period)
  order by public.service_period_start(previous_handoff.service_period) desc,
    publication.published_at desc, publication.id desc
  limit 1;

  return previous_handoff_id is not null and previous_handoff_id = target.id;
end;
$$;

revoke all on function public.can_ask_previous_handoff(uuid) from public, anon;
grant execute on function public.can_ask_previous_handoff(uuid) to authenticated;

create function public.claim_role_holder_ask_request(requested_handoff_id uuid)
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
  effective_limit integer;
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

  effective_limit := case
    when public.organization_has_relay_pro(publication.organization_id) then 100
    else 10
  end;

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

create function public.complete_role_holder_ask_request(
  requested_claim_id uuid,
  requested_succeeded boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.ask_role_usage_claims;
  active_count integer;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select claim.* into target
  from public.ask_role_usage_claims claim
  where claim.id = requested_claim_id and claim.user_id = actor
  for update;
  if target.id is null or target.status <> 'pending' then
    raise exception 'Ask request unavailable' using errcode = 'P0002';
  end if;

  update public.ask_role_usage_claims
  set status = case when requested_succeeded then 'succeeded' else 'failed' end,
      completed_at = now()
  where id = target.id;

  select count(*)::integer into active_count
  from public.ask_role_usage_claims claim
  where claim.publication_id = target.publication_id
    and claim.user_id = actor
    and claim.usage_date = target.usage_date
    and claim.status in ('pending', 'succeeded');

  return greatest(target.effective_limit - active_count, 0);
end;
$$;

revoke all on function public.claim_role_holder_ask_request(uuid),
  public.complete_role_holder_ask_request(uuid, boolean) from public, anon;
grant execute on function public.claim_role_holder_ask_request(uuid),
  public.complete_role_holder_ask_request(uuid, boolean) to authenticated;

-- Public token-based Ask is no longer an active product path.
drop function if exists public.claim_public_ask_request(text, integer, integer);

-- A newly accepted service period starts with an empty working Handoff.
-- Mid-year replacements still receive the same existing-period workspace.
create or replace function public.create_handoff_for_accepted_assignment(
  requested_organization_id uuid,
  requested_role_id uuid,
  requested_service_period text,
  requested_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_handoff_id uuid;
begin
  if auth.uid() is null or auth.uid() is distinct from requested_created_by then
    raise exception 'Authenticated assignee required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.role_assignments assignment
    join public.roles role
      on role.id = assignment.role_id
      and role.organization_id = assignment.organization_id
    where assignment.organization_id = requested_organization_id
      and assignment.role_id = requested_role_id
      and assignment.user_id = requested_created_by
      and assignment.service_period = requested_service_period
      and assignment.status = 'active'
      and role.archived_at is null
  ) then
    raise exception 'Active Role Assignment required' using errcode = '42501';
  end if;

  select handoff.id into created_handoff_id
  from public.handoffs handoff
  where handoff.role_id = requested_role_id
    and handoff.service_period = requested_service_period;
  if created_handoff_id is not null then return created_handoff_id; end if;

  insert into public.handoffs(
    organization_id, role_id, created_by, service_period
  ) values (
    requested_organization_id, requested_role_id,
    requested_created_by, requested_service_period
  ) returning id into created_handoff_id;

  return created_handoff_id;
end;
$$;

revoke all on function public.create_handoff_for_accepted_assignment(uuid, uuid, text, uuid)
from public, anon, authenticated;

-- Remove only working-draft copies. Immutable previous publications and their
-- historical Handoffs remain untouched and readable in Role History.
delete from public.knowledge_items item
using public.handoffs handoff
where item.handoff_id = handoff.id
  and item.origin = 'inherited'
  and handoff.status = 'draft';

-- Preserve ordinary publication lineage without copying predecessor content
-- into a new draft. Reuse the immediately previous publication lineage only
-- for one unambiguous same-category normalized-title match.
create function public.reuse_previous_publication_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_handoff public.handoffs;
  previous_publication_id uuid;
  matched_lineage_id uuid;
  match_count integer;
  normalized_category text;
begin
  select handoff.* into current_handoff
  from public.handoffs handoff where handoff.id = new.handoff_id;

  select publication.id into previous_publication_id
  from public.handoff_publications publication
  join public.handoffs previous_handoff on previous_handoff.id = publication.handoff_id
  where previous_handoff.organization_id = current_handoff.organization_id
    and previous_handoff.role_id = current_handoff.role_id
    and previous_handoff.id <> current_handoff.id
    and public.service_period_start(previous_handoff.service_period)
      < public.service_period_start(current_handoff.service_period)
  order by public.service_period_start(previous_handoff.service_period) desc,
    publication.published_at desc, publication.id desc
  limit 1;

  if previous_publication_id is null then return new; end if;

  normalized_category := case
    when new.knowledge_type in ('responsibility', 'process') then 'process'
    when new.knowledge_type in ('deadline', 'rule_deadline') then 'rule_deadline'
    when new.knowledge_type in ('warning', 'lesson', 'warning_lesson') then 'warning_lesson'
    when new.knowledge_type in ('resource', 'access_resource') then 'access_resource'
    else new.knowledge_type
  end;

  select count(*)::integer,
    min(previous_item.knowledge_lineage_id::text)::uuid
  into match_count, matched_lineage_id
  from public.handoff_publication_items previous_item
  where previous_item.publication_id = previous_publication_id
    and regexp_replace(lower(btrim(previous_item.title)), '[^a-z0-9]+', '', 'g')
      = regexp_replace(lower(btrim(new.title)), '[^a-z0-9]+', '', 'g')
    and case
      when previous_item.knowledge_type in ('responsibility', 'process') then 'process'
      when previous_item.knowledge_type in ('deadline', 'rule_deadline') then 'rule_deadline'
      when previous_item.knowledge_type in ('warning', 'lesson', 'warning_lesson') then 'warning_lesson'
      when previous_item.knowledge_type in ('resource', 'access_resource') then 'access_resource'
      else previous_item.knowledge_type
    end = normalized_category;

  if match_count = 1 and matched_lineage_id is not null then
    new.knowledge_lineage_id := matched_lineage_id;
  end if;
  return new;
end;
$$;

revoke all on function public.reuse_previous_publication_lineage() from public, anon, authenticated;
drop trigger if exists handoff_publication_items_reuse_previous_lineage
on public.handoff_publication_items;
create trigger handoff_publication_items_reuse_previous_lineage
before insert on public.handoff_publication_items
for each row execute function public.reuse_previous_publication_lineage();
