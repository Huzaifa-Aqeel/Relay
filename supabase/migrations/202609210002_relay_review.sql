create or replace function public.begin_handoff_review(requested_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_handoff public.handoffs;
begin
  select * into target_handoff
  from public.handoffs
  where id = requested_handoff_id and status = 'draft';

  if target_handoff.id is null
    or not public.is_organization_admin(target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = requested_handoff_id
      and item.status in ('proposed', 'approved')
  ) then
    raise exception 'Add or structure knowledge before review' using errcode = '22023';
  end if;

  update public.handoffs
  set stage = 'review'
  where id = requested_handoff_id;
end;
$$;

create or replace function public.return_handoff_to_capture(requested_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_handoff public.handoffs;
begin
  select * into target_handoff
  from public.handoffs
  where id = requested_handoff_id and status = 'draft';

  if target_handoff.id is null
    or not public.is_organization_admin(target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;

  update public.handoffs
  set stage = 'capture'
  where id = requested_handoff_id;
end;
$$;

create or replace function public.decide_knowledge_proposal(
  requested_item_id uuid,
  decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_item public.knowledge_items;
begin
  if decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  select * into target_item
  from public.knowledge_items
  where id = requested_item_id;

  if target_item.id is null
    or not public.is_organization_admin(target_item.organization_id) then
    raise exception 'Knowledge proposal unavailable' using errcode = '42501';
  end if;

  if target_item.origin <> 'ai' or target_item.status <> 'proposed' then
    raise exception 'Only pending AI proposals can be decided' using errcode = '22023';
  end if;

  update public.knowledge_items
  set status = decision
  where id = requested_item_id;
end;
$$;

revoke all on function public.begin_handoff_review(uuid) from public;
revoke all on function public.return_handoff_to_capture(uuid) from public;
revoke all on function public.decide_knowledge_proposal(uuid, text) from public;

grant execute on function public.begin_handoff_review(uuid) to authenticated;
grant execute on function public.return_handoff_to_capture(uuid) to authenticated;
grant execute on function public.decide_knowledge_proposal(uuid, text) to authenticated;
