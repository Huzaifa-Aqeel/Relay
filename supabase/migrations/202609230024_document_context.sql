-- Optional typed context belongs to an attached document Source rather than
-- becoming an unrelated text Source.
alter table public.sources
add column document_context text check (
  document_context is null
  or (kind = 'document' and char_length(btrim(document_context)) between 1 and 50000)
);

comment on column public.sources.document_context is
  'Optional user context submitted with a document and organized as part of that Source.';

create or replace function public.protect_historical_source_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not old.is_current and (
    new.title is distinct from old.title
    or new.text_content is distinct from old.text_content
    or new.document_context is distinct from old.document_context
    or new.storage_path is distinct from old.storage_path
    or new.mime_type is distinct from old.mime_type
    or new.size_bytes is distinct from old.size_bytes
    or new.content_hash is distinct from old.content_hash
    or new.supersedes_source_id is distinct from old.supersedes_source_id
    or new.source_root_id is distinct from old.source_root_id
    or new.version_number is distinct from old.version_number
  ) then
    raise exception 'Historical source versions are immutable' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke update on public.sources from authenticated;
grant update (
  title, text_content, processing_status, failure_reason, structuring_status,
  structuring_failure_reason, structured_at, structured_proposal_count,
  delta_status, delta_failure_reason, delta_change_count, delta_analyzed_at,
  document_context
) on public.sources to authenticated;
