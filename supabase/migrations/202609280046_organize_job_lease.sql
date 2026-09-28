-- Bound asynchronous Organize work to a short, recoverable lease. The model
-- request itself stops after two minutes; the extra minute allows the worker
-- to persist its terminal state before normal Capture loading reaps it.

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
    and updated_at < now() - interval '3 minutes';

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
        and source.updated_at < now() - interval '3 minutes'
    );

  update public.sources
  set processing_status = 'failed',
      failure_reason = 'Document processing did not finish in time. Choose Organize to try again.'
  where handoff_id = target_handoff_id
    and processing_status = 'processing'
    and updated_at < now() - interval '3 minutes';
end;
$$;

revoke all on function public.sweep_stale_capture_processing(uuid) from public;
grant execute on function public.sweep_stale_capture_processing(uuid) to authenticated;

-- Recover jobs abandoned by earlier synchronous function invocations at
-- deployment time. Capture and source content remain untouched.
update public.captures
set structuring_status = 'failed',
    structuring_failure_reason = 'Organizing did not finish in time. Choose Organize to try again.',
    structured_at = null,
    structured_proposal_count = null,
    structured_dropped_count = null,
    organize_requested_at = null
where structuring_status = 'processing'
  and updated_at < now() - interval '3 minutes';

update public.captures capture
set structuring_status = 'failed',
    structuring_failure_reason = 'Document processing did not finish in time. Choose Organize to try again.',
    structured_at = null,
    structured_proposal_count = null,
    structured_dropped_count = null,
    organize_requested_at = null
where capture.organize_requested_at is not null
  and exists (
    select 1
    from public.capture_sources relation
    join public.sources source on source.id = relation.source_id
    where relation.capture_id = capture.id
      and relation.relationship = 'attachment'
      and relation.removed_at is null
      and source.processing_status = 'processing'
      and source.updated_at < now() - interval '3 minutes'
  );

update public.sources
set processing_status = 'failed',
    failure_reason = 'Document processing did not finish in time. Choose Organize to try again.'
where processing_status = 'processing'
  and updated_at < now() - interval '3 minutes';

