-- Human confirmation may establish preference/contact reasons or an explicit lesson-to-practice link.
create function public.confirm_memory_change_reason_v13(
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
  if actor is null or target.id is null or not public.is_organization_admin(target.organization_id) then
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
    and coalesce(before_type, '') not in ('contact', 'resource')
    and coalesce(after_type, '') not in ('contact', 'resource') then
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
      and item.knowledge_type = 'lesson'
      and item.status = 'approved';
    select item.* into resulting_item
    from public.knowledge_items item
    join public.handoffs handoff on handoff.id = item.handoff_id
    where item.id = resulting_item_id
      and item.organization_id = target.organization_id
      and handoff.role_id = target.role_id
      and item.knowledge_type in ('process', 'warning', 'responsibility')
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
