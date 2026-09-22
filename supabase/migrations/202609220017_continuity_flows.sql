alter table public.knowledge_items drop constraint knowledge_items_origin_check;
alter table public.knowledge_items add constraint knowledge_items_origin_check check (origin in ('manual','ai','inherited'));
alter table public.knowledge_items
  add column inherited_from_handoff_id uuid references public.handoffs(id) on delete set null,
  add column inherited_from_service_period text,
  add column inherited_citation_sources jsonb not null default '[]'::jsonb;

create table public.role_assignment_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null,
  service_period text not null check (char_length(btrim(service_period)) between 1 and 40),
  token_hash text not null unique,
  created_by uuid not null references public.profiles(id),
  replacement_assignment_id uuid references public.role_assignments(id),
  expires_at timestamptz not null default now() + interval '7 days',
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (role_id, organization_id) references public.roles(id, organization_id) on delete cascade
);
alter table public.role_assignment_invites enable row level security;
create policy "owners read assignment invites" on public.role_assignment_invites for select to authenticated
using (public.is_organization_admin(organization_id));

create function public.create_role_assignment_invite(requested_role_id uuid, requested_service_period text, replace_existing boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.roles; a public.role_assignments; token text := public.new_handoff_access_token(); invite public.role_assignment_invites;
begin
  select * into r from public.roles where id = requested_role_id and archived_at is null;
  if r.id is null or not public.is_organization_admin(r.organization_id) then raise exception 'Owner access required' using errcode = '42501'; end if;
  perform 1 from public.organizations where id = r.organization_id for update;
  if not public.is_organization_admin(r.organization_id) then raise exception 'Owner access required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(requested_service_period,''))) not between 1 and 40 then raise exception 'Service period is invalid' using errcode = '22023'; end if;
  select * into a from public.role_assignments where role_id = r.id and service_period = btrim(requested_service_period) and status = 'active';
  if a.id is not null and not replace_existing then raise exception 'Confirm replacement of the existing Role Holder' using errcode = '22023'; end if;
  update public.role_assignment_invites set status = 'revoked' where role_id = r.id and service_period = btrim(requested_service_period) and status = 'pending';
  insert into public.role_assignment_invites(organization_id,role_id,service_period,token_hash,created_by,replacement_assignment_id)
  values(r.organization_id,r.id,btrim(requested_service_period),encode(extensions.digest(token,'sha256'),'hex'),auth.uid(),a.id) returning * into invite;
  return jsonb_build_object('token',token,'expiresAt',invite.expires_at);
end;
$$;
create function public.preview_role_assignment_invite(requested_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select jsonb_build_object('organizationName',o.name,'roleTitle',r.title,'servicePeriod',i.service_period,'expiresAt',i.expires_at,'replacement',i.replacement_assignment_id is not null)
  into result from public.role_assignment_invites i join public.organizations o on o.id = i.organization_id join public.roles r on r.id = i.role_id
  where i.token_hash = encode(extensions.digest(requested_token,'sha256'),'hex') and i.status = 'pending' and i.expires_at > now()
    and i.created_by = o.created_by and r.archived_at is null;
  if result is null then raise exception 'Invite unavailable or expired' using errcode = '22023'; end if;
  return result;
end;
$$;

create or replace function public.create_handoff(requested_organization_id uuid, requested_role_id uuid, requested_service_period text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare h uuid; previous public.handoff_publications;
begin
  perform 1 from public.organizations where id = requested_organization_id for update;
  if not public.is_organization_member(requested_organization_id) or not exists (
    select 1 from public.role_assignments a join public.roles r on r.id = a.role_id
    where a.organization_id = requested_organization_id and a.role_id = requested_role_id and a.user_id = auth.uid()
      and a.service_period = btrim(requested_service_period) and a.status = 'active' and r.archived_at is null
  ) then raise exception 'Active Role Assignment required' using errcode = '42501'; end if;
  select id into h from public.handoffs where role_id = requested_role_id and service_period = btrim(requested_service_period);
  if h is not null then return h; end if;
  if not public.organization_has_relay_pro(requested_organization_id) and exists (
    select 1 from public.handoffs where organization_id = requested_organization_id and status <> 'archived'
  ) then raise exception 'RELAY_PRO_REQUIRED:handoff' using errcode = 'P0001'; end if;
  insert into public.handoffs(organization_id,role_id,created_by,service_period)
  values(requested_organization_id,requested_role_id,auth.uid(),btrim(requested_service_period)) returning id into h;
  -- Carry forward only a prior publication, never mutable private evidence or proposal queues.
  select p.* into previous from public.handoff_publications p join public.handoffs old on old.id = p.handoff_id
  where old.role_id = requested_role_id and old.organization_id = requested_organization_id
    and old.service_period < btrim(requested_service_period)
  order by old.service_period desc, p.published_at desc limit 1;
  if previous.id is not null then
    insert into public.knowledge_items(organization_id,handoff_id,created_by,knowledge_type,title,content,status,origin,sort_order,lineage_id,
      inherited_from_handoff_id,inherited_from_service_period,inherited_citation_sources)
    select requested_organization_id,h,coalesce(k.created_by,previous.published_by),p.knowledge_type,p.title,p.content,'approved','inherited',p.sort_order,p.knowledge_lineage_id,
      previous.handoff_id,previous.service_period,p.citation_sources
    from public.handoff_publication_items p left join public.knowledge_items k on k.id = p.source_knowledge_item_id
    where p.publication_id = previous.id;
  end if;
  return h;
end;
$$;

create function public.accept_role_assignment_invite(requested_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.role_assignment_invites; current_assignment uuid; h uuid; owner_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into i from public.role_assignment_invites where token_hash = encode(extensions.digest(requested_token,'sha256'),'hex');
  if i.id is null then raise exception 'Invite unavailable or expired' using errcode = '22023'; end if;
  select created_by into owner_id from public.organizations where id = i.organization_id for update;
  select * into i from public.role_assignment_invites where id = i.id for update;
  if i.status <> 'pending' or i.expires_at <= now() or i.created_by <> owner_id then raise exception 'Invite unavailable or expired' using errcode = '22023'; end if;
  select id into current_assignment from public.role_assignments where role_id = i.role_id and service_period = i.service_period and status = 'active';
  if current_assignment is distinct from i.replacement_assignment_id then raise exception 'Assignment changed; request a new invite' using errcode = '22023'; end if;
  update public.role_assignments set status = 'ended', ended_at = now() where id = current_assignment;
  insert into public.organization_members(organization_id,user_id,member_role,status)
  values(i.organization_id,auth.uid(),case when auth.uid() = owner_id then 'admin' else 'member' end,'active')
  on conflict (organization_id,user_id) do update set status = 'active', ended_at = null;
  insert into public.role_assignments(organization_id,role_id,user_id,service_period,assigned_by)
  values(i.organization_id,i.role_id,auth.uid(),i.service_period,i.created_by);
  h := public.create_handoff(i.organization_id,i.role_id,i.service_period);
  update public.role_assignment_invites set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = i.id;
  return h;
end;
$$;
create function public.end_role_assignment(requested_assignment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.role_assignments;
begin
  select * into a from public.role_assignments where id = requested_assignment_id;
  if a.id is null or not public.is_organization_admin(a.organization_id) then raise exception 'Owner access required' using errcode = '42501'; end if;
  perform 1 from public.organizations where id = a.organization_id for update;
  if not public.is_organization_admin(a.organization_id) then raise exception 'Owner access required' using errcode = '42501'; end if;
  update public.role_assignments set status = 'ended',ended_at = now() where id = a.id and status = 'active';
  update public.role_assignment_invites set status = 'revoked' where replacement_assignment_id = a.id and status = 'pending';
end;
$$;
create function public.reopen_handoff_for_revision(requested_handoff_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_role_holder_for_handoff(requested_handoff_id) then raise exception 'Active Role Assignment required' using errcode = '42501'; end if;
  update public.handoffs set status = 'draft',stage = 'capture',published_at = null where id = requested_handoff_id and status = 'published';
  update public.preflight_runs set status = 'stale' where handoff_id = requested_handoff_id and status = 'ready';
end;
$$;

create table public.organization_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_user_id uuid not null references public.profiles(id),
  to_user_id uuid not null references public.profiles(id),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  check (from_user_id <> to_user_id)
);
create unique index organization_one_pending_transfer on public.organization_ownership_transfers(organization_id) where status = 'pending';
alter table public.organization_ownership_transfers enable row level security;
create policy "transfer parties read offer" on public.organization_ownership_transfers for select to authenticated
using (auth.uid() in (from_user_id,to_user_id));
create function public.request_organization_ownership_transfer(requested_organization_id uuid, requested_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  perform 1 from public.organizations where id = requested_organization_id for update;
  if not public.is_organization_admin(requested_organization_id) then raise exception 'Owner access required' using errcode = '42501'; end if;
  if requested_user_id = auth.uid() or not exists (select 1 from public.organization_members where organization_id = requested_organization_id and user_id = requested_user_id and status = 'active') then
    raise exception 'Select another active Organization member' using errcode = '22023'; end if;
  update public.organization_ownership_transfers set status = 'cancelled' where organization_id = requested_organization_id and status = 'pending';
  insert into public.organization_ownership_transfers(organization_id,from_user_id,to_user_id)
  values(requested_organization_id,auth.uid(),requested_user_id) returning id into result;
  return result;
end;
$$;
create function public.accept_organization_ownership_transfer(requested_transfer_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.organization_ownership_transfers; owner_id uuid;
begin
  select * into t from public.organization_ownership_transfers where id = requested_transfer_id;
  if t.id is null or auth.uid() is distinct from t.to_user_id then raise exception 'Transfer unavailable' using errcode = '42501'; end if;
  select created_by into owner_id from public.organizations where id = t.organization_id for update;
  select * into t from public.organization_ownership_transfers where id = t.id for update;
  if t.status <> 'pending' or t.expires_at <= now() or owner_id <> t.from_user_id or not public.is_organization_member(t.organization_id) then
    raise exception 'Transfer unavailable' using errcode = '42501'; end if;
  update public.organization_members set member_role = 'member' where organization_id = t.organization_id and user_id = t.from_user_id;
  update public.organization_members set member_role = 'admin' where organization_id = t.organization_id and user_id = t.to_user_id;
  update public.organizations set created_by = t.to_user_id where id = t.organization_id;
  update public.organization_ownership_transfers set status = 'accepted',accepted_at = now() where id = t.id;
  update public.role_assignment_invites set status = 'revoked' where organization_id = t.organization_id and status = 'pending';
  -- Purchaser and RevenueCat association deliberately remain unchanged.
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['create_role_assignment_invite(uuid,text,boolean)','preview_role_assignment_invite(text)',
    'accept_role_assignment_invite(text)','end_role_assignment(uuid)','reopen_handoff_for_revision(uuid)',
    'request_organization_ownership_transfer(uuid,uuid)','accept_organization_ownership_transfer(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end;
$$;

-- Snapshot inherited safe citations along with newly approved source evidence.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.publish_handoff(uuid)'::regprocedure);
  definition := replace(definition, 'item.sort_order,' || chr(10) || '    coalesce(', 'item.sort_order,' || chr(10) || '    item.inherited_citation_sources || coalesce(');
  execute definition;
end;
$$;
