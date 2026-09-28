-- Remove the Handoff Check/Preflight subsystem. Review now advances directly
-- to exact Preview after every proposal has a decision. Keep only the
-- publication-integrity behavior that returns a changed Preview to Review.

create or replace function public.reopen_handoff_for_revision(requested_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_role_holder_for_handoff(requested_handoff_id) then
    raise exception 'Active Role Assignment required' using errcode = '42501';
  end if;
  update public.handoffs
  set status = 'draft', stage = 'capture', published_at = null
  where id = requested_handoff_id and status = 'published';
end;
$$;

create or replace function public.get_organization_continuity(requested_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_organization_member(requested_organization_id) then
    raise exception 'Organization unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'isOwner', public.is_organization_admin(requested_organization_id),
    'currentOwnerName', (
      select profile.display_name
      from public.organizations organization
      join public.profiles profile on profile.id = organization.created_by
      where organization.id = requested_organization_id
    ),
    'members', case when public.is_organization_admin(requested_organization_id) then coalesce((
      select jsonb_agg(jsonb_build_object('userId', member.user_id, 'name', profile.display_name))
      from public.organization_members member
      join public.profiles profile on profile.id = member.user_id
      where member.organization_id = requested_organization_id and member.status = 'active'
    ), '[]'::jsonb) else '[]'::jsonb end,
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'roleId', role.id,
        'title', role.title,
        'planAvailable', public.organization_role_is_entitled(role.organization_id, role.id),
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', assignment.id,
            'userId', assignment.user_id,
            'name', profile.display_name,
            'servicePeriod', assignment.service_period
          ) order by public.service_period_start(assignment.service_period) desc,
            assignment.accepted_at desc)
          from public.role_assignments assignment
          join public.profiles profile on profile.id = assignment.user_id
          where assignment.role_id = role.id and assignment.status = 'active'
        ), '[]'::jsonb),
        'handoffs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', handoff.id,
            'servicePeriod', handoff.service_period,
            'status', handoff.status,
            'stage', handoff.stage,
            'updatedAt', handoff.updated_at,
            'canMaintain', public.is_role_holder_for_handoff(handoff.id),
            'approvedCount', (
              select count(*) from public.knowledge_items knowledge
              where knowledge.handoff_id = handoff.id and knowledge.status = 'approved'
            ),
            'publicationStatus', (
              select status from public.handoff_publications where handoff_id = handoff.id
            )
          ) order by public.service_period_start(handoff.service_period) desc, handoff.updated_at desc)
          from public.handoffs handoff
          where handoff.role_id = role.id
            and (
              public.is_organization_admin(requested_organization_id)
              or public.can_view_role_history(role.id)
            )
        ), '[]'::jsonb)
      ) order by role.title)
      from public.roles role
      where role.organization_id = requested_organization_id and role.archived_at is null
    ), '[]'::jsonb),
    'pendingTransfer', (
      select jsonb_build_object(
        'id', transfer.id,
        'toUserId', transfer.to_user_id,
        'expiresAt', transfer.expires_at
      )
      from public.organization_ownership_transfers transfer
      where transfer.organization_id = requested_organization_id
        and transfer.status = 'pending'
        and transfer.expires_at > now()
        and auth.uid() in (transfer.from_user_id, transfer.to_user_id)
    )
  ) into result;
  return result;
end;
$$;

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

drop trigger if exists knowledge_items_mark_preflight_stale on public.knowledge_items;
drop trigger if exists sources_insert_delete_mark_preflight_stale on public.sources;
drop trigger if exists sources_text_update_mark_preflight_stale on public.sources;

drop function if exists public.begin_preflight_run(uuid);
drop function if exists public.complete_preflight_run(uuid, jsonb);
drop function if exists public.decide_preflight_finding(uuid, text);
drop function if exists public.resolve_preflight_finding(uuid, uuid, text, text, text);
drop function if exists public.advance_handoff_to_preview(uuid, boolean);
drop function if exists public.mark_preflight_stale_from_knowledge();
drop function if exists public.mark_preflight_stale_from_source();
drop function if exists public.mark_preflight_stale_for_handoff(uuid);

drop table if exists public.preflight_finding_evidence;
drop table if exists public.preflight_findings;
drop table if exists public.preflight_runs;

-- No deployed draft currently uses this stage. The update keeps fresh/local
-- databases safe if a fixture reaches it before this removal migration.
update public.handoffs set stage = 'review' where stage = 'preflight';
alter table public.handoffs drop constraint if exists handoffs_stage_check;
alter table public.handoffs add constraint handoffs_stage_check
  check (stage in ('capture', 'review', 'preview', 'published'));

create or replace function public.invalidate_handoff_preview(requested_handoff_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.handoffs
  set stage = 'review'
  where id = requested_handoff_id and status = 'draft' and stage = 'preview';
$$;

create or replace function public.invalidate_preview_from_knowledge()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.invalidate_handoff_preview(coalesce(new.handoff_id, old.handoff_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.invalidate_preview_from_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.invalidate_handoff_preview(coalesce(new.handoff_id, old.handoff_id));
  return coalesce(new, old);
end;
$$;

create trigger knowledge_items_invalidate_preview
after insert or update or delete on public.knowledge_items
for each row execute function public.invalidate_preview_from_knowledge();

create trigger sources_insert_delete_invalidate_preview
after insert or delete on public.sources
for each row execute function public.invalidate_preview_from_source();

create trigger sources_text_update_invalidate_preview
after update of text_content on public.sources
for each row execute function public.invalidate_preview_from_source();

create or replace function public.advance_handoff_to_preview(requested_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_handoff public.handoffs;
begin
  select * into target_handoff from public.handoffs
  where id = requested_handoff_id and status = 'draft' for update;
  if target_handoff.id is null
    or not public.is_role_holder_for_handoff(target_handoff.id)
    or not public.is_draft_handoff(target_handoff.id, target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;
  if target_handoff.stage <> 'review' then
    raise exception 'Finish Review before Preview' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'proposed'
  ) then
    raise exception 'Review every proposal before Preview' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.knowledge_items item
    where item.handoff_id = target_handoff.id and item.status = 'approved'
  ) then
    raise exception 'Approve at least one knowledge item before Preview' using errcode = '22023';
  end if;
  update public.handoffs set stage = 'preview' where id = target_handoff.id;
end;
$$;

revoke all on function public.invalidate_handoff_preview(uuid),
  public.invalidate_preview_from_knowledge(),
  public.invalidate_preview_from_source() from public, anon, authenticated;
revoke all on function public.advance_handoff_to_preview(uuid) from public, anon;
grant execute on function public.advance_handoff_to_preview(uuid) to authenticated;
revoke all on function public.reopen_handoff_for_revision(uuid),
  public.get_organization_continuity(uuid),
  public.publish_handoff(uuid) from public, anon;
grant execute on function public.reopen_handoff_for_revision(uuid),
  public.get_organization_continuity(uuid),
  public.publish_handoff(uuid) to authenticated;
