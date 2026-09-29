-- Qwen returns immediate transition obligations in their own array instead of
-- classifying every normal proposal. The Edge normalizer marks only those rows
-- with the private review section used by the existing reviewed snapshot flow.

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
  evidence_source public.sources;
  proposal jsonb;
  citation jsonb;
  proposal_id uuid;
  proposal_count integer := 0;
  knowledge_type text;
  title text;
  content text;
  uncertainty text;
  is_immediate_transition boolean;
  source_id_text text;
  excerpt text;
  locator text;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into target_capture
  from public.captures
  where id = requested_capture_id
  for update;
  if target_capture.id is null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;
  if target_capture.submitted_at is null
    or target_capture.structuring_status <> 'processing' then
    raise exception 'Capture is not awaiting suggestions' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_proposals) <> 'array' then
    raise exception 'Suggestion output is invalid' using errcode = '22023';
  end if;

  delete from public.knowledge_items item
  where item.capture_id = target_capture.id
    and item.origin = 'ai'
    and item.status = 'proposed';

  for proposal in
    select value
    from jsonb_array_elements(requested_proposals)
    limit 30
  loop
    if jsonb_typeof(proposal) <> 'object' then
      continue;
    end if;

    knowledge_type := proposal->>'knowledge_type';
    if knowledge_type not in (
      'process', 'contact', 'rule_deadline', 'access_resource', 'warning_lesson'
    ) then
      knowledge_type := 'process';
    end if;
    title := left(btrim(coalesce(proposal->>'title', '')), 160);
    content := left(btrim(coalesce(proposal->>'content', '')), 5000);
    if content = '' and title <> '' then content := title; end if;
    if title = '' and content <> '' then title := left(content, 160); end if;
    if title = '' or content = '' then
      continue;
    end if;
    uncertainty := nullif(left(btrim(coalesce(proposal->>'uncertainty_note', '')), 500), '');
    is_immediate_transition := coalesce(proposal->>'review_section', '') = 'immediate_transition';

    insert into public.knowledge_items (
      organization_id, handoff_id, created_by, knowledge_type, title, content,
      status, origin, uncertainty_note, is_start_here,
      proposal_action, proposal_target_id, capture_id
    ) values (
      target_capture.organization_id, target_capture.handoff_id, actor,
      knowledge_type, title, content, 'proposed', 'ai', uncertainty,
      is_immediate_transition, 'create', null, target_capture.id
    ) returning id into proposal_id;

    if jsonb_typeof(proposal->'citations') = 'array' then
      for citation in select value from jsonb_array_elements(proposal->'citations')
      loop
        if jsonb_typeof(citation) <> 'object' then continue; end if;
        source_id_text := coalesce(citation->>'source_id', citation->>'evidence_source_id');
        select source.* into evidence_source
        from public.capture_sources link
        join public.sources source on source.id = link.source_id
        where link.capture_id = target_capture.id
          and link.removed_at is null
          and source.id::text = source_id_text
          and source.processing_status = 'ready';
        if not found then continue; end if;

        excerpt := nullif(left(btrim(coalesce(citation->>'source_excerpt', '')), 2000), '');
        if excerpt is not null
          and (evidence_source.text_content is null
            or position(excerpt in evidence_source.text_content) = 0) then
          excerpt := null;
        end if;
        locator := nullif(left(btrim(coalesce(citation->>'source_locator', '')), 200), '');

        insert into public.knowledge_item_sources (
          knowledge_item_id, source_id, handoff_id, organization_id,
          source_excerpt, source_locator
        ) values (
          proposal_id, evidence_source.id, target_capture.handoff_id,
          target_capture.organization_id, excerpt, locator
        )
        on conflict (knowledge_item_id, source_id) do update set
          source_excerpt = coalesce(excluded.source_excerpt, knowledge_item_sources.source_excerpt),
          source_locator = coalesce(excluded.source_locator, knowledge_item_sources.source_locator);
      end loop;
    end if;

    proposal_count := proposal_count + 1;
  end loop;

  update public.captures set
    structuring_status = 'ready',
    structuring_failure_reason = null,
    structured_at = now(),
    structured_proposal_count = proposal_count,
    structured_dropped_count = 0
  where id = target_capture.id;

  update public.sources source set
    structuring_status = 'ready',
    structuring_failure_reason = null,
    structured_at = now(),
    structured_proposal_count = (
      select count(*)::integer
      from public.knowledge_items item
      join public.knowledge_item_sources provenance
        on provenance.knowledge_item_id = item.id
      where item.capture_id = target_capture.id
        and provenance.source_id = source.id
    )
  where source.id in (
    select relation.source_id
    from public.capture_sources relation
    where relation.capture_id = target_capture.id
      and relation.removed_at is null
  ) and source.processing_status = 'ready';

  return proposal_count;
end;
$$;

revoke all on function public.replace_capture_knowledge_proposals(uuid, jsonb, integer)
from public;
grant execute on function public.replace_capture_knowledge_proposals(uuid, jsonb, integer)
to authenticated;
