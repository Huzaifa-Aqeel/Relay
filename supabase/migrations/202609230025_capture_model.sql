-- One user submission is one Capture. Existing Sources remain the evidence and
-- document-processing layer underneath the Capture UI.

create table public.captures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  text_content text check (text_content is null or char_length(btrim(text_content)) between 1 and 50000),
  prompt_id text check (prompt_id is null or prompt_id in (
    'role-responsibilities', 'annual-registration-training', 'finances-budget',
    'recurring-events', 'advisor-vendor-contacts', 'account-tool-access',
    'calendars-deadlines', 'constitution-policies', 'lessons-common-mistakes'
  )),
  submitted_at timestamptz,
  structuring_status text not null default 'not_started'
    check (structuring_status in ('not_started', 'processing', 'ready', 'failed')),
  structuring_failure_reason text
    check (structuring_failure_reason is null or char_length(structuring_failure_reason) <= 500),
  structured_at timestamptz,
  structured_proposal_count integer
    check (structured_proposal_count is null or structured_proposal_count between 0 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (handoff_id, organization_id)
    references public.handoffs(id, organization_id) on delete cascade,
  unique (id, handoff_id, organization_id),
  check (structuring_status = 'failed' or structuring_failure_reason is null),
  check (
    (structuring_status = 'ready') =
    (structured_at is not null and structured_proposal_count is not null)
  )
);

create table public.capture_sources (
  capture_id uuid not null,
  source_id uuid not null,
  organization_id uuid not null,
  handoff_id uuid not null,
  relationship text not null check (relationship in ('text', 'attachment')),
  position integer not null default 0 check (position >= 0),
  created_for_capture boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (capture_id, source_id),
  foreign key (capture_id, handoff_id, organization_id)
    references public.captures(id, handoff_id, organization_id) on delete cascade,
  foreign key (source_id, handoff_id, organization_id)
    references public.sources(id, handoff_id, organization_id) on delete cascade
);

create unique index capture_sources_one_text_idx
on public.capture_sources(capture_id) where relationship = 'text';
create index capture_sources_source_idx on public.capture_sources(source_id, capture_id);
create index captures_handoff_created_idx on public.captures(handoff_id, created_at desc);

alter table public.knowledge_items
add column capture_id uuid references public.captures(id) on delete set null;

create index knowledge_items_capture_idx
on public.knowledge_items(capture_id, status, created_at);

comment on table public.captures is
  'One leader contribution: optional text, optional guided prompt metadata, and zero or more linked document Sources.';
comment on table public.capture_sources is
  'Direct ownership relation from a Capture to its text-evidence Source and document attachment Sources.';
comment on column public.sources.document_context is
  'Legacy intermediate field. New unified submissions keep user text on public.captures.text_content.';

create trigger captures_set_updated_at before update on public.captures
for each row execute function public.set_updated_at();
create trigger captures_touch_handoff after insert or update or delete on public.captures
for each row execute function public.touch_parent_handoff();

create or replace function public.reset_capture_structuring_on_source_text_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.text_content is distinct from old.text_content then
    update public.captures capture set
      structuring_status = 'not_started',
      structuring_failure_reason = null,
      structured_at = null,
      structured_proposal_count = null
    where capture.id in (
      select relation.capture_id from public.capture_sources relation
      where relation.source_id = new.id
    ) and capture.submitted_at is not null;
  end if;
  return new;
end;
$$;

create trigger sources_reset_capture_structuring_on_text_change
after update of text_content on public.sources
for each row execute function public.reset_capture_structuring_on_source_text_change();

alter table public.captures enable row level security;
alter table public.capture_sources enable row level security;

create policy "assigned holders read captures" on public.captures
for select to authenticated using (public.is_role_holder_for_handoff(handoff_id));
create policy "assigned holders read capture sources" on public.capture_sources
for select to authenticated using (public.is_role_holder_for_handoff(handoff_id));

-- Capture assembly and proposal replacement are RPC-only. This prevents clients
-- from claiming completion or changing attribution directly.
revoke insert, update, delete on public.captures from authenticated;
revoke insert, update, delete on public.capture_sources from authenticated;
grant select on public.captures, public.capture_sources to authenticated;

create or replace function public.create_capture_draft(
  requested_organization_id uuid,
  requested_handoff_id uuid,
  requested_title text,
  requested_prompt_id text default null,
  requested_text_content text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  created_capture_id uuid := gen_random_uuid();
  created_source_id uuid;
  clean_text text := nullif(btrim(requested_text_content), '');
begin
  if actor is null
    or not public.is_role_holder_for_handoff(requested_handoff_id)
    or not public.is_draft_handoff(requested_handoff_id, requested_organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
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

  insert into public.captures (
    id, organization_id, handoff_id, created_by, title, text_content, prompt_id
  ) values (
    created_capture_id, requested_organization_id, requested_handoff_id, actor,
    btrim(requested_title), clean_text, requested_prompt_id
  );

  if clean_text is not null then
    insert into public.sources (
      organization_id, handoff_id, created_by, kind, title, text_content,
      processing_status, structuring_status, structured_at, structured_proposal_count
    ) values (
      requested_organization_id, requested_handoff_id, actor, 'typed_text',
      btrim(requested_title), clean_text, 'ready', 'ready', now(), 0
    ) returning id into created_source_id;

    insert into public.capture_sources (
      capture_id, source_id, organization_id, handoff_id,
      relationship, position, created_for_capture
    ) values (
      created_capture_id, created_source_id, requested_organization_id,
      requested_handoff_id, 'text', 0, true
    );
  end if;

  return created_capture_id;
end;
$$;

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
    or target_capture.submitted_at is not null
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
    relationship, position, created_for_capture
  ) values (
    target_capture.id, target_source.id, target_capture.organization_id,
    target_capture.handoff_id, 'attachment', requested_position,
    requested_created_for_capture
  ) on conflict (capture_id, source_id) do nothing;
end;
$$;

create or replace function public.finalize_capture(requested_capture_id uuid)
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
    or target_capture.submitted_at is not null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id)
    or not public.is_draft_handoff(target_capture.handoff_id, target_capture.organization_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;
  if target_capture.text_content is null and not exists (
    select 1 from public.capture_sources relation
    where relation.capture_id = target_capture.id and relation.relationship = 'attachment'
  ) then
    raise exception 'Add text or a file before continuing' using errcode = '22023';
  end if;
  update public.captures set submitted_at = now() where id = target_capture.id;
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
  relation record;
  prior_id uuid;
begin
  select * into target_capture from public.captures
  where id = requested_capture_id for update;
  if target_capture.id is null then return; end if;
  if target_capture.submitted_at is not null
    or not public.is_role_holder_for_handoff(target_capture.handoff_id) then
    raise exception 'Capture unavailable' using errcode = '42501';
  end if;

  for relation in
    select source.id, source.supersedes_source_id, source.version_number
    from public.capture_sources link
    join public.sources source on source.id = link.source_id
    where link.capture_id = target_capture.id and link.created_for_capture
    order by source.version_number desc
  loop
    prior_id := relation.supersedes_source_id;
    delete from public.capture_sources
    where capture_id = target_capture.id and source_id = relation.id;
    delete from public.sources where id = relation.id;
    if prior_id is not null then
      update public.sources set is_current = true where id = prior_id;
    end if;
  end loop;
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
  prior_source public.sources;
  proposal jsonb;
  proposal_id uuid;
  proposal_count integer := 0;
  action text;
  target_id uuid;
  evidence_id uuid;
  version_change_type text;
  prior_excerpt text;
  change_summary text;
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
  delete from public.source_version_changes change
  where change.source_id in (
    select source.id
    from public.capture_sources relation
    join public.sources source on source.id = relation.source_id
    where relation.capture_id = target_capture.id
      and source.supersedes_source_id is not null
  );

  for proposal in select value from jsonb_array_elements(requested_proposals)
  loop
    if jsonb_typeof(proposal) <> 'object'
      or not proposal ?& array[
        'proposal_action', 'target_knowledge_item_id', 'knowledge_type', 'title',
        'content', 'uncertainty_note', 'evidence_source_id', 'source_excerpt',
        'source_locator', 'version_change_type', 'prior_source_excerpt', 'change_summary'
      ]
      or (select count(*) from jsonb_object_keys(proposal)) <> 12 then
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
    where link.capture_id = target_capture.id and source.id = evidence_id
      and source.processing_status = 'ready'
      and (source.kind <> 'document' or source.is_current);
    if evidence_source.id is null or evidence_source.text_content is null then
      raise exception 'Suggestion evidence is unavailable' using errcode = '22023';
    end if;
    version_change_type := nullif(proposal->>'version_change_type', '');
    prior_excerpt := nullif(btrim(proposal->>'prior_source_excerpt'), '');
    change_summary := nullif(btrim(proposal->>'change_summary'), '');
    if version_change_type is null then
      if prior_excerpt is not null or change_summary is not null then
        raise exception 'Document-version information is inconsistent' using errcode = '22023';
      end if;
    else
      select * into prior_source from public.sources
      where id = evidence_source.supersedes_source_id;
      if version_change_type not in ('added', 'changed', 'removed')
        or prior_source.id is null or prior_source.text_content is null
        or change_summary is null or char_length(change_summary) > 1000
        or (version_change_type = 'added' and (action <> 'create' or prior_excerpt is not null))
        or (version_change_type = 'changed' and (action <> 'update' or prior_excerpt is null))
        or (version_change_type = 'removed' and (action <> 'retire' or prior_excerpt is null))
        or (prior_excerpt is not null and (
          char_length(prior_excerpt) > 2000
          or position(prior_excerpt in prior_source.text_content) = 0
        )) then
        raise exception 'Document-version information is invalid' using errcode = '22023';
      end if;
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
    if version_change_type is not null then
      insert into public.source_version_changes (
        organization_id, handoff_id, source_id, prior_source_id, change_type,
        title, summary, old_excerpt, new_excerpt,
        affected_knowledge_item_id, proposal_item_id
      ) values (
        target_capture.organization_id, target_capture.handoff_id,
        evidence_source.id, prior_source.id, version_change_type,
        btrim(proposal->>'title'), change_summary, prior_excerpt, excerpt,
        target_id, proposal_id
      );
    end if;
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
    ),
    delta_status = case when source.supersedes_source_id is not null then 'ready' else source.delta_status end,
    delta_failure_reason = case when source.supersedes_source_id is not null then null else source.delta_failure_reason end,
    delta_change_count = case when source.supersedes_source_id is not null then (
      select count(*)::integer from public.source_version_changes change
      where change.source_id = source.id
    ) else source.delta_change_count end,
    delta_analyzed_at = case when source.supersedes_source_id is not null then now() else source.delta_analyzed_at end
  where source.id in (
    select relation.source_id from public.capture_sources relation
    where relation.capture_id = target_capture.id
  ) and source.processing_status = 'ready';

  return proposal_count;
end;
$$;

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

do $$
declare f text;
begin
  foreach f in array array[
    'create_capture_draft(uuid,uuid,text,text,text)',
    'attach_source_to_capture(uuid,uuid,integer,boolean)',
    'finalize_capture(uuid)',
    'discard_capture_draft(uuid)',
    'replace_capture_knowledge_proposals(uuid,jsonb)'
  ] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.captures;
exception when duplicate_object then null;
end;
$$;
