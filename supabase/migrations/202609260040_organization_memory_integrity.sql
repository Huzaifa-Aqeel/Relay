-- Keep Organization Memory grounded in immutable publication snapshots and
-- order academic periods structurally rather than by their display labels.

alter table public.handoffs
  add column period_start_year integer,
  add column period_end_year integer,
  add constraint handoffs_period_years_check check (
    (period_start_year is null and period_end_year is null)
    or (
      period_start_year between 1900 and 3000
      and period_end_year between period_start_year and period_start_year + 10
    )
  );

alter table public.handoff_publications
  add column period_start_year integer,
  add column period_end_year integer,
  add constraint handoff_publications_period_years_check check (
    (period_start_year is null and period_end_year is null)
    or (
      period_start_year between 1900 and 3000
      and period_end_year between period_start_year and period_start_year + 10
    )
  );

create function public.set_service_period_years()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parts text[];
  parsed_start integer;
  parsed_end integer;
begin
  parts := regexp_match(
    new.service_period,
    '^[[:space:]]*([0-9]{4})[[:space:]]*[-–—/][[:space:]]*([0-9]{2}|[0-9]{4})[[:space:]]*$'
  );

  if parts is null then
    new.period_start_year := null;
    new.period_end_year := null;
    return new;
  end if;

  parsed_start := parts[1]::integer;
  if char_length(parts[2]) = 2 then
    parsed_end := (parsed_start / 100) * 100 + parts[2]::integer;
    if parsed_end < parsed_start then parsed_end := parsed_end + 100; end if;
  else
    parsed_end := parts[2]::integer;
  end if;

  if parsed_start not between 1900 and 3000
    or parsed_end not between parsed_start and parsed_start + 10 then
    new.period_start_year := null;
    new.period_end_year := null;
  else
    new.period_start_year := parsed_start;
    new.period_end_year := parsed_end;
  end if;
  return new;
end;
$$;

create trigger handoffs_set_service_period_years
before insert or update of service_period on public.handoffs
for each row execute function public.set_service_period_years();

create trigger handoff_publications_set_service_period_years
before insert or update of service_period on public.handoff_publications
for each row execute function public.set_service_period_years();

-- Fire the parsing triggers for existing labels while preserving those labels.
update public.handoffs set service_period = service_period;
update public.handoff_publications publication
set period_start_year = handoff.period_start_year,
    period_end_year = handoff.period_end_year
from public.handoffs handoff
where handoff.id = publication.handoff_id;

create index handoffs_role_period_years_idx
on public.handoffs(role_id, period_start_year desc, period_end_year desc, published_at desc);

create index handoff_publications_period_years_idx
on public.handoff_publications(period_start_year desc, period_end_year desc, published_at desc);

-- Manual reason confirmation supports both the current broad categories and
-- historical category values. Policy-driven remains evidence-only.
create or replace function public.confirm_memory_change_reason_v13(
  requested_change_id uuid,
  requested_reason_category text,
  requested_explanation text,
  requested_lesson_knowledge_item_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.role_memory_changes;
  lesson public.knowledge_items;
  resulting_item public.knowledge_items;
  resulting_item_id uuid;
  before_type text;
  after_type text;
begin
  select * into target from public.role_memory_changes where id = requested_change_id;
  if actor is null or target.id is null or not public.can_view_role_history(target.role_id) then
    raise exception 'Memory change unavailable' using errcode = '42501';
  end if;
  if requested_reason_category not in (
    'lesson_driven', 'leadership_preference', 'contact_resource', 'unknown'
  ) then
    raise exception 'Policy-driven reasons require supporting approved policy evidence' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(requested_explanation, ''))) not between 1 and 1000 then
    raise exception 'A concise confirmation is required' using errcode = '22023';
  end if;

  before_type := target.before_snapshot->>'knowledgeType';
  after_type := target.after_snapshot->>'knowledgeType';
  if requested_reason_category = 'contact_resource'
    and coalesce(before_type, '') not in ('contact', 'access_resource', 'resource')
    and coalesce(after_type, '') not in ('contact', 'access_resource', 'resource') then
    raise exception 'This change is not grounded in contact or resource knowledge' using errcode = '22023';
  end if;

  if requested_reason_category = 'lesson_driven' then
    resulting_item_id := nullif(target.after_snapshot->>'sourceKnowledgeItemId', '')::uuid;
    select item.* into lesson
    from public.knowledge_items item
    join public.handoffs handoff on handoff.id = item.handoff_id
    where item.id = requested_lesson_knowledge_item_id
      and item.organization_id = target.organization_id
      and handoff.role_id = target.role_id
      and item.knowledge_type in ('warning_lesson', 'lesson')
      and item.status = 'approved';
    select item.* into resulting_item
    from public.knowledge_items item
    join public.handoffs handoff on handoff.id = item.handoff_id
    where item.id = resulting_item_id
      and item.organization_id = target.organization_id
      and handoff.role_id = target.role_id
      and item.knowledge_type in ('process', 'warning_lesson', 'warning', 'responsibility')
      and item.status = 'approved';
    if lesson.id is null or resulting_item.id is null then
      raise exception 'Choose an approved lesson and a resulting practice' using errcode = '22023';
    end if;
    insert into public.knowledge_relationships (
      organization_id, role_id, from_knowledge_item_id, to_knowledge_item_id,
      relationship_type, explanation, confirmed_by, created_by
    ) values (
      target.organization_id, target.role_id, lesson.id, resulting_item.id,
      'lesson_became_practice', btrim(requested_explanation), actor, actor
    ) on conflict (from_knowledge_item_id, to_knowledge_item_id, relationship_type)
      do update set explanation = excluded.explanation, confirmed_by = actor;
  elsif requested_lesson_knowledge_item_id is not null then
    raise exception 'A lesson link is only valid for a lesson-driven reason' using errcode = '22023';
  end if;

  update public.role_memory_changes set
    reason_category = requested_reason_category,
    reason_explanation = btrim(requested_explanation),
    human_confirmed = true,
    confirmed_by = actor,
    confirmed_at = now()
  where id = target.id;
end;
$$;

revoke all on function public.confirm_memory_change_reason_v13(uuid, text, text, uuid) from public;
grant execute on function public.confirm_memory_change_reason_v13(uuid, text, text, uuid) to authenticated;

