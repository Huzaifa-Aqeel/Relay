-- Organization Memory compares atomic operational claims instead of assuming
-- that one whole Knowledge Item will keep the same title and shape every year.
-- Published Handoff snapshots remain immutable; this is a replaceable derived
-- index that always points back to approved publication items.

create table public.role_memory_topics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  canonical_key text not null check (
    char_length(canonical_key) between 1 and 120
    and canonical_key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
  ),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (id, organization_id, role_id)
);

create index role_memory_topics_scope_idx
on public.role_memory_topics(organization_id, role_id, created_at, id);

create table public.publication_memory_indexes (
  publication_id uuid primary key references public.handoff_publications(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  index_version integer not null check (index_version > 0),
  status text not null check (status in ('building', 'ready', 'failed')),
  claim_count integer not null default 0 check (claim_count between 0 and 200),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  created_by uuid not null references public.profiles(id) on delete cascade,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publication_id, organization_id, role_id)
);

create trigger publication_memory_indexes_set_updated_at
before update on public.publication_memory_indexes
for each row execute function public.set_updated_at();

create table public.publication_memory_claims (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
  organization_id uuid not null,
  role_id uuid not null,
  topic_id uuid not null,
  knowledge_type text not null check (
    knowledge_type in ('process', 'contact', 'rule_deadline', 'access_resource', 'warning_lesson')
  ),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  comparison_value text not null check (char_length(btrim(comparison_value)) between 1 and 1000),
  claim_state text not null default 'active' check (
    claim_state in ('active', 'pending', 'resolved', 'retired')
  ),
  primary_publication_item_id uuid not null references public.handoff_publication_items(id) on delete cascade,
  source_publication_item_ids uuid[] not null check (
    cardinality(source_publication_item_ids) between 1 and 16
  ),
  citation_sources jsonb not null default '[]'::jsonb check (
    jsonb_typeof(citation_sources) = 'array'
  ),
  created_at timestamptz not null default now(),
  foreign key (publication_id, organization_id, role_id)
    references public.publication_memory_indexes(publication_id, organization_id, role_id)
    on delete cascade,
  foreign key (topic_id, organization_id, role_id)
    references public.role_memory_topics(id, organization_id, role_id)
    on delete restrict,
  unique (publication_id, topic_id)
);

create index publication_memory_claims_topic_idx
on public.publication_memory_claims(topic_id, publication_id);

alter table public.role_memory_topics enable row level security;
alter table public.publication_memory_indexes enable row level security;
alter table public.publication_memory_claims enable row level security;

create policy "authorized role memory topics"
on public.role_memory_topics for select to authenticated
using (public.can_view_role_history(role_id));

create policy "authorized publication memory indexes"
on public.publication_memory_indexes for select to authenticated
using (public.can_view_role_history(role_id));

create policy "authorized publication memory claims"
on public.publication_memory_claims for select to authenticated
using (public.can_view_role_history(role_id));

create or replace function public.commit_publication_memory_claim_indexes(
  requested_organization_id uuid,
  requested_role_id uuid,
  requested_publication_ids uuid[],
  requested_created_by uuid,
  requested_index_version integer,
  requested_claims jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication_id uuid;
  publication_count integer;
  claim jsonb;
  claim_publication_id uuid;
  claim_topic_id uuid;
  claim_topic_group text;
  claim_topic_key text;
  claim_topic_label text;
  primary_item_id uuid;
  source_item_ids uuid[];
  valid_source_count integer;
  topic_map jsonb := '{}'::jsonb;
begin
  if requested_organization_id is null
    or requested_role_id is null
    or requested_created_by is null
    or requested_index_version < 1
    or requested_publication_ids is null
    or cardinality(requested_publication_ids) not between 1 and 2
    or (select count(distinct value) from unnest(requested_publication_ids) value)
      <> cardinality(requested_publication_ids)
    or jsonb_typeof(requested_claims) <> 'array'
    or jsonb_array_length(requested_claims) > 200 then
    raise exception 'Invalid publication Memory index' using errcode = '22023';
  end if;

  select count(*)::integer into publication_count
  from public.handoff_publications publication
  join public.handoffs handoff
    on handoff.id = publication.handoff_id
   and handoff.organization_id = publication.organization_id
  where publication.id = any(requested_publication_ids)
    and publication.organization_id = requested_organization_id
    and handoff.role_id = requested_role_id;

  if publication_count <> cardinality(requested_publication_ids) then
    raise exception 'Publication Memory scope is invalid' using errcode = '22023';
  end if;

  -- Replacement is atomic inside this function. A failed rebuild therefore
  -- cannot leave a publication with a partially written claim index.
  delete from public.publication_memory_indexes memory_index
  where memory_index.publication_id = any(requested_publication_ids);

  foreach publication_id in array requested_publication_ids
  loop
    insert into public.publication_memory_indexes (
      publication_id, organization_id, role_id, index_version, status,
      claim_count, failure_reason, created_by, indexed_at
    ) values (
      publication_id, requested_organization_id, requested_role_id,
      requested_index_version, 'building', 0, null, requested_created_by, null
    );
  end loop;

  for claim in select value from jsonb_array_elements(requested_claims)
  loop
    if jsonb_typeof(claim) <> 'object' then
      raise exception 'Invalid publication Memory claim' using errcode = '22023';
    end if;

    claim_publication_id := nullif(claim->>'publicationId', '')::uuid;
    if claim_publication_id is null or not claim_publication_id = any(requested_publication_ids) then
      raise exception 'Memory claim publication is invalid' using errcode = '22023';
    end if;

    select coalesce(array_agg(source_id order by source_id), '{}'::uuid[])
    into source_item_ids
    from (
      select distinct value::uuid as source_id
      from jsonb_array_elements_text(claim->'sourcePublicationItemIds') value
    ) source_ids;

    primary_item_id := nullif(claim->>'primaryPublicationItemId', '')::uuid;
    if cardinality(source_item_ids) not between 1 and 16
      or primary_item_id is null
      or not primary_item_id = any(source_item_ids) then
      raise exception 'Memory claim source is invalid' using errcode = '22023';
    end if;

    select count(*)::integer into valid_source_count
    from public.handoff_publication_items item
    where item.publication_id = claim_publication_id
      and item.organization_id = requested_organization_id
      and item.id = any(source_item_ids);

    if valid_source_count <> cardinality(source_item_ids) then
      raise exception 'Memory claim source scope is invalid' using errcode = '22023';
    end if;

    claim_topic_id := nullif(claim->>'topicId', '')::uuid;
    claim_topic_group := nullif(btrim(claim->>'topicGroup'), '');
    claim_topic_key := nullif(btrim(claim->>'topicKey'), '');
    claim_topic_label := nullif(btrim(claim->>'topicLabel'), '');

    if claim_topic_id is not null then
      if not exists (
        select 1 from public.role_memory_topics topic
        where topic.id = claim_topic_id
          and topic.organization_id = requested_organization_id
          and topic.role_id = requested_role_id
      ) then
        raise exception 'Memory topic is outside this Role' using errcode = '22023';
      end if;
    else
      if claim_topic_group is null
        or claim_topic_key is null
        or claim_topic_label is null
        or claim_topic_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
        or char_length(claim_topic_key) > 120
        or char_length(claim_topic_group) > 160
        or char_length(claim_topic_label) > 160 then
        raise exception 'New Memory topic is invalid' using errcode = '22023';
      end if;

      claim_topic_id := nullif(topic_map->>claim_topic_group, '')::uuid;
      if claim_topic_id is null then
        insert into public.role_memory_topics (
          organization_id, role_id, canonical_key, label, created_by
        ) values (
          requested_organization_id, requested_role_id,
          claim_topic_key, claim_topic_label, requested_created_by
        ) returning id into claim_topic_id;
        topic_map := topic_map || jsonb_build_object(claim_topic_group, claim_topic_id::text);
      end if;
    end if;

    if coalesce(claim->>'knowledgeType', '') not in (
      'process', 'contact', 'rule_deadline', 'access_resource', 'warning_lesson'
    ) or coalesce(claim->>'claimState', '') not in (
      'active', 'pending', 'resolved', 'retired', 'uncertain'
    ) or char_length(btrim(coalesce(claim->>'title', ''))) not between 1 and 160
      or char_length(btrim(coalesce(claim->>'content', ''))) not between 1 and 2000
      or char_length(btrim(coalesce(claim->>'comparisonValue', ''))) not between 1 and 1000
      or jsonb_typeof(coalesce(claim->'citationSources', '[]'::jsonb)) <> 'array' then
      raise exception 'Memory claim content is invalid' using errcode = '22023';
    end if;

    insert into public.publication_memory_claims (
      publication_id, organization_id, role_id, topic_id,
      knowledge_type, title, content, comparison_value, claim_state,
      primary_publication_item_id, source_publication_item_ids,
      citation_sources
    ) values (
      claim_publication_id, requested_organization_id, requested_role_id,
      claim_topic_id, claim->>'knowledgeType', btrim(claim->>'title'),
      btrim(claim->>'content'), btrim(claim->>'comparisonValue'),
      claim->>'claimState', primary_item_id, source_item_ids,
      coalesce(claim->'citationSources', '[]'::jsonb)
    );
  end loop;

  update public.publication_memory_indexes memory_index
  set status = 'ready',
      claim_count = (
        select count(*)::integer
        from public.publication_memory_claims claim
        where claim.publication_id = memory_index.publication_id
      ),
      failure_reason = null,
      indexed_at = now()
  where memory_index.publication_id = any(requested_publication_ids);
end;
$$;

revoke all on function public.commit_publication_memory_claim_indexes(
  uuid, uuid, uuid[], uuid, integer, jsonb
) from public, anon, authenticated;

grant execute on function public.commit_publication_memory_claim_indexes(
  uuid, uuid, uuid[], uuid, integer, jsonb
) to service_role;

comment on table public.role_memory_topics is
  'Hidden stable identities for atomic operational facts within one Organization and Role.';
comment on table public.publication_memory_claims is
  'Immutable-publication-derived atomic claims. Every claim remains grounded in approved publication items and safe published provenance.';
comment on function public.commit_publication_memory_claim_indexes(
  uuid, uuid, uuid[], uuid, integer, jsonb
) is 'Atomically replaces derived claim indexes without modifying either immutable published Handoff.';

create or replace function public.invalidate_publication_memory_index()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.publication_memory_indexes memory_index
    where memory_index.publication_id = old.publication_id;
    return old;
  end if;

  delete from public.publication_memory_indexes memory_index
  where memory_index.publication_id = new.publication_id;
  return new;
end;
$$;

revoke all on function public.invalidate_publication_memory_index()
from public, anon, authenticated;

create trigger handoff_publication_items_invalidate_memory_index
after insert or update or delete on public.handoff_publication_items
for each row execute function public.invalidate_publication_memory_index();
