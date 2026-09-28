-- Keep asynchronous document preparation tied to an explicit Capture-level
-- Organize request, and make abandoned processing recoverable from normal
-- Capture loading.

alter table public.captures
  add column organize_requested_at timestamptz;

comment on column public.captures.organize_requested_at is
  'Non-null only while an explicit Organize action is waiting for its current attachments. Cleared when generation starts, fails, or Capture content is saved again.';

create or replace function public.request_capture_organize(requested_capture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_capture public.captures;
begin
  select * into target_capture from public.captures
  where id = requested_capture_id for update;
  if target_capture.id is null
    or target_capture.submitted_at is null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id)
    or not public.is_draft_handoff(target_capture.handoff_id, target_capture.organization_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;

  -- A model call has already claimed this Capture. Do not create a second
  -- pending request behind it; callers may safely treat this as in progress.
  if target_capture.structuring_status = 'processing' then return; end if;

  update public.captures set
    organize_requested_at = now(),
    structuring_status = case
      when structuring_status = 'failed' then 'not_started'
      else structuring_status
    end,
    structuring_failure_reason = null,
    structured_at = case
      when structuring_status = 'failed' then null
      else structured_at
    end,
    structured_proposal_count = case
      when structuring_status = 'failed' then null
      else structured_proposal_count
    end,
    structured_dropped_count = case
      when structuring_status = 'failed' then null
      else structured_dropped_count
    end
  where id = target_capture.id;
end;
$$;

revoke all on function public.request_capture_organize(uuid) from public;
grant execute on function public.request_capture_organize(uuid) to authenticated;

create or replace function public.clear_capture_organize_request_on_content_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.organize_requested_at := null;
  return new;
end;
$$;

create trigger captures_clear_organize_request_on_content_write
before update of title, text_content, prompt_id on public.captures
for each row execute function public.clear_capture_organize_request_on_content_write();

create or replace function public.clear_capture_organize_request_on_status_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.structuring_status is distinct from old.structuring_status
    and new.structuring_status in ('processing', 'ready', 'failed') then
    new.organize_requested_at := null;
  end if;
  return new;
end;
$$;

create trigger captures_clear_organize_request_on_status_change
before update of structuring_status on public.captures
for each row execute function public.clear_capture_organize_request_on_status_change();

create or replace function public.sweep_stale_capture_processing(target_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_role_holder_for_handoff(target_handoff_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;

  update public.captures
  set structuring_status = 'failed',
      structuring_failure_reason = 'Organizing did not finish in time. Choose Organize to try again.',
      structured_at = null,
      structured_proposal_count = null,
      structured_dropped_count = null,
      organize_requested_at = null
  where handoff_id = target_handoff_id
    and structuring_status = 'processing'
    and updated_at < now() - interval '10 minutes';

  -- Mark an explicitly waiting Capture failed before touching the Source,
  -- because the Source updated_at trigger advances its timestamp.
  update public.captures capture
  set structuring_status = 'failed',
      structuring_failure_reason = 'Document processing did not finish in time. Choose Organize to try again.',
      structured_at = null,
      structured_proposal_count = null,
      structured_dropped_count = null,
      organize_requested_at = null
  where capture.handoff_id = target_handoff_id
    and capture.organize_requested_at is not null
    and exists (
      select 1
      from public.capture_sources relation
      join public.sources source on source.id = relation.source_id
      where relation.capture_id = capture.id
        and relation.relationship = 'attachment'
        and relation.removed_at is null
        and source.processing_status = 'processing'
        and source.updated_at < now() - interval '10 minutes'
    );

  update public.sources
  set processing_status = 'failed',
      failure_reason = 'Document processing did not finish in time. Choose Organize to try again.'
  where handoff_id = target_handoff_id
    and processing_status = 'processing'
    and updated_at < now() - interval '10 minutes';
end;
$$;

revoke all on function public.sweep_stale_capture_processing(uuid) from public;
grant execute on function public.sweep_stale_capture_processing(uuid) to authenticated;
