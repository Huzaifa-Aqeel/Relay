-- Shared Organization home, ordinary membership requests, and exact member boundaries.

alter table public.organizations
  add column youtube_video_url text,
  add column constitution_path text,
  add column safety_statement_path text,
  add constraint organizations_youtube_video_url_length
    check (youtube_video_url is null or char_length(youtube_video_url) <= 500),
  add constraint organizations_youtube_video_url_https
    check (youtube_video_url is null or youtube_video_url ~* '^https://((www\.|m\.)?youtube\.com|youtu\.be)/'),
  add constraint organizations_constitution_path_scope
    check (constitution_path is null or split_part(constitution_path, '/', 1) = id::text),
  add constraint organizations_safety_statement_path_scope
    check (safety_statement_path is null or split_part(safety_statement_path, '/', 1) = id::text);

revoke update on public.organizations from authenticated;
grant update (
  name, institution, description, logo_path, youtube_video_url,
  constitution_path, safety_statement_path
) on public.organizations to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('organization-content', 'organization-content', false, 26214400, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members read organization content" on storage.objects
for select to authenticated
using (
  bucket_id = 'organization-content'
  and public.is_organization_member(public.organization_id_from_storage_path(name))
);

create policy "owner uploads organization content" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'organization-content'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
);

create policy "owner updates organization content" on storage.objects
for update to authenticated
using (
  bucket_id = 'organization-content'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
)
with check (
  bucket_id = 'organization-content'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
);

create policy "owner deletes organization content" on storage.objects
for delete to authenticated
using (
  bucket_id = 'organization-content'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
);

create table public.organization_membership_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  unique (organization_id, user_id),
  check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status in ('accepted', 'rejected') and decided_by is not null and decided_at is not null)
  )
);

create index organization_membership_requests_owner_queue
on public.organization_membership_requests (organization_id, status, requested_at);

alter table public.organization_membership_requests enable row level security;

create policy "requesters and owners read membership requests"
on public.organization_membership_requests
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_organization_admin(organization_id)
);

grant select on public.organization_membership_requests to authenticated;
revoke insert, update, delete on public.organization_membership_requests from authenticated;

-- Ordinary members do not need the raw Organization member directory or
-- assignment rows. The continuity RPC exposes only the committee information
-- needed by the shared Organization home.
drop policy if exists "members read organization membership" on public.organization_members;
create policy "members read own membership and owners read organization membership"
on public.organization_members
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_organization_admin(organization_id)
);

drop policy if exists "members see role assignments" on public.role_assignments;
create policy "holders see own assignments and owners see organization assignments"
on public.role_assignments
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_organization_admin(organization_id)
);

-- Handoff metadata was still organization-member readable from the original
-- P0 policy. Keep Owner oversight and exact Role history, but ordinary Members
-- receive no Handoff rows at all.
drop policy if exists "members read handoffs" on public.handoffs;
create policy "authorized users read handoffs"
on public.handoffs
for select to authenticated
using (
  public.is_organization_admin(organization_id)
  or public.can_view_role_history(role_id)
);

create function public.get_my_relay_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hasMembership', exists (
      select 1 from public.organization_members member
      where member.user_id = auth.uid() and member.status = 'active'
    ),
    'hasFullAccess', exists (
      select 1 from public.organization_members member
      where member.user_id = auth.uid()
        and member.status = 'active'
        and member.member_role = 'admin'
    ) or exists (
      select 1
      from public.role_assignments assignment
      join public.organization_members member
        on member.organization_id = assignment.organization_id
        and member.user_id = assignment.user_id
      join public.roles role on role.id = assignment.role_id
      where assignment.user_id = auth.uid()
        and assignment.status = 'active'
        and member.status = 'active'
        and role.archived_at is null
    )
  );
$$;

create function public.search_organizations_for_membership(requested_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  normalized_query text := btrim(coalesce(requested_query, ''));
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(normalized_query) < 2 then
    raise exception 'Enter at least two characters' using errcode = '22023';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'organizationId', organization.id,
      'name', organization.name,
      'institution', organization.institution,
      'requestStatus', request.status
    ) order by organization.name)
    from (
      select candidate.*
      from public.organizations candidate
      where (
        candidate.name ilike '%' || normalized_query || '%'
        or candidate.institution ilike '%' || normalized_query || '%'
      )
        and not exists (
          select 1 from public.organization_members member
          where member.organization_id = candidate.id
            and member.user_id = actor
            and member.status = 'active'
        )
      order by candidate.name
      limit 20
    ) organization
    left join public.organization_membership_requests request
      on request.organization_id = organization.id and request.user_id = actor
  ), '[]'::jsonb);
end;
$$;

create function public.list_my_membership_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'requestId', request.id,
      'organizationId', organization.id,
      'name', organization.name,
      'institution', organization.institution,
      'status', request.status,
      'requestedAt', request.requested_at
    ) order by request.requested_at desc)
    from public.organization_membership_requests request
    join public.organizations organization on organization.id = request.organization_id
    where request.user_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

create function public.request_organization_membership(requested_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  result uuid;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  perform 1 from public.organizations where id = requested_organization_id;
  if not found then
    raise exception 'Organization unavailable' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.organization_members member
    where member.organization_id = requested_organization_id
      and member.user_id = actor and member.status = 'active'
  ) then
    raise exception 'You already belong to this organization' using errcode = '22023';
  end if;

  insert into public.organization_membership_requests (
    organization_id, user_id, status, requested_at, decided_by, decided_at
  ) values (
    requested_organization_id, actor, 'pending', now(), null, null
  )
  on conflict (organization_id, user_id) do update set
    status = 'pending', requested_at = now(), decided_by = null, decided_at = null
  returning id into result;
  return result;
end;
$$;

create function public.list_pending_membership_requests(requested_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_organization_admin(requested_organization_id) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'requestId', request.id,
      'userId', request.user_id,
      'name', profile.display_name,
      'requestedAt', request.requested_at
    ) order by request.requested_at)
    from public.organization_membership_requests request
    join public.profiles profile on profile.id = request.user_id
    where request.organization_id = requested_organization_id
      and request.status = 'pending'
  ), '[]'::jsonb);
end;
$$;

create function public.decide_organization_membership_request(
  requested_request_id uuid,
  requested_decision text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.organization_membership_requests;
begin
  if requested_decision not in ('accepted', 'rejected') then
    raise exception 'Invalid membership decision' using errcode = '22023';
  end if;
  select * into request
  from public.organization_membership_requests
  where id = requested_request_id
  for update;
  if request.id is null or request.status <> 'pending' then
    raise exception 'Membership request unavailable' using errcode = '22023';
  end if;
  perform 1 from public.organizations where id = request.organization_id for update;
  if not public.is_organization_admin(request.organization_id) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;

  if requested_decision = 'accepted' then
    insert into public.organization_members (
      organization_id, user_id, member_role, status, joined_at, ended_at
    ) values (
      request.organization_id, request.user_id, 'member', 'active', now(), null
    )
    on conflict (organization_id, user_id) do update set
      member_role = case
        when public.organization_members.member_role = 'admin' then 'admin'
        else 'member'
      end,
      status = 'active', joined_at = now(), ended_at = null;
  end if;

  update public.organization_membership_requests set
    status = requested_decision,
    decided_by = auth.uid(),
    decided_at = now()
  where id = request.id;
  return request.organization_id;
end;
$$;

revoke all on function public.get_my_relay_access(),
  public.search_organizations_for_membership(text),
  public.list_my_membership_requests(),
  public.request_organization_membership(uuid),
  public.list_pending_membership_requests(uuid),
  public.decide_organization_membership_request(uuid, text)
from public, anon;

grant execute on function public.get_my_relay_access(),
  public.search_organizations_for_membership(text),
  public.list_my_membership_requests(),
  public.request_organization_membership(uuid),
  public.list_pending_membership_requests(uuid),
  public.decide_organization_membership_request(uuid, text)
to authenticated;
