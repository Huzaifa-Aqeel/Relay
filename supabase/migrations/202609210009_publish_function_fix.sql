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
  select * into target_handoff
  from public.handoffs
  where id = requested_handoff_id and status = 'draft'
  for update;

  if actor is null or target_handoff.id is null
    or not public.is_organization_admin(target_handoff.organization_id) then
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

  select * into target_run
  from public.preflight_runs run
  where run.handoff_id = target_handoff.id and run.status = 'ready'
  order by run.created_at desc, run.id desc
  limit 1;
  if target_run.id is null then
    raise exception 'Run Preflight after the latest knowledge changes' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.preflight_findings finding
    where finding.run_id = target_run.id
      and finding.severity = 'critical'
      and finding.status <> 'resolved'
  ) and target_run.critical_acknowledged_at is null then
    raise exception 'Critical findings require deliberate acknowledgement' using errcode = '22023';
  end if;

  select * into target_organization
  from public.organizations where id = target_handoff.organization_id;
  select * into target_role
  from public.roles where id = target_handoff.role_id;

  insert into public.handoff_publications (
    organization_id, handoff_id, access_token, status,
    organization_name, organization_institution,
    role_title, role_description, service_period,
    published_by, published_at, revoked_by, revoked_at
  ) values (
    target_handoff.organization_id,
    target_handoff.id,
    issued_token,
    'active',
    target_organization.name,
    target_organization.institution,
    target_role.title,
    target_role.description,
    target_handoff.service_period,
    actor,
    now(),
    null,
    null
  )
  on conflict (handoff_id) do update set
    access_token = excluded.access_token,
    status = 'active',
    organization_name = excluded.organization_name,
    organization_institution = excluded.organization_institution,
    role_title = excluded.role_title,
    role_description = excluded.role_description,
    service_period = excluded.service_period,
    published_by = excluded.published_by,
    published_at = excluded.published_at,
    revoked_by = null,
    revoked_at = null
  returning id into created_publication_id;

  delete from public.handoff_publication_items item
  where item.publication_id = created_publication_id;

  insert into public.handoff_publication_items (
    publication_id, organization_id, handoff_id, source_knowledge_item_id,
    knowledge_type, title, content, sort_order
  )
  select
    created_publication_id,
    item.organization_id,
    item.handoff_id,
    item.id,
    item.knowledge_type,
    item.title,
    item.content,
    item.sort_order
  from public.knowledge_items item
  where item.handoff_id = target_handoff.id and item.status = 'approved'
  order by item.sort_order, item.created_at, item.id;

  update public.handoffs
  set status = 'published', stage = 'published', published_at = now()
  where id = target_handoff.id;

  return issued_token;
end;
$$;
