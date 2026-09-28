-- Organize reliability: a lazy stale-processing reaper (no cron; sweep on
-- normal access) and
-- persisted visibility for suggestions Organize had to drop because they
-- could not be verified against their cited evidence.

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
      structured_at = null, structured_proposal_count = null
  where handoff_id = target_handoff_id
    and structuring_status = 'processing'
    and updated_at < now() - interval '10 minutes';

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

-- Sweep before the Review readiness check so abandoned processing cannot leave
-- the workflow stuck indefinitely.
create or replace function public.begin_handoff_review(requested_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_handoff public.handoffs;
begin
  select * into target_handoff from public.handoffs
  where id = requested_handoff_id and status = 'draft';
  if target_handoff.id is null
    or not public.is_role_holder_for_handoff(target_handoff.id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;

  perform public.sweep_stale_capture_processing(target_handoff.id);

  if exists (
    select 1 from public.captures capture
    where capture.handoff_id = target_handoff.id
      and capture.submitted_at is not null
      and capture.structuring_status <> 'ready'
  ) then
    raise exception 'Wait for every capture to finish organizing before Review' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = requested_handoff_id
      and item.status in ('proposed', 'approved')
  ) then
    raise exception 'Add and organize a capture before Review' using errcode = '22023';
  end if;
  update public.handoffs set stage = 'review' where id = requested_handoff_id;
end;
$$;

-- Persisted, queryable visibility for suggestions Organize dropped because
-- they could not be verified — previously only a server log line.
alter table public.captures add column structured_dropped_count integer
  check (structured_dropped_count is null or structured_dropped_count >= 0);

-- Adding a parameter changes the signature, so CREATE OR REPLACE below would
-- otherwise leave this exact (uuid,jsonb) overload behind as dead, callable
-- code instead of actually replacing it.
drop function if exists public.replace_capture_knowledge_proposals(uuid,jsonb);

create or replace function public.replace_capture_knowledge_proposals(
  requested_capture_id uuid,
  requested_proposals jsonb,
  requested_dropped_count integer default null
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
  if requested_dropped_count is not null and requested_dropped_count < 0 then
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
      'process', 'contact', 'rule_deadline', 'access_resource', 'warning_lesson'
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
    structured_at = now(), structured_proposal_count = proposal_count,
    structured_dropped_count = requested_dropped_count
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

revoke all on function public.replace_capture_knowledge_proposals(uuid,jsonb,integer) from public;
grant execute on function public.replace_capture_knowledge_proposals(uuid,jsonb,integer) to authenticated;
