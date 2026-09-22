-- Organization continuity: ownership, membership and role-period authority are distinct.
alter table public.organization_members
  add column status text not null default 'active' check (status in ('active', 'ended')),
  add column joined_at timestamptz not null default now(),
  add column ended_at timestamptz;
update public.organization_members set joined_at = created_at;

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null,
  user_id uuid not null references public.profiles(id),
  service_period text not null check (char_length(btrim(service_period)) between 1 and 40),
  status text not null default 'active' check (status in ('active', 'ended')),
  assigned_by uuid not null references public.profiles(id),
  accepted_at timestamptz not null default now(),
  ended_at timestamptz,
  foreign key (role_id, organization_id) references public.roles(id, organization_id) on delete cascade,
  check ((status = 'ended') = (ended_at is not null))
);
create unique index role_assignments_one_active on public.role_assignments(role_id, service_period) where status = 'active';
create index role_assignments_user on public.role_assignments(user_id, organization_id, status);

-- Existing creators retain their existing workspaces; new ownership alone grants no editing.
insert into public.organization_members (organization_id, user_id, member_role)
select id, created_by, 'admin' from public.organizations
on conflict (organization_id, user_id) do update set member_role = 'admin', status = 'active', ended_at = null;
update public.organization_members m set member_role = 'member'
from public.organizations o where o.id = m.organization_id and m.user_id <> o.created_by;
create unique index organization_one_owner on public.organization_members(organization_id)
where member_role = 'admin' and status = 'active';
insert into public.role_assignments (organization_id, role_id, user_id, service_period, assigned_by)
select h.organization_id, h.role_id, o.created_by, h.service_period, o.created_by
from public.handoffs h join public.organizations o on o.id = h.organization_id;

create or replace function public.is_organization_member(requested_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organization_members m where m.organization_id = requested_organization_id
    and m.user_id = auth.uid() and m.status = 'active');
$$;
create or replace function public.is_organization_admin(requested_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizations o where o.id = requested_organization_id
    and o.created_by = auth.uid()) and public.is_organization_member(requested_organization_id);
$$;
create function public.is_role_holder_for_handoff(requested_handoff_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.handoffs h join public.role_assignments a
    on a.organization_id = h.organization_id and a.role_id = h.role_id and a.service_period = h.service_period
    join public.organization_members m on m.organization_id = a.organization_id and m.user_id = a.user_id
    where h.id = requested_handoff_id and a.user_id = auth.uid() and a.status = 'active' and m.status = 'active');
$$;
create function public.can_view_role_history(requested_role_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.roles r where r.id = requested_role_id and (
    public.is_organization_admin(r.organization_id) or (public.is_organization_member(r.organization_id) and exists (
      select 1 from public.role_assignments a where a.role_id = r.id and a.user_id = auth.uid() and a.status = 'active'))));
$$;
create function public.can_view_handoff_history(requested_handoff_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_view_role_history(h.role_id) from public.handoffs h where h.id = requested_handoff_id;
$$;
revoke all on function public.is_role_holder_for_handoff(uuid), public.can_view_role_history(uuid), public.can_view_handoff_history(uuid) from public;
grant execute on function public.is_role_holder_for_handoff(uuid), public.can_view_role_history(uuid), public.can_view_handoff_history(uuid) to authenticated;

-- No direct membership changes, privilege grants, or ownership changes from a client.
drop policy "admins add organization members" on public.organization_members;
drop policy "admins update organization members" on public.organization_members;
drop policy "admins remove organization members" on public.organization_members;
revoke update on public.organizations from authenticated;
grant update (name, institution, description, logo_path) on public.organizations to authenticated;
alter table public.role_assignments enable row level security;
create policy "members see role assignments" on public.role_assignments for select to authenticated
using (public.is_organization_member(organization_id));

-- Replace the legacy organization-wide policies with exact workspace checks.
do $$
declare p record; t text;
begin
  for p in select schemaname, tablename, policyname from pg_policies where schemaname = 'public'
    and tablename in ('sources','knowledge_items','knowledge_item_sources','preflight_runs','preflight_findings',
      'preflight_finding_evidence','knowledge_item_revisions','source_version_changes','knowledge_lineages',
      'knowledge_relationships','role_memory_comparisons','role_memory_changes','handoff_publications','handoff_publication_items')
  loop execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename); end loop;
  foreach t in array array['sources','knowledge_item_sources','preflight_runs','preflight_findings',
    'preflight_finding_evidence','knowledge_item_revisions','source_version_changes'] loop
    execute format('create policy "assigned holders read workspace" on public.%I for select to authenticated using (public.is_role_holder_for_handoff(handoff_id))', t);
  end loop;
  foreach t in array array['sources','knowledge_items','knowledge_item_sources'] loop
    execute format('create policy "assigned holders insert draft" on public.%I for insert to authenticated with check (public.is_role_holder_for_handoff(handoff_id) and public.is_draft_handoff(handoff_id, organization_id)%s)', t,
      case when t = 'knowledge_item_sources' then '' else ' and created_by = auth.uid()' end);
    execute format('create policy "assigned holders update draft" on public.%I for update to authenticated using (public.is_role_holder_for_handoff(handoff_id) and public.is_draft_handoff(handoff_id, organization_id)) with check (public.is_role_holder_for_handoff(handoff_id) and public.is_draft_handoff(handoff_id, organization_id))', t);
    execute format('create policy "assigned holders delete draft" on public.%I for delete to authenticated using (public.is_role_holder_for_handoff(handoff_id) and public.is_draft_handoff(handoff_id, organization_id))', t);
  end loop;
  foreach t in array array['handoff_publications','handoff_publication_items'] loop
    execute format('create policy "authorized published history" on public.%I for select to authenticated using (public.can_view_handoff_history(handoff_id))', t);
  end loop;
  foreach t in array array['knowledge_lineages','knowledge_relationships','role_memory_comparisons','role_memory_changes'] loop
    execute format('create policy "authorized role memory" on public.%I for select to authenticated using (public.can_view_role_history(role_id))', t);
  end loop;
end;
$$;
create policy "holders and owner approved oversight" on public.knowledge_items for select to authenticated
using (public.is_role_holder_for_handoff(handoff_id) or (status = 'approved' and public.is_organization_admin(organization_id)));
drop policy "admins update draft handoffs" on public.handoffs;
drop policy "admins delete draft handoffs" on public.handoffs;
-- Lifecycle is changed only through guarded RPCs. Identity/attribution cannot be rewritten.
revoke update, delete on public.handoffs from authenticated;
revoke update on public.sources, public.knowledge_items from authenticated;
grant update (title, text_content, processing_status, failure_reason, structuring_status, structuring_failure_reason, structured_at, structured_proposal_count) on public.sources to authenticated;
grant update (knowledge_type, title, content, sort_order) on public.knowledge_items to authenticated;
drop policy "members read handoff source files" on storage.objects;
drop policy "admins upload draft handoff source files" on storage.objects;
drop policy "admins delete draft handoff source files" on storage.objects;
create policy "holders read private files" on storage.objects for select to authenticated using (
  bucket_id = 'handoff-sources' and public.is_role_holder_for_handoff(public.handoff_id_from_storage_path(name))
  and exists (select 1 from public.handoffs h where h.id = public.handoff_id_from_storage_path(name) and h.organization_id = public.organization_id_from_storage_path(name)));
create policy "holders upload draft files" on storage.objects for insert to authenticated with check (
  bucket_id = 'handoff-sources' and public.is_role_holder_for_handoff(public.handoff_id_from_storage_path(name))
  and public.is_draft_handoff(public.handoff_id_from_storage_path(name), public.organization_id_from_storage_path(name)));
create policy "holders delete draft files" on storage.objects for delete to authenticated using (
  bucket_id = 'handoff-sources' and public.is_role_holder_for_handoff(public.handoff_id_from_storage_path(name))
  and public.is_draft_handoff(public.handoff_id_from_storage_path(name), public.organization_id_from_storage_path(name)));

-- Keep the tested P0 RPC bodies; replace only their authorization predicates.
-- Fail the migration if an expected predicate has drifted.
do $$
declare spec record; definition text; old_check text; new_check text;
begin
  for spec in select * from (values
    ('move_knowledge_item(uuid,text)', 'current_item', 'handoff_id'),
    ('begin_handoff_review(uuid)', 'target_handoff', 'id'),
    ('return_handoff_to_capture(uuid)', 'target_handoff', 'id'),
    ('decide_knowledge_proposal(uuid,text)', 'proposal', 'handoff_id'),
    ('replace_source_knowledge_proposals_v13(uuid,jsonb)', 'target_source', 'handoff_id'),
    ('begin_preflight_run(uuid)', 'target_handoff', 'id'),
    ('complete_preflight_run(uuid,jsonb)', 'target_run', 'handoff_id'),
    ('decide_preflight_finding(uuid,text)', 'target_finding', 'handoff_id'),
    ('resolve_preflight_finding(uuid,uuid,text,text,text)', 'target_finding', 'handoff_id'),
    ('advance_handoff_to_preview(uuid,boolean)', 'target_handoff', 'id'),
    ('publish_handoff(uuid)', 'target_handoff', 'id'),
    ('revoke_handoff_link(uuid)', 'target_handoff', 'id'),
    ('replace_handoff_link(uuid)', 'target_handoff', 'id'),
    ('confirm_memory_change_reason(uuid,text,text)', 'target', 'role_id'),
    ('confirm_memory_change_reason_v13(uuid,text,text,uuid)', 'target', 'role_id')
  ) as specs(signature, variable, field) loop
    definition := pg_get_functiondef(('public.' || spec.signature)::regprocedure);
    old_check := 'public.is_organization_admin(' || spec.variable || '.organization_id)';
    new_check := case when spec.field = 'role_id' then 'public.can_view_role_history(' else 'public.is_role_holder_for_handoff(' end || spec.variable || '.' || spec.field || ')';
    if position(old_check in definition) = 0 then raise exception 'Authorization predicate drift: %', spec.signature; end if;
    execute replace(definition, old_check, new_check);
  end loop;
end;
$$;
