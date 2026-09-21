alter table public.sources
add column structuring_status text not null default 'not_started'
  check (structuring_status in ('not_started', 'processing', 'ready', 'failed')),
add column structuring_failure_reason text
  check (structuring_failure_reason is null or char_length(structuring_failure_reason) <= 500),
add column structured_at timestamptz,
add column structured_proposal_count integer
  check (structured_proposal_count is null or structured_proposal_count between 0 and 30),
add constraint sources_structuring_failure_state_check
  check (structuring_status = 'failed' or structuring_failure_reason is null),
add constraint sources_structured_at_state_check
  check (
    (structuring_status = 'ready') =
    (structured_at is not null and structured_proposal_count is not null)
  );

create or replace function public.reset_source_structuring_on_text_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.text_content is distinct from old.text_content then
    new.structuring_status := 'not_started';
    new.structuring_failure_reason := null;
    new.structured_at := null;
    new.structured_proposal_count := null;
  end if;
  return new;
end;
$$;

create trigger sources_reset_structuring_on_text_change
before update of text_content on public.sources
for each row execute function public.reset_source_structuring_on_text_change();

create or replace function public.replace_source_knowledge_proposals(
  requested_source_id uuid,
  requested_proposals jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_source public.sources;
  proposal jsonb;
  proposal_id uuid;
  proposal_count integer := 0;
  uncertainty text;
  locator text;
  excerpt text;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into target_source
  from public.sources
  where id = requested_source_id
  for update;

  if target_source.id is null
    or not public.is_organization_admin(target_source.organization_id) then
    raise exception 'Source unavailable' using errcode = '42501';
  end if;
  if target_source.processing_status <> 'ready' or target_source.text_content is null then
    raise exception 'Source text is not ready' using errcode = '22023';
  end if;
  if target_source.structuring_status <> 'processing' then
    raise exception 'Source is not awaiting structured proposals' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_proposals) <> 'array'
    or jsonb_array_length(requested_proposals) > 30 then
    raise exception 'Proposal output is invalid' using errcode = '22023';
  end if;

  delete from public.knowledge_items item
  where item.id in (
    select link.knowledge_item_id
    from public.knowledge_item_sources link
    where link.source_id = target_source.id
  )
    and item.origin = 'ai'
    and item.status = 'proposed';

  for proposal in select value from jsonb_array_elements(requested_proposals)
  loop
    if jsonb_typeof(proposal) <> 'object'
      or not proposal ?& array[
        'knowledge_type', 'title', 'content', 'uncertainty_note', 'source_excerpt', 'source_locator'
      ]
      or (select count(*) from jsonb_object_keys(proposal)) <> 6
      or jsonb_typeof(proposal->'knowledge_type') <> 'string'
      or jsonb_typeof(proposal->'title') <> 'string'
      or jsonb_typeof(proposal->'content') <> 'string'
      or jsonb_typeof(proposal->'source_excerpt') <> 'string'
      or jsonb_typeof(proposal->'uncertainty_note') not in ('string', 'null')
      or jsonb_typeof(proposal->'source_locator') not in ('string', 'null') then
      raise exception 'Proposal schema is invalid' using errcode = '22023';
    end if;

    if proposal->>'knowledge_type' not in (
      'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson'
    )
      or char_length(btrim(proposal->>'title')) not between 1 and 160
      or char_length(btrim(proposal->>'content')) not between 1 and 5000 then
      raise exception 'Proposal content is invalid' using errcode = '22023';
    end if;

    uncertainty := nullif(btrim(proposal->>'uncertainty_note'), '');
    locator := nullif(btrim(proposal->>'source_locator'), '');
    excerpt := btrim(proposal->>'source_excerpt');
    if (uncertainty is not null and char_length(uncertainty) > 500)
      or (locator is not null and char_length(locator) > 200)
      or char_length(excerpt) not between 1 and 2000
      or position(excerpt in target_source.text_content) = 0 then
      raise exception 'Proposal evidence is invalid' using errcode = '22023';
    end if;

    insert into public.knowledge_items (
      organization_id, handoff_id, created_by, knowledge_type, title, content,
      status, origin, uncertainty_note
    ) values (
      target_source.organization_id,
      target_source.handoff_id,
      actor,
      proposal->>'knowledge_type',
      btrim(proposal->>'title'),
      btrim(proposal->>'content'),
      'proposed',
      'ai',
      uncertainty
    ) returning id into proposal_id;

    insert into public.knowledge_item_sources (
      knowledge_item_id, source_id, handoff_id, organization_id, source_excerpt, source_locator
    ) values (
      proposal_id,
      target_source.id,
      target_source.handoff_id,
      target_source.organization_id,
      excerpt,
      locator
    );
    proposal_count := proposal_count + 1;
  end loop;

  update public.sources
  set structuring_status = 'ready',
      structuring_failure_reason = null,
      structured_at = now(),
      structured_proposal_count = proposal_count
  where id = target_source.id;

  return proposal_count;
end;
$$;

revoke all on function public.replace_source_knowledge_proposals(uuid, jsonb) from public;
grant execute on function public.replace_source_knowledge_proposals(uuid, jsonb) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.sources;
exception
  when duplicate_object then null;
end;
$$;
