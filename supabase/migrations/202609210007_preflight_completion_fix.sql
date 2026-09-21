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
