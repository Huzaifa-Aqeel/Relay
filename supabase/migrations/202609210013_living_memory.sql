-- Relay v1.3: living source/knowledge lineage and grounded organization memory.

alter table public.sources
  add column normalized_filename text,
  add column content_hash text,
  add column supersedes_source_id uuid references public.sources(id) on delete restrict,
  add column source_root_id uuid references public.sources(id) on delete restrict,
  add column version_number integer not null default 1 check (version_number > 0),
  add column is_current boolean not null default true,
  add column version_match_basis text check (
    version_match_basis is null or version_match_basis in ('filename_and_type', 'human_confirmed')
  ),
  add column delta_status text not null default 'not_applicable' check (
    delta_status in ('not_applicable', 'pending', 'processing', 'ready', 'failed')
  ),
  add column delta_failure_reason text check (
    delta_failure_reason is null or char_length(delta_failure_reason) <= 500
  ),
  add column delta_change_count integer check (
    delta_change_count is null or delta_change_count between 0 and 30
  ),
  add column delta_analyzed_at timestamptz,
  add constraint sources_content_hash_check check (
    content_hash is null or content_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint sources_version_kind_check check (
    (kind = 'document') or (
      normalized_filename is null
      and content_hash is null
      and supersedes_source_id is null
      and source_root_id is null
      and version_number = 1
      and is_current
      and version_match_basis is null
      and delta_status = 'not_applicable'
    )
  ),
  add constraint sources_delta_state_check check (
    (delta_status = 'failed') = (delta_failure_reason is not null)
  );

update public.sources
set source_root_id = id,
    normalized_filename = lower(regexp_replace(title, '[^a-zA-Z0-9]+', '-', 'g')),
    delta_status = 'not_applicable'
where kind = 'document';

create unique index sources_handoff_content_hash_idx
on public.sources(handoff_id, content_hash)
where content_hash is not null;

create unique index sources_root_version_idx
on public.sources(source_root_id, version_number)
where source_root_id is not null;

create unique index sources_one_current_version_idx
on public.sources(source_root_id)
where source_root_id is not null and is_current;

create index sources_handoff_current_idx
on public.sources(handoff_id, is_current, created_at desc);

create or replace function public.prepare_source_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior public.sources;
begin
  if new.kind <> 'document' then
    return new;
  end if;

  if new.source_root_id is null then
    new.source_root_id := new.id;
  end if;

  if new.supersedes_source_id is null then
    new.version_number := 1;
    new.is_current := true;
    new.delta_status := 'not_applicable';
    return new;
  end if;

  select * into prior
  from public.sources
  where id = new.supersedes_source_id
  for update;

  if prior.id is null
    or prior.kind <> 'document'
    or prior.organization_id <> new.organization_id
    or prior.handoff_id <> new.handoff_id
    or not prior.is_current then
    raise exception 'The prior source version is unavailable' using errcode = '22023';
  end if;

  new.source_root_id := coalesce(prior.source_root_id, prior.id);
  new.version_number := prior.version_number + 1;
  new.is_current := true;
  new.delta_status := 'pending';
  update public.sources set is_current = false where id = prior.id;
  return new;
end;
$$;

create trigger sources_prepare_version
before insert on public.sources
for each row execute function public.prepare_source_version();

create or replace function public.protect_historical_source_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not old.is_current and (
    new.title is distinct from old.title
    or new.text_content is distinct from old.text_content
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

create trigger sources_protect_historical_version
before update on public.sources
for each row execute function public.protect_historical_source_version();

create table public.knowledge_lineages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id, role_id)
);

create trigger knowledge_lineages_set_updated_at before update on public.knowledge_lineages
for each row execute function public.set_updated_at();

alter table public.knowledge_items
  add column lineage_id uuid references public.knowledge_lineages(id) on delete restrict,
  add column proposal_action text not null default 'create' check (
    proposal_action in ('create', 'update', 'retire')
  ),
  add column proposal_target_id uuid references public.knowledge_items(id) on delete restrict,
  add column decided_by uuid references public.profiles(id) on delete set null,
  add column decided_at timestamptz;

alter table public.knowledge_items drop constraint if exists knowledge_items_status_check;
alter table public.knowledge_items drop constraint if exists knowledge_items_check;
alter table public.knowledge_items
  add constraint knowledge_items_status_check check (
    status in ('proposed', 'approved', 'rejected', 'accepted', 'retired')
  ),
  add constraint knowledge_items_manual_status_check check (
    origin <> 'manual' or status in ('approved', 'retired')
  ),
  add constraint knowledge_items_proposal_target_check check (
    (proposal_action = 'create' and proposal_target_id is null)
    or (proposal_action in ('update', 'retire') and proposal_target_id is not null and origin = 'ai')
  ),
  add constraint knowledge_items_decision_check check (
    (status = 'proposed' and decided_at is null and decided_by is null)
    or (status <> 'proposed')
  );

insert into public.knowledge_lineages (id, organization_id, role_id, created_by, label)
select item.id, item.organization_id, handoff.role_id, item.created_by, item.title
from public.knowledge_items item
join public.handoffs handoff on handoff.id = item.handoff_id;

update public.knowledge_items set lineage_id = id;
alter table public.knowledge_items alter column lineage_id set not null;

create index knowledge_items_lineage_idx on public.knowledge_items(lineage_id, created_at);
create index knowledge_items_proposal_target_idx on public.knowledge_items(proposal_target_id)
where proposal_target_id is not null;

create or replace function public.assign_knowledge_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.knowledge_items;
  target_role_id uuid;
  created_lineage_id uuid;
begin
  select handoff.role_id into target_role_id
  from public.handoffs handoff
  where handoff.id = new.handoff_id and handoff.organization_id = new.organization_id;

  if new.proposal_target_id is not null then
    select * into target
    from public.knowledge_items item
    where item.id = new.proposal_target_id
      and item.handoff_id = new.handoff_id
      and item.organization_id = new.organization_id;
    if target.id is null or target.status <> 'approved' then
      raise exception 'Proposal target must be approved knowledge in this handoff' using errcode = '22023';
    end if;
    new.lineage_id := target.lineage_id;
  elsif new.lineage_id is null then
    insert into public.knowledge_lineages (
      organization_id, role_id, created_by, label
    ) values (
      new.organization_id, target_role_id, new.created_by, new.title
    ) returning id into created_lineage_id;
    new.lineage_id := created_lineage_id;
  elsif not exists (
    select 1 from public.knowledge_lineages lineage
    where lineage.id = new.lineage_id
      and lineage.organization_id = new.organization_id
      and lineage.role_id = target_role_id
  ) then
    raise exception 'Knowledge lineage does not belong to this role' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger knowledge_items_assign_lineage
before insert on public.knowledge_items
for each row execute function public.assign_knowledge_lineage();

create table public.knowledge_item_revisions (
  id uuid primary key default gen_random_uuid(),
  knowledge_item_id uuid not null references public.knowledge_items(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null references public.handoffs(id) on delete cascade,
  proposal_id uuid references public.knowledge_items(id) on delete set null,
  knowledge_type text not null,
  title text not null,
  content text not null,
  status text not null,
  changed_by uuid not null references public.profiles(id) on delete cascade,
  changed_at timestamptz not null default now()
);

create index knowledge_item_revisions_item_idx
on public.knowledge_item_revisions(knowledge_item_id, changed_at desc);

create table public.source_version_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null references public.handoffs(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  prior_source_id uuid not null references public.sources(id) on delete cascade,
  change_type text not null check (change_type in ('added', 'changed', 'removed')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  summary text not null check (char_length(btrim(summary)) between 1 and 1000),
  old_excerpt text check (old_excerpt is null or char_length(old_excerpt) between 1 and 2000),
  new_excerpt text check (new_excerpt is null or char_length(new_excerpt) between 1 and 2000),
  affected_knowledge_item_id uuid references public.knowledge_items(id) on delete set null,
  proposal_item_id uuid references public.knowledge_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index source_version_changes_source_idx
on public.source_version_changes(source_id, created_at, id);

alter table public.knowledge_lineages enable row level security;
alter table public.knowledge_item_revisions enable row level security;
alter table public.source_version_changes enable row level security;

create policy "members read knowledge lineages" on public.knowledge_lineages
for select to authenticated using (public.is_organization_member(organization_id));
create policy "admins manage knowledge lineages" on public.knowledge_lineages
for all to authenticated using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "members read knowledge revisions" on public.knowledge_item_revisions
for select to authenticated using (public.is_organization_member(organization_id));

create policy "members read source version changes" on public.source_version_changes
for select to authenticated using (public.is_organization_member(organization_id));

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
  target_item public.knowledge_items;
  proposal jsonb;
  proposal_id uuid;
  proposal_count integer := 0;
  action text;
  target_id uuid;
  uncertainty text;
  locator text;
  excerpt text;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into target_source from public.sources where id = requested_source_id for update;
  if target_source.id is null or not public.is_organization_admin(target_source.organization_id) then
    raise exception 'Source unavailable' using errcode = '42501';
  end if;
  if target_source.processing_status <> 'ready' or target_source.text_content is null then
    raise exception 'Source text is not ready' using errcode = '22023';
  end if;
  if target_source.structuring_status <> 'processing' then
    raise exception 'Source is not awaiting structured proposals' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_proposals) <> 'array' or jsonb_array_length(requested_proposals) > 30 then
    raise exception 'Proposal output is invalid' using errcode = '22023';
  end if;

  delete from public.knowledge_items item
  where item.id in (
    select link.knowledge_item_id from public.knowledge_item_sources link
    where link.source_id = target_source.id
  ) and item.origin = 'ai' and item.status = 'proposed';

  for proposal in select value from jsonb_array_elements(requested_proposals)
  loop
    if jsonb_typeof(proposal) <> 'object'
      or not proposal ?& array[
        'proposal_action', 'target_knowledge_item_id', 'knowledge_type', 'title', 'content',
        'uncertainty_note', 'source_excerpt', 'source_locator'
      ]
      or (select count(*) from jsonb_object_keys(proposal)) <> 8 then
      raise exception 'Proposal schema is invalid' using errcode = '22023';
    end if;
    action := proposal->>'proposal_action';
    if action not in ('create', 'update', 'retire') then
      raise exception 'Proposal action is invalid' using errcode = '22023';
    end if;
    target_id := nullif(proposal->>'target_knowledge_item_id', '')::uuid;
    if (action = 'create' and target_id is not null)
      or (action <> 'create' and target_id is null) then
      raise exception 'Proposal target is invalid' using errcode = '22023';
    end if;
    if target_id is not null then
      select * into target_item from public.knowledge_items
      where id = target_id and handoff_id = target_source.handoff_id and status = 'approved';
      if target_item.id is null then
        raise exception 'Proposal target is unavailable' using errcode = '22023';
      end if;
    end if;
    if proposal->>'knowledge_type' not in (
      'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson'
    ) or char_length(btrim(proposal->>'title')) not between 1 and 160
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
      status, origin, uncertainty_note, proposal_action, proposal_target_id
    ) values (
      target_source.organization_id, target_source.handoff_id, actor,
      proposal->>'knowledge_type', btrim(proposal->>'title'), btrim(proposal->>'content'),
      'proposed', 'ai', uncertainty, action, target_id
    ) returning id into proposal_id;
    insert into public.knowledge_item_sources (
      knowledge_item_id, source_id, handoff_id, organization_id, source_excerpt, source_locator
    ) values (
      proposal_id, target_source.id, target_source.handoff_id, target_source.organization_id,
      excerpt, locator
    );
    proposal_count := proposal_count + 1;
  end loop;

  update public.sources set
    structuring_status = 'ready', structuring_failure_reason = null,
    structured_at = now(), structured_proposal_count = proposal_count
  where id = target_source.id;
  return proposal_count;
end;
$$;

create or replace function public.replace_source_version_changes(
  requested_source_id uuid,
  requested_changes jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  );
  source public.sources;
  prior public.sources;
  target public.knowledge_items;
  change jsonb;
  change_type text;
  action text;
  target_id uuid;
  proposal_id uuid;
  proposal_count integer := 0;
  old_excerpt text;
  new_excerpt text;
begin
  if caller_role <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into source from public.sources where id = requested_source_id for update;
  if source.id is null or source.kind <> 'document' or source.supersedes_source_id is null
    or source.processing_status <> 'ready' then
    raise exception 'Versioned source unavailable' using errcode = '22023';
  end if;
  select * into prior from public.sources where id = source.supersedes_source_id;
  if prior.id is null or prior.text_content is null or source.text_content is null then
    raise exception 'Source version text unavailable' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_changes) <> 'array' or jsonb_array_length(requested_changes) > 30 then
    raise exception 'Source delta output is invalid' using errcode = '22023';
  end if;

  delete from public.source_version_changes where source_id = source.id;
  delete from public.knowledge_items item
  where item.origin = 'ai' and item.status = 'proposed' and item.id in (
    select link.knowledge_item_id from public.knowledge_item_sources link where link.source_id = source.id
  );

  for change in select value from jsonb_array_elements(requested_changes)
  loop
    if jsonb_typeof(change) <> 'object' or not change ?& array[
      'change_type', 'title', 'summary', 'old_excerpt', 'new_excerpt', 'knowledge_type',
      'target_knowledge_item_id', 'proposed_title', 'proposed_content', 'source_locator'
    ] or (select count(*) from jsonb_object_keys(change)) <> 10 then
      raise exception 'Source delta schema is invalid' using errcode = '22023';
    end if;
    change_type := change->>'change_type';
    if change_type not in ('added', 'changed', 'removed')
      or change->>'knowledge_type' not in (
        'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson'
      )
      or char_length(btrim(change->>'title')) not between 1 and 160
      or char_length(btrim(change->>'summary')) not between 1 and 1000
      or char_length(btrim(change->>'proposed_title')) not between 1 and 160
      or char_length(btrim(change->>'proposed_content')) not between 1 and 5000 then
      raise exception 'Source delta content is invalid' using errcode = '22023';
    end if;
    old_excerpt := nullif(btrim(change->>'old_excerpt'), '');
    new_excerpt := nullif(btrim(change->>'new_excerpt'), '');
    if (old_excerpt is not null and (char_length(old_excerpt) > 2000 or position(old_excerpt in prior.text_content) = 0))
      or (new_excerpt is not null and (char_length(new_excerpt) > 2000 or position(new_excerpt in source.text_content) = 0)) then
      raise exception 'Source delta evidence is invalid' using errcode = '22023';
    end if;
    if (change_type = 'added' and new_excerpt is null)
      or (change_type = 'changed' and (old_excerpt is null or new_excerpt is null))
      or (change_type = 'removed' and old_excerpt is null) then
      raise exception 'Source delta evidence is incomplete' using errcode = '22023';
    end if;

    target_id := nullif(change->>'target_knowledge_item_id', '')::uuid;
    if target_id is not null then
      select * into target from public.knowledge_items
      where id = target_id and handoff_id = source.handoff_id and status = 'approved';
      if target.id is null then
        raise exception 'Affected knowledge is unavailable' using errcode = '22023';
      end if;
    end if;
    if change_type in ('changed', 'removed') and target_id is null then
      raise exception 'Changed or removed information needs an approved knowledge target' using errcode = '22023';
    end if;
    action := case change_type when 'changed' then 'update' when 'removed' then 'retire' else 'create' end;

    insert into public.knowledge_items (
      organization_id, handoff_id, created_by, knowledge_type, title, content,
      status, origin, uncertainty_note, proposal_action, proposal_target_id
    ) values (
      source.organization_id, source.handoff_id, source.created_by,
      change->>'knowledge_type', btrim(change->>'proposed_title'), btrim(change->>'proposed_content'),
      'proposed', 'ai', null, action, target_id
    ) returning id into proposal_id;

    insert into public.knowledge_item_sources (
      knowledge_item_id, source_id, handoff_id, organization_id, source_excerpt, source_locator
    ) values (
      proposal_id, source.id, source.handoff_id, source.organization_id,
      new_excerpt, nullif(btrim(change->>'source_locator'), '')
    );
    if old_excerpt is not null then
      insert into public.knowledge_item_sources (
        knowledge_item_id, source_id, handoff_id, organization_id, source_excerpt, source_locator
      ) values (
        proposal_id, prior.id, source.handoff_id, source.organization_id, old_excerpt, null
      ) on conflict do nothing;
    end if;

    insert into public.source_version_changes (
      organization_id, handoff_id, source_id, prior_source_id, change_type,
      title, summary, old_excerpt, new_excerpt, affected_knowledge_item_id, proposal_item_id
    ) values (
      source.organization_id, source.handoff_id, source.id, prior.id, change_type,
      btrim(change->>'title'), btrim(change->>'summary'), old_excerpt, new_excerpt,
      target_id, proposal_id
    );
    proposal_count := proposal_count + 1;
  end loop;

  update public.sources set
    delta_status = 'ready', delta_failure_reason = null,
    delta_change_count = proposal_count, delta_analyzed_at = now(),
    structuring_status = 'ready', structuring_failure_reason = null,
    structured_at = now(), structured_proposal_count = proposal_count
  where id = source.id;
  return proposal_count;
end;
$$;

create or replace function public.decide_knowledge_proposal(
  requested_item_id uuid,
  decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  proposal public.knowledge_items;
  target public.knowledge_items;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;
  select * into proposal from public.knowledge_items where id = requested_item_id for update;
  if proposal.id is null or not public.is_organization_admin(proposal.organization_id) then
    raise exception 'Knowledge proposal unavailable' using errcode = '42501';
  end if;
  if proposal.origin <> 'ai' or proposal.status <> 'proposed' then
    raise exception 'Only pending AI proposals can be decided' using errcode = '22023';
  end if;
  if decision = 'rejected' then
    update public.knowledge_items set status = 'rejected', decided_by = actor, decided_at = now()
    where id = proposal.id;
    return;
  end if;
  if proposal.proposal_action = 'create' then
    update public.knowledge_items set status = 'approved', decided_by = actor, decided_at = now()
    where id = proposal.id;
    return;
  end if;

  select * into target from public.knowledge_items
  where id = proposal.proposal_target_id and status = 'approved' for update;
  if target.id is null or target.handoff_id <> proposal.handoff_id then
    raise exception 'Proposal target is no longer available' using errcode = '22023';
  end if;
  insert into public.knowledge_item_revisions (
    knowledge_item_id, organization_id, handoff_id, proposal_id,
    knowledge_type, title, content, status, changed_by
  ) values (
    target.id, target.organization_id, target.handoff_id, proposal.id,
    target.knowledge_type, target.title, target.content, target.status, actor
  );

  if proposal.proposal_action = 'update' then
    update public.knowledge_items set
      knowledge_type = proposal.knowledge_type,
      title = proposal.title,
      content = proposal.content
    where id = target.id;
  else
    update public.knowledge_items set status = 'retired' where id = target.id;
  end if;

  insert into public.knowledge_item_sources (
    knowledge_item_id, source_id, handoff_id, organization_id, source_excerpt, source_locator
  ) select
    target.id, link.source_id, target.handoff_id, target.organization_id,
    link.source_excerpt, link.source_locator
  from public.knowledge_item_sources link
  where link.knowledge_item_id = proposal.id
  on conflict (knowledge_item_id, source_id) do update set
    source_excerpt = excluded.source_excerpt,
    source_locator = excluded.source_locator;

  update public.knowledge_items set status = 'accepted', decided_by = actor, decided_at = now()
  where id = proposal.id;
end;
$$;

revoke all on function public.replace_source_version_changes(uuid, jsonb) from public;
grant execute on function public.replace_source_version_changes(uuid, jsonb) to service_role;

create table public.knowledge_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  from_knowledge_item_id uuid not null references public.knowledge_items(id) on delete cascade,
  to_knowledge_item_id uuid not null references public.knowledge_items(id) on delete cascade,
  relationship_type text not null check (relationship_type = 'lesson_became_practice'),
  explanation text not null check (char_length(btrim(explanation)) between 1 and 1000),
  evidence_source_id uuid references public.sources(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_knowledge_item_id, to_knowledge_item_id, relationship_type),
  check (from_knowledge_item_id <> to_knowledge_item_id)
);

alter table public.knowledge_relationships enable row level security;
create policy "members read knowledge relationships" on public.knowledge_relationships
for select to authenticated using (public.is_organization_member(organization_id));
create policy "admins manage knowledge relationships" on public.knowledge_relationships
for all to authenticated using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

alter table public.handoff_publication_items
add column knowledge_lineage_id uuid references public.knowledge_lineages(id) on delete restrict;

update public.handoff_publication_items published
set knowledge_lineage_id = item.lineage_id
from public.knowledge_items item
where item.id = published.source_knowledge_item_id;

alter table public.handoff_publication_items alter column knowledge_lineage_id set not null;
create index handoff_publication_items_lineage_idx
on public.handoff_publication_items(knowledge_lineage_id, publication_id);

create table public.role_memory_comparisons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  previous_publication_id uuid not null references public.handoff_publications(id) on delete cascade,
  current_publication_id uuid not null references public.handoff_publications(id) on delete cascade,
  previous_service_period text not null,
  current_service_period text not null,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  material_change_count integer check (material_change_count is null or material_change_count between 0 and 100),
  created_by uuid not null references public.profiles(id) on delete cascade,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id, previous_publication_id, current_publication_id),
  check (previous_publication_id <> current_publication_id)
);

create trigger role_memory_comparisons_set_updated_at before update on public.role_memory_comparisons
for each row execute function public.set_updated_at();

create table public.role_memory_changes (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.role_memory_comparisons(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  change_type text not null check (change_type in ('added', 'changed', 'retired')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  summary text not null check (char_length(btrim(summary)) between 1 and 1000),
  previous_publication_item_id uuid references public.handoff_publication_items(id) on delete set null,
  current_publication_item_id uuid references public.handoff_publication_items(id) on delete set null,
  match_basis text not null check (match_basis in ('same_lineage', 'strong_semantic', 'not_applicable')),
  reason_category text not null check (
    reason_category in ('policy_driven', 'lesson_driven', 'leadership_preference', 'contact_resource', 'unknown')
  ),
  reason_explanation text not null check (char_length(btrim(reason_explanation)) between 1 and 1000),
  reason_evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(reason_evidence) = 'array'),
  before_snapshot jsonb,
  after_snapshot jsonb,
  supporting_provenance jsonb not null default '[]'::jsonb check (jsonb_typeof(supporting_provenance) = 'array'),
  human_confirmed boolean not null default false,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((human_confirmed and confirmed_by is not null and confirmed_at is not null) or not human_confirmed)
);

create index role_memory_changes_comparison_idx
on public.role_memory_changes(comparison_id, created_at, id);

alter table public.role_memory_comparisons enable row level security;
alter table public.role_memory_changes enable row level security;

create policy "members read role memory comparisons" on public.role_memory_comparisons
for select to authenticated using (public.is_organization_member(organization_id));
create policy "members read role memory changes" on public.role_memory_changes
for select to authenticated using (public.is_organization_member(organization_id));

create or replace function public.confirm_memory_change_reason(
  requested_change_id uuid,
  requested_reason_category text,
  requested_explanation text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target public.role_memory_changes;
begin
  select * into target from public.role_memory_changes where id = requested_change_id;
  if actor is null or target.id is null or not public.is_organization_admin(target.organization_id) then
    raise exception 'Memory change unavailable' using errcode = '42501';
  end if;
  if requested_reason_category not in ('lesson_driven', 'leadership_preference', 'contact_resource', 'unknown') then
    raise exception 'Policy-driven reasons require supporting approved policy evidence' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(requested_explanation, ''))) not between 1 and 1000 then
    raise exception 'A concise confirmation is required' using errcode = '22023';
  end if;
  update public.role_memory_changes set
    reason_category = requested_reason_category,
    reason_explanation = btrim(requested_explanation),
    human_confirmed = true,
    confirmed_by = actor,
    confirmed_at = now()
  where id = target.id;
end;
$$;

revoke all on function public.confirm_memory_change_reason(uuid, text, text) from public;
grant execute on function public.confirm_memory_change_reason(uuid, text, text) to authenticated;

create or replace function public.publish_handoff(requested_handoff_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_handoff public.handoffs;
  target_run public.preflight_runs;
  target_organization public.organizations;
  target_role public.roles;
  created_publication_id uuid;
  issued_token text := public.new_handoff_access_token();
begin
  select * into target_handoff from public.handoffs
  where id = requested_handoff_id and status = 'draft' for update;
  if actor is null or target_handoff.id is null
    or not public.is_organization_admin(target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;
  if target_handoff.stage <> 'preview' then
    raise exception 'Preview this handoff before publishing' using errcode = '22023';
  end if;
  if exists (select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'proposed') then
    raise exception 'Review every proposal before publishing' using errcode = '22023';
  end if;
  if not exists (select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'approved') then
    raise exception 'Approve at least one knowledge item before publishing' using errcode = '22023';
  end if;
  select * into target_run from public.preflight_runs run
  where run.handoff_id = target_handoff.id and run.status = 'ready'
  order by run.created_at desc, run.id desc limit 1;
  if target_run.id is null then
    raise exception 'Run Preflight after the latest knowledge changes' using errcode = '22023';
  end if;
  if exists (select 1 from public.preflight_findings finding
    where finding.run_id = target_run.id and finding.severity = 'critical'
      and finding.status <> 'resolved') and target_run.critical_acknowledged_at is null then
    raise exception 'Critical findings require deliberate acknowledgement' using errcode = '22023';
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
    knowledge_lineage_id, knowledge_type, title, content, sort_order, citation_sources
  ) select
    created_publication_id, item.organization_id, item.handoff_id, item.id,
    item.lineage_id, item.knowledge_type, item.title, item.content, item.sort_order,
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

do $$
begin
  alter publication supabase_realtime add table public.source_version_changes;
exception when duplicate_object then null;
end;
$$;
