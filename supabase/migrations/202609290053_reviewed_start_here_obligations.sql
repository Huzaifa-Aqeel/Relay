-- Start Here is no longer inferred from categories or keywords in the client.
-- Organize may suggest the designation, but it reaches a publication only when
-- the outgoing Role Holder approves that Knowledge Item in Review.

alter table public.knowledge_items
  add column is_start_here boolean not null default false;

alter table public.handoff_publication_items
  add column is_start_here boolean not null default false;

comment on column public.knowledge_items.is_start_here is
  'Model-suggested Start Here designation. It is recipient-visible only after the Knowledge Item is approved by the outgoing Role Holder.';
comment on column public.handoff_publication_items.is_start_here is
  'Immutable snapshot of the reviewed Start Here designation at publication time.';

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
  suggested_for_start_here boolean;
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
    suggested_for_start_here := lower(btrim(coalesce(
      proposal->>'suggested_for_start_here',
      proposal->>'is_immediate_obligation',
      proposal->>'start_here',
      'false'
    ))) in ('true', 'yes', '1');

    insert into public.knowledge_items (
      organization_id, handoff_id, created_by, knowledge_type, title, content,
      status, origin, uncertainty_note, is_start_here,
      proposal_action, proposal_target_id, capture_id
    ) values (
      target_capture.organization_id, target_capture.handoff_id, actor,
      knowledge_type, title, content, 'proposed', 'ai', uncertainty,
      suggested_for_start_here, 'create', null, target_capture.id
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

create or replace function public.publish_handoff(requested_handoff_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_handoff public.handoffs;
  target_organization public.organizations;
  target_role public.roles;
  created_publication_id uuid;
  issued_token text := public.new_handoff_access_token();
begin
  select * into target_handoff from public.handoffs
  where id = requested_handoff_id and status = 'draft' for update;
  if actor is null or target_handoff.id is null
    or not public.is_role_holder_for_handoff(target_handoff.id)
    or not public.is_draft_handoff(target_handoff.id, target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;
  if target_handoff.stage <> 'preview' then
    raise exception 'Preview this handoff before publishing' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'proposed'
  ) then
    raise exception 'Review every proposal before publishing' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'approved'
  ) then
    raise exception 'Approve at least one knowledge item before publishing' using errcode = '22023';
  end if;

  select * into target_organization from public.organizations where id = target_handoff.organization_id;
  select * into target_role from public.roles where id = target_handoff.role_id;

  insert into public.handoff_publications (
    organization_id, handoff_id, access_token, status, organization_name,
    organization_institution, role_title, role_description, service_period,
    published_by, published_at, revoked_by, revoked_at
  ) values (
    target_handoff.organization_id, target_handoff.id, issued_token, 'active',
    target_organization.name, target_organization.institution, target_role.title,
    target_role.description, target_handoff.service_period, actor, now(), null, null
  ) on conflict (handoff_id) do update set
    access_token = excluded.access_token, status = 'active',
    organization_name = excluded.organization_name,
    organization_institution = excluded.organization_institution,
    role_title = excluded.role_title, role_description = excluded.role_description,
    service_period = excluded.service_period, published_by = excluded.published_by,
    published_at = excluded.published_at, revoked_by = null, revoked_at = null
  returning id into created_publication_id;

  delete from public.handoff_publication_items where publication_id = created_publication_id;
  insert into public.handoff_publication_items (
    publication_id, organization_id, handoff_id, source_knowledge_item_id,
    knowledge_lineage_id, knowledge_type, title, content, sort_order,
    is_start_here, citation_sources
  ) select
    created_publication_id, item.organization_id, item.handoff_id, item.id,
    item.lineage_id, item.knowledge_type, item.title, item.content, item.sort_order,
    item.is_start_here,
    coalesce((select jsonb_agg(jsonb_build_object(
      'label', source.title, 'locator', link.source_locator
    ) order by source.created_at, source.id)
    from public.knowledge_item_sources link
    join public.sources source on source.id = link.source_id
    where link.knowledge_item_id = item.id), '[]'::jsonb)
  from public.knowledge_items item
  where item.handoff_id = target_handoff.id and item.status = 'approved'
  order by item.sort_order, item.created_at, item.id;

  update public.handoffs set status = 'published', stage = 'published', published_at = now()
  where id = target_handoff.id;
  return issued_token;
end;
$$;

revoke all on function public.publish_handoff(uuid) from public;
grant execute on function public.publish_handoff(uuid) to authenticated;

create or replace function public.get_shared_handoff(requested_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'publicationId', publication.id,
    'organizationName', publication.organization_name,
    'organizationInstitution', publication.organization_institution,
    'roleTitle', publication.role_title,
    'roleDescription', publication.role_description,
    'servicePeriod', publication.service_period,
    'publishedAt', publication.published_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'knowledgeType', item.knowledge_type,
          'title', item.title,
          'content', item.content,
          'sortOrder', item.sort_order,
          'isStartHere', item.is_start_here
        ) order by item.sort_order, item.created_at, item.id
      )
      from public.handoff_publication_items item
      where item.publication_id = publication.id
    ), '[]'::jsonb)
  )
  from public.handoff_publications publication
  where char_length(requested_token) = 64
    and requested_token ~ '^[0-9a-f]{64}$'
    and publication.access_token = requested_token
    and publication.status = 'active';
$$;

revoke all on function public.get_shared_handoff(text) from public;
grant execute on function public.get_shared_handoff(text) to anon, authenticated;
