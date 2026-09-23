-- Simplify working Capture persistence:
-- Save changes only database/storage state. Organize alone processes files and
-- generates suggestions. Document versions/deltas are no longer product data.

drop function if exists public.replace_source_version_changes(uuid, jsonb);
drop table if exists public.source_version_changes cascade;

drop trigger if exists sources_prepare_version on public.sources;
drop trigger if exists sources_protect_historical_version on public.sources;
drop function if exists public.prepare_source_version();
drop function if exists public.protect_historical_source_version();

drop index if exists public.sources_root_version_idx;
drop index if exists public.sources_one_current_version_idx;
drop index if exists public.sources_handoff_current_idx;

alter table public.sources
  drop constraint if exists sources_version_kind_check,
  drop constraint if exists sources_delta_state_check,
  drop constraint if exists sources_processing_status_check;

alter table public.sources
  add constraint sources_processing_status_check check (
    processing_status in ('pending', 'processing', 'ready', 'failed')
  );

alter table public.sources
  drop column if exists normalized_filename,
  drop column if exists supersedes_source_id,
  drop column if exists source_root_id,
  drop column if exists version_number,
  drop column if exists is_current,
  drop column if exists version_match_basis,
  drop column if exists delta_status,
  drop column if exists delta_failure_reason,
  drop column if exists delta_change_count,
  drop column if exists delta_analyzed_at,
  drop column if exists document_context;

alter table public.capture_sources
  add column removed_at timestamptz;

create index capture_sources_capture_active_idx
on public.capture_sources(capture_id, position)
where removed_at is null;

comment on column public.capture_sources.removed_at is
  'Transient cleanup marker. Removed attachments are purged from Storage/Astra on the next explicit Organize.';

create or replace function public.attach_source_to_capture(
  requested_capture_id uuid,
  requested_source_id uuid,
  requested_position integer,
  requested_created_for_capture boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_capture public.captures;
  target_source public.sources;
begin
  select * into target_capture from public.captures
  where id = requested_capture_id for update;
  if target_capture.id is null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id)
    or not public.is_draft_handoff(target_capture.handoff_id, target_capture.organization_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;
  select * into target_source from public.sources where id = requested_source_id;
  if target_source.id is null
    or target_source.kind <> 'document'
    or target_source.organization_id <> target_capture.organization_id
    or target_source.handoff_id <> target_capture.handoff_id
    or requested_position < 0 then
    raise exception 'Attachment unavailable' using errcode = '22023';
  end if;
  insert into public.capture_sources (
    capture_id, source_id, organization_id, handoff_id,
    relationship, position, created_for_capture, removed_at
  ) values (
    target_capture.id, target_source.id, target_capture.organization_id,
    target_capture.handoff_id, 'attachment', requested_position,
    requested_created_for_capture, null
  ) on conflict (capture_id, source_id) do update set
    position = excluded.position,
    removed_at = null;
end;
$$;

create or replace function public.save_capture(
  requested_capture_id uuid,
  requested_title text,
  requested_prompt_id text,
  requested_text_content text,
  requested_attachment_source_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_capture public.captures;
  text_source_id uuid;
  clean_text text := nullif(btrim(requested_text_content), '');
  attachment_ids uuid[] := coalesce(requested_attachment_source_ids, array[]::uuid[]);
begin
  select * into target_capture from public.captures
  where id = requested_capture_id for update;
  if actor is null
    or target_capture.id is null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id)
    or not public.is_draft_handoff(target_capture.handoff_id, target_capture.organization_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;
  if char_length(btrim(requested_title)) not between 1 and 160
    or (clean_text is not null and char_length(clean_text) > 50000)
    or (requested_prompt_id is not null and requested_prompt_id not in (
      'role-responsibilities', 'annual-registration-training', 'finances-budget',
      'recurring-events', 'advisor-vendor-contacts', 'account-tool-access',
      'calendars-deadlines', 'constitution-policies', 'lessons-common-mistakes'
    )) then
    raise exception 'Capture content is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(attachment_ids) attachment_id
    where not exists (
      select 1 from public.capture_sources relation
      join public.sources source on source.id = relation.source_id
      where relation.capture_id = target_capture.id
        and relation.source_id = attachment_id
        and relation.relationship = 'attachment'
        and source.kind = 'document'
    )
  ) then
    raise exception 'Capture attachment is unavailable' using errcode = '22023';
  end if;
  if clean_text is null and cardinality(attachment_ids) = 0 then
    raise exception 'Add text or a file before saving' using errcode = '22023';
  end if;

  select relation.source_id into text_source_id
  from public.capture_sources relation
  where relation.capture_id = target_capture.id and relation.relationship = 'text';

  if clean_text is null and text_source_id is not null then
    delete from public.capture_sources
    where capture_id = target_capture.id and source_id = text_source_id;
    delete from public.sources where id = text_source_id;
  elsif clean_text is not null and text_source_id is null then
    insert into public.sources (
      organization_id, handoff_id, created_by, kind, title, text_content,
      processing_status, structuring_status, structured_at, structured_proposal_count
    ) values (
      target_capture.organization_id, target_capture.handoff_id, actor,
      'typed_text', 'Capture note', clean_text, 'ready', 'ready', now(), 0
    ) returning id into text_source_id;
    insert into public.capture_sources (
      capture_id, source_id, organization_id, handoff_id,
      relationship, position, created_for_capture, removed_at
    ) values (
      target_capture.id, text_source_id, target_capture.organization_id,
      target_capture.handoff_id, 'text', 0, true, null
    );
  elsif clean_text is not null then
    update public.sources set
      title = 'Capture note', text_content = clean_text,
      processing_status = 'ready', failure_reason = null
    where id = text_source_id;
  end if;

  update public.capture_sources set removed_at = case
    when source_id = any(attachment_ids) then null
    else coalesce(removed_at, now())
  end
  where capture_id = target_capture.id and relationship = 'attachment';

  delete from public.knowledge_items item
  where item.capture_id = target_capture.id
    and item.origin = 'ai' and item.status = 'proposed';

  update public.captures set
    title = btrim(requested_title),
    text_content = clean_text,
    prompt_id = requested_prompt_id,
    submitted_at = coalesce(submitted_at, now()),
    structuring_status = 'not_started',
    structuring_failure_reason = null,
    structured_at = null,
    structured_proposal_count = null
  where id = target_capture.id;

  update public.handoffs set stage = 'capture'
  where id = target_capture.handoff_id and status = 'draft';
end;
$$;

create or replace function public.discard_capture_draft(requested_capture_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_capture public.captures;
begin
  select * into target_capture from public.captures
  where id = requested_capture_id for update;
  if target_capture.id is null then return; end if;
  if target_capture.submitted_at is not null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;
  delete from public.sources source
  where source.id in (
    select relation.source_id from public.capture_sources relation
    where relation.capture_id = target_capture.id and relation.created_for_capture
  );
  delete from public.captures where id = target_capture.id;
end;
$$;

create or replace function public.replace_capture_knowledge_proposals(
  requested_capture_id uuid,
  requested_proposals jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_capture public.captures;
  target_item public.knowledge_items;
  evidence_source public.sources;
  proposal jsonb;
  proposal_id uuid;
  proposal_count integer := 0;
  action text;
  target_id uuid;
  evidence_id uuid;
  uncertainty text;
  locator text;
  excerpt text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into target_capture from public.captures
  where id = requested_capture_id for update;
  if target_capture.id is null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;
  if target_capture.submitted_at is null or target_capture.structuring_status <> 'processing' then
    raise exception 'Capture is not awaiting suggestions' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_proposals) <> 'array'
    or jsonb_array_length(requested_proposals) > 30 then
    raise exception 'Suggestion output is invalid' using errcode = '22023';
  end if;

  delete from public.knowledge_items item
  where item.capture_id = target_capture.id
    and item.origin = 'ai' and item.status = 'proposed';

  for proposal in select value from jsonb_array_elements(requested_proposals)
  loop
    if jsonb_typeof(proposal) <> 'object'
      or not proposal ?& array[
        'proposal_action', 'target_knowledge_item_id', 'knowledge_type', 'title',
        'content', 'uncertainty_note', 'evidence_source_id', 'source_excerpt',
        'source_locator'
      ]
      or (select count(*) from jsonb_object_keys(proposal)) <> 9 then
      raise exception 'Suggestion schema is invalid' using errcode = '22023';
    end if;
    action := proposal->>'proposal_action';
    target_id := nullif(proposal->>'target_knowledge_item_id', '')::uuid;
    evidence_id := nullif(proposal->>'evidence_source_id', '')::uuid;
    if action not in ('create', 'update', 'retire')
      or (action = 'create' and target_id is not null)
      or (action <> 'create' and target_id is null) then
      raise exception 'Suggestion action is invalid' using errcode = '22023';
    end if;
    if target_id is not null then
      select * into target_item from public.knowledge_items
      where id = target_id and handoff_id = target_capture.handoff_id and status = 'approved';
      if target_item.id is null then
        raise exception 'Suggestion target is unavailable' using errcode = '22023';
      end if;
    end if;
    select source.* into evidence_source
    from public.capture_sources link
    join public.sources source on source.id = link.source_id
    where link.capture_id = target_capture.id and link.removed_at is null
      and source.id = evidence_id and source.processing_status = 'ready';
    if evidence_source.id is null or evidence_source.text_content is null then
      raise exception 'Suggestion evidence is unavailable' using errcode = '22023';
    end if;
    if proposal->>'knowledge_type' not in (
      'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson'
    ) or char_length(btrim(proposal->>'title')) not between 1 and 160
      or char_length(btrim(proposal->>'content')) not between 1 and 5000 then
      raise exception 'Suggestion content is invalid' using errcode = '22023';
    end if;
    uncertainty := nullif(btrim(proposal->>'uncertainty_note'), '');
    locator := nullif(btrim(proposal->>'source_locator'), '');
    excerpt := btrim(proposal->>'source_excerpt');
    if (uncertainty is not null and char_length(uncertainty) > 500)
      or (locator is not null and char_length(locator) > 200)
      or char_length(excerpt) not between 1 and 2000
      or position(excerpt in evidence_source.text_content) = 0 then
      raise exception 'Suggestion evidence is invalid' using errcode = '22023';
    end if;

    insert into public.knowledge_items (
      organization_id, handoff_id, created_by, knowledge_type, title, content,
      status, origin, uncertainty_note, proposal_action, proposal_target_id, capture_id
    ) values (
      target_capture.organization_id, target_capture.handoff_id, actor,
      proposal->>'knowledge_type', btrim(proposal->>'title'), btrim(proposal->>'content'),
      'proposed', 'ai', uncertainty, action, target_id, target_capture.id
    ) returning id into proposal_id;
    insert into public.knowledge_item_sources (
      knowledge_item_id, source_id, handoff_id, organization_id,
      source_excerpt, source_locator
    ) values (
      proposal_id, evidence_source.id, target_capture.handoff_id,
      target_capture.organization_id, excerpt, locator
    );
    proposal_count := proposal_count + 1;
  end loop;

  update public.captures set
    structuring_status = 'ready', structuring_failure_reason = null,
    structured_at = now(), structured_proposal_count = proposal_count
  where id = target_capture.id;

  update public.sources source set
    structuring_status = 'ready', structuring_failure_reason = null,
    structured_at = now(),
    structured_proposal_count = (
      select count(*)::integer
      from public.knowledge_items item
      join public.knowledge_item_sources provenance on provenance.knowledge_item_id = item.id
      where item.capture_id = target_capture.id and provenance.source_id = source.id
    )
  where source.id in (
    select relation.source_id from public.capture_sources relation
    where relation.capture_id = target_capture.id and relation.removed_at is null
  ) and source.processing_status = 'ready';

  return proposal_count;
end;
$$;

drop function if exists public.finalize_capture(uuid);

revoke all on function public.save_capture(uuid,text,text,text,uuid[]) from public;
grant execute on function public.save_capture(uuid,text,text,text,uuid[]) to authenticated;
revoke all on function public.attach_source_to_capture(uuid,uuid,integer,boolean) from public;
grant execute on function public.attach_source_to_capture(uuid,uuid,integer,boolean) to authenticated;
revoke all on function public.discard_capture_draft(uuid) from public;
grant execute on function public.discard_capture_draft(uuid) to authenticated;
revoke all on function public.replace_capture_knowledge_proposals(uuid,jsonb) from public;
grant execute on function public.replace_capture_knowledge_proposals(uuid,jsonb) to authenticated;
