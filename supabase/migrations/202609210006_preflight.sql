create table public.preflight_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'failed', 'stale')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  finding_count integer check (finding_count is null or finding_count between 0 and 30),
  critical_acknowledged_at timestamptz,
  critical_acknowledged_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (handoff_id, organization_id)
    references public.handoffs(id, organization_id) on delete cascade,
  unique (id, handoff_id, organization_id),
  check (status = 'failed' or failure_reason is null),
  check ((status in ('ready', 'stale')) = (completed_at is not null and finding_count is not null)),
  check ((critical_acknowledged_at is null) = (critical_acknowledged_by is null))
);

create table public.preflight_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null,
  finding_type text not null
    check (finding_type in ('missing', 'ambiguous', 'incomplete', 'contradiction')),
  severity text not null check (severity in ('critical', 'optional')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  question text not null check (char_length(btrim(question)) between 1 and 500),
  explanation text not null check (char_length(btrim(explanation)) between 1 and 2000),
  suggested_knowledge_type text check (
    suggested_knowledge_type is null or suggested_knowledge_type in (
      'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson'
    )
  ),
  primary_knowledge_item_id uuid references public.knowledge_items(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved', 'skipped', 'unknown')),
  resolution_knowledge_item_id uuid references public.knowledge_items(id) on delete set null,
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (run_id, handoff_id, organization_id)
    references public.preflight_runs(id, handoff_id, organization_id) on delete cascade,
  unique (id, run_id, handoff_id, organization_id),
  check ((status = 'open') = (decided_at is null and decided_by is null))
);

create table public.preflight_finding_evidence (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null,
  run_id uuid not null,
  organization_id uuid not null,
  handoff_id uuid not null,
  evidence_kind text not null check (evidence_kind in ('knowledge', 'source')),
  knowledge_item_id uuid,
  source_id uuid,
  label text not null check (char_length(btrim(label)) between 1 and 200),
  excerpt text not null check (char_length(btrim(excerpt)) between 1 and 2000),
  locator text check (locator is null or char_length(btrim(locator)) between 1 and 200),
  created_at timestamptz not null default now(),
  foreign key (finding_id, run_id, handoff_id, organization_id)
    references public.preflight_findings(id, run_id, handoff_id, organization_id) on delete cascade,
  check (
    (evidence_kind = 'knowledge' and knowledge_item_id is not null and source_id is null)
    or (evidence_kind = 'source' and source_id is not null and knowledge_item_id is null)
  )
);

create index preflight_runs_handoff_created_idx
on public.preflight_runs(handoff_id, created_at desc);

create unique index preflight_runs_one_processing_idx
on public.preflight_runs(handoff_id)
where status = 'processing';

create index preflight_findings_run_status_idx
on public.preflight_findings(run_id, status, severity, created_at);

create index preflight_finding_evidence_finding_idx
on public.preflight_finding_evidence(finding_id, created_at);

create trigger preflight_runs_set_updated_at before update on public.preflight_runs
for each row execute function public.set_updated_at();

create trigger preflight_findings_set_updated_at before update on public.preflight_findings
for each row execute function public.set_updated_at();

alter table public.preflight_runs enable row level security;
alter table public.preflight_findings enable row level security;
alter table public.preflight_finding_evidence enable row level security;

create policy "members read preflight runs" on public.preflight_runs
for select to authenticated
using (public.is_organization_member(organization_id));

create policy "members read preflight findings" on public.preflight_findings
for select to authenticated
using (public.is_organization_member(organization_id));

create policy "members read preflight evidence" on public.preflight_finding_evidence
for select to authenticated
using (public.is_organization_member(organization_id));

create or replace function public.begin_preflight_run(requested_handoff_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_handoff public.handoffs;
  created_run_id uuid;
begin
  select * into target_handoff
  from public.handoffs
  where id = requested_handoff_id and status = 'draft'
  for update;

  if actor is null or target_handoff.id is null
    or not public.is_organization_admin(target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;
  if target_handoff.stage not in ('review', 'preflight') then
    raise exception 'Finish Review before running Preflight' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'proposed'
  ) then
    raise exception 'Review every proposal before running Preflight' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'approved'
  ) then
    raise exception 'Approve at least one knowledge item before running Preflight' using errcode = '22023';
  end if;

  update public.preflight_runs
  set status = 'failed',
      failure_reason = 'The previous Preflight attempt did not finish. Run it again.',
      completed_at = null,
      finding_count = null
  where handoff_id = target_handoff.id
    and status = 'processing'
    and started_at < now() - interval '10 minutes';

  if exists (
    select 1 from public.preflight_runs run
    where run.handoff_id = target_handoff.id and run.status = 'processing'
  ) then
    raise exception 'Preflight is already running' using errcode = '55000';
  end if;

  insert into public.preflight_runs (organization_id, handoff_id, created_by)
  values (target_handoff.organization_id, target_handoff.id, actor)
  returning id into created_run_id;

  update public.handoffs set stage = 'preflight' where id = target_handoff.id;
  return created_run_id;
end;
$$;

create or replace function public.complete_preflight_run(
  requested_run_id uuid,
  requested_findings jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_run public.preflight_runs;
  finding jsonb;
  evidence jsonb;
  created_finding_id uuid;
  total_findings integer := 0;
  suggested_type text;
  primary_item_id uuid;
  evidence_item_id uuid;
  evidence_source_id uuid;
  evidence_count integer;
begin
  select * into target_run
  from public.preflight_runs
  where id = requested_run_id
  for update;

  if actor is null or target_run.id is null
    or not public.is_organization_admin(target_run.organization_id) then
    raise exception 'Preflight run unavailable' using errcode = '42501';
  end if;
  if target_run.status <> 'processing' then
    raise exception 'Preflight run is not processing' using errcode = '22023';
  end if;
  if jsonb_typeof(requested_findings) <> 'array'
    or jsonb_array_length(requested_findings) > 30 then
    raise exception 'Preflight output is invalid' using errcode = '22023';
  end if;

  for finding in select value from jsonb_array_elements(requested_findings)
  loop
    if jsonb_typeof(finding) <> 'object'
      or not finding ?& array[
        'finding_type', 'severity', 'title', 'question', 'explanation',
        'suggested_knowledge_type', 'primary_knowledge_item_id', 'evidence'
      ]
      or (select count(*) from jsonb_object_keys(finding)) <> 8
      or finding->>'finding_type' not in ('missing', 'ambiguous', 'incomplete', 'contradiction')
      or finding->>'severity' not in ('critical', 'optional')
      or char_length(btrim(finding->>'title')) not between 1 and 160
      or char_length(btrim(finding->>'question')) not between 1 and 500
      or char_length(btrim(finding->>'explanation')) not between 1 and 2000
      or jsonb_typeof(finding->'evidence') <> 'array'
      or jsonb_array_length(finding->'evidence') not between 1 and 6 then
      raise exception 'Preflight finding schema is invalid' using errcode = '22023';
    end if;

    suggested_type := finding->>'suggested_knowledge_type';
    if suggested_type is not null and suggested_type not in (
      'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson'
    ) then
      raise exception 'Suggested knowledge type is invalid' using errcode = '22023';
    end if;

    primary_item_id := nullif(finding->>'primary_knowledge_item_id', '')::uuid;
    if primary_item_id is not null and not exists (
      select 1 from public.knowledge_items item
      where item.id = primary_item_id
        and item.handoff_id = target_run.handoff_id
        and item.status = 'approved'
    ) then
      raise exception 'Primary knowledge evidence is invalid' using errcode = '22023';
    end if;

    insert into public.preflight_findings (
      run_id, organization_id, handoff_id, finding_type, severity, title,
      question, explanation, suggested_knowledge_type, primary_knowledge_item_id
    ) values (
      target_run.id,
      target_run.organization_id,
      target_run.handoff_id,
      finding->>'finding_type',
      finding->>'severity',
      btrim(finding->>'title'),
      btrim(finding->>'question'),
      btrim(finding->>'explanation'),
      suggested_type,
      primary_item_id
    ) returning id into created_finding_id;

    evidence_count := 0;
    for evidence in select value from jsonb_array_elements(finding->'evidence')
    loop
      if jsonb_typeof(evidence) <> 'object'
        or not evidence ?& array[
          'evidence_kind', 'knowledge_item_id', 'source_id', 'label', 'excerpt', 'locator'
        ]
        or (select count(*) from jsonb_object_keys(evidence)) <> 6
        or evidence->>'evidence_kind' not in ('knowledge', 'source')
        or char_length(btrim(evidence->>'label')) not between 1 and 200
        or char_length(btrim(evidence->>'excerpt')) not between 1 and 2000
        or (
          evidence->>'locator' is not null
          and char_length(btrim(evidence->>'locator')) not between 1 and 200
        ) then
        raise exception 'Preflight evidence schema is invalid' using errcode = '22023';
      end if;

      evidence_item_id := nullif(evidence->>'knowledge_item_id', '')::uuid;
      evidence_source_id := nullif(evidence->>'source_id', '')::uuid;
      if evidence->>'evidence_kind' = 'knowledge' then
        if evidence_item_id is null or evidence_source_id is not null or not exists (
          select 1 from public.knowledge_items item
          where item.id = evidence_item_id
            and item.handoff_id = target_run.handoff_id
            and item.status = 'approved'
        ) then
          raise exception 'Knowledge evidence is invalid' using errcode = '22023';
        end if;
      elsif evidence_source_id is null or evidence_item_id is not null or not exists (
        select 1 from public.sources source
        where source.id = evidence_source_id
          and source.handoff_id = target_run.handoff_id
      ) then
        raise exception 'Source evidence is invalid' using errcode = '22023';
      end if;

      insert into public.preflight_finding_evidence (
        finding_id, run_id, organization_id, handoff_id, evidence_kind,
        knowledge_item_id, source_id, label, excerpt, locator
      ) values (
        created_finding_id,
        target_run.id,
        target_run.organization_id,
        target_run.handoff_id,
        evidence->>'evidence_kind',
        evidence_item_id,
        evidence_source_id,
        btrim(evidence->>'label'),
        btrim(evidence->>'excerpt'),
        nullif(btrim(evidence->>'locator'), '')
      );
      evidence_count := evidence_count + 1;
    end loop;

    if finding->>'finding_type' = 'contradiction' and evidence_count < 2 then
      raise exception 'Contradictions require at least two pieces of evidence' using errcode = '22023';
    end if;
    total_findings := total_findings + 1;
  end loop;

  update public.preflight_runs
  set status = 'ready',
      failure_reason = null,
      finding_count = total_findings,
      completed_at = now()
  where id = target_run.id;

  return total_findings;
end;
$$;

create or replace function public.decide_preflight_finding(
  requested_finding_id uuid,
  decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_finding public.preflight_findings;
  run_status text;
begin
  if decision not in ('skipped', 'unknown') then
    raise exception 'Decision must be skipped or unknown' using errcode = '22023';
  end if;
  select * into target_finding
  from public.preflight_findings
  where id = requested_finding_id;

  select status into run_status
  from public.preflight_runs
  where id = target_finding.run_id;

  if actor is null or target_finding.id is null
    or not public.is_organization_admin(target_finding.organization_id) then
    raise exception 'Preflight finding unavailable' using errcode = '42501';
  end if;
  if run_status <> 'ready' or target_finding.status = 'resolved' then
    raise exception 'This finding cannot be changed' using errcode = '22023';
  end if;

  update public.preflight_findings
  set status = decision, decided_by = actor, decided_at = now()
  where id = target_finding.id;
end;
$$;

create or replace function public.resolve_preflight_finding(
  requested_finding_id uuid,
  requested_knowledge_item_id uuid,
  requested_knowledge_type text,
  requested_title text,
  requested_content text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_finding public.preflight_findings;
  run_status text;
  resolved_item_id uuid;
begin
  select * into target_finding
  from public.preflight_findings
  where id = requested_finding_id;

  select status into run_status
  from public.preflight_runs
  where id = target_finding.run_id;

  if actor is null or target_finding.id is null
    or not public.is_organization_admin(target_finding.organization_id) then
    raise exception 'Preflight finding unavailable' using errcode = '42501';
  end if;
  if run_status <> 'ready' or target_finding.status = 'resolved' then
    raise exception 'This finding cannot be resolved' using errcode = '22023';
  end if;
  if requested_knowledge_type not in (
    'responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson'
  )
    or char_length(btrim(coalesce(requested_title, ''))) not between 1 and 160
    or char_length(btrim(coalesce(requested_content, ''))) not between 1 and 5000 then
    raise exception 'Resolution knowledge is invalid' using errcode = '22023';
  end if;

  if requested_knowledge_item_id is null then
    insert into public.knowledge_items (
      organization_id, handoff_id, created_by, knowledge_type, title, content, status, origin
    ) values (
      target_finding.organization_id,
      target_finding.handoff_id,
      actor,
      requested_knowledge_type,
      btrim(requested_title),
      btrim(requested_content),
      'approved',
      'manual'
    ) returning id into resolved_item_id;
  else
    select id into resolved_item_id
    from public.knowledge_items
    where id = requested_knowledge_item_id
      and handoff_id = target_finding.handoff_id
      and status = 'approved';
    if resolved_item_id is null then
      raise exception 'Resolution knowledge is unavailable' using errcode = '42501';
    end if;
    update public.knowledge_items
    set knowledge_type = requested_knowledge_type,
        title = btrim(requested_title),
        content = btrim(requested_content)
    where id = resolved_item_id;
  end if;

  update public.preflight_findings
  set status = 'resolved',
      resolution_knowledge_item_id = resolved_item_id,
      decided_by = actor,
      decided_at = now()
  where id = target_finding.id;

  return resolved_item_id;
end;
$$;

create or replace function public.advance_handoff_to_preview(
  requested_handoff_id uuid,
  acknowledge_critical boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_handoff public.handoffs;
  latest_run public.preflight_runs;
  unresolved_critical integer;
begin
  select * into target_handoff
  from public.handoffs
  where id = requested_handoff_id and status = 'draft'
  for update;

  if actor is null or target_handoff.id is null
    or not public.is_organization_admin(target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;
  select * into latest_run
  from public.preflight_runs run
  where run.handoff_id = target_handoff.id and run.status = 'ready'
  order by run.completed_at desc, run.id desc
  limit 1;
  if latest_run.id is null then
    raise exception 'Run Preflight after the latest knowledge changes' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'proposed'
  ) then
    raise exception 'Review every proposal before Preview' using errcode = '22023';
  end if;

  select count(*) into unresolved_critical
  from public.preflight_findings finding
  where finding.run_id = latest_run.id
    and finding.severity = 'critical'
    and finding.status <> 'resolved';

  if unresolved_critical > 0 and not acknowledge_critical then
    raise exception 'Critical findings require deliberate acknowledgement' using errcode = '22023';
  end if;
  if unresolved_critical > 0 then
    update public.preflight_runs
    set critical_acknowledged_at = now(), critical_acknowledged_by = actor
    where id = latest_run.id;
  end if;

  update public.handoffs set stage = 'preview' where id = target_handoff.id;
end;
$$;

create or replace function public.mark_preflight_stale_for_handoff(requested_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.preflight_runs
  set status = 'failed',
      failure_reason = 'Knowledge changed while Preflight was running. Run it again with the current handoff.'
  where handoff_id = requested_handoff_id and status = 'processing';

  update public.preflight_runs
  set status = 'stale',
      critical_acknowledged_at = null,
      critical_acknowledged_by = null
  where handoff_id = requested_handoff_id and status = 'ready';

  update public.handoffs
  set stage = 'review'
  where id = requested_handoff_id
    and status = 'draft'
    and stage in ('preflight', 'preview');
end;
$$;

create or replace function public.mark_preflight_stale_from_knowledge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.mark_preflight_stale_for_handoff(coalesce(new.handoff_id, old.handoff_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.mark_preflight_stale_from_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'UPDATE' or new.text_content is distinct from old.text_content then
    perform public.mark_preflight_stale_for_handoff(coalesce(new.handoff_id, old.handoff_id));
  end if;
  return coalesce(new, old);
end;
$$;

create trigger knowledge_items_mark_preflight_stale
after insert or update or delete on public.knowledge_items
for each row execute function public.mark_preflight_stale_from_knowledge();

create trigger sources_insert_delete_mark_preflight_stale
after insert or delete on public.sources
for each row execute function public.mark_preflight_stale_from_source();

create trigger sources_text_update_mark_preflight_stale
after update of text_content on public.sources
for each row execute function public.mark_preflight_stale_from_source();

revoke all on function public.begin_preflight_run(uuid) from public;
revoke all on function public.complete_preflight_run(uuid, jsonb) from public;
revoke all on function public.decide_preflight_finding(uuid, text) from public;
revoke all on function public.resolve_preflight_finding(uuid, uuid, text, text, text) from public;
revoke all on function public.advance_handoff_to_preview(uuid, boolean) from public;
revoke all on function public.mark_preflight_stale_for_handoff(uuid) from public;

grant execute on function public.begin_preflight_run(uuid) to authenticated;
grant execute on function public.complete_preflight_run(uuid, jsonb) to authenticated;
grant execute on function public.decide_preflight_finding(uuid, text) to authenticated;
grant execute on function public.resolve_preflight_finding(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.advance_handoff_to_preview(uuid, boolean) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.preflight_runs;
exception when duplicate_object then null;
end;
$$;

do $$
begin
  alter publication supabase_realtime add table public.preflight_findings;
exception when duplicate_object then null;
end;
$$;
