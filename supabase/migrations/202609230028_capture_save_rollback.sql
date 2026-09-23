-- Keep hosted environments aligned after the editable Capture migration was
-- expanded with rollback protection for partially uploaded attachment batches.
create or replace function public.rollback_capture_attachment(
  requested_capture_id uuid,
  requested_source_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_capture public.captures;
  target_source public.sources;
  relation public.capture_sources;
  remaining_links integer;
  removed_storage_path text;
begin
  select * into target_capture from public.captures
  where id = requested_capture_id for update;
  if target_capture.id is null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id)
    or not public.is_draft_handoff(target_capture.handoff_id, target_capture.organization_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;

  select * into relation from public.capture_sources
  where capture_id = requested_capture_id
    and source_id = requested_source_id
    and relationship = 'attachment';
  if relation.capture_id is null then
    return null;
  end if;

  delete from public.capture_sources
  where capture_id = requested_capture_id and source_id = requested_source_id;

  if relation.created_for_capture then
    select count(*) into remaining_links from public.capture_sources
    where source_id = requested_source_id;
    select * into target_source from public.sources where id = requested_source_id;
    if remaining_links = 0 and target_source.processing_status = 'pending' then
      removed_storage_path := target_source.storage_path;
      delete from public.sources where id = requested_source_id;
      return removed_storage_path;
    end if;
  end if;

  return null;
end;
$$;

revoke all on function public.rollback_capture_attachment(uuid,uuid) from public;
grant execute on function public.rollback_capture_attachment(uuid,uuid) to authenticated;
