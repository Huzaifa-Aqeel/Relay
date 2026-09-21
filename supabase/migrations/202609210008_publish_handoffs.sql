create table public.handoff_publications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null,
  access_token text not null unique
    check (access_token ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'revoked')),
  organization_name text not null check (char_length(btrim(organization_name)) between 1 and 100),
  organization_institution text not null default '' check (char_length(organization_institution) <= 160),
  role_title text not null check (char_length(btrim(role_title)) between 1 and 120),
  role_description text not null default '' check (char_length(role_description) <= 1200),
  service_period text not null check (char_length(btrim(service_period)) between 1 and 40),
  published_by uuid not null references public.profiles(id) on delete cascade,
  published_at timestamptz not null default now(),
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (handoff_id, organization_id)
    references public.handoffs(id, organization_id) on delete cascade,
  unique (handoff_id),
  unique (id, handoff_id, organization_id),
  check ((status = 'revoked') = (revoked_at is not null and revoked_by is not null))
);

create table public.handoff_publication_items (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
  organization_id uuid not null,
  handoff_id uuid not null,
  source_knowledge_item_id uuid not null,
  knowledge_type text not null check (
    knowledge_type in ('responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson')
  ),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  content text not null check (char_length(btrim(content)) between 1 and 5000),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(),
  foreign key (publication_id, handoff_id, organization_id)
    references public.handoff_publications(id, handoff_id, organization_id) on delete cascade,
  unique (publication_id, source_knowledge_item_id)
);

create index handoff_publication_items_order_idx
on public.handoff_publication_items(publication_id, sort_order, created_at, id);

create trigger handoff_publications_set_updated_at before update on public.handoff_publications
for each row execute function public.set_updated_at();

alter table public.handoff_publications enable row level security;
alter table public.handoff_publication_items enable row level security;

create policy "admins read handoff publications" on public.handoff_publications
for select to authenticated
using (public.is_organization_admin(organization_id));

create policy "admins read published handoff items" on public.handoff_publication_items
for select to authenticated
using (public.is_organization_admin(organization_id));

create or replace function public.is_draft_handoff(
  requested_handoff_id uuid,
  requested_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.handoffs handoff
    where handoff.id = requested_handoff_id
      and handoff.organization_id = requested_organization_id
      and handoff.status = 'draft'
  );
$$;

create or replace function public.handoff_id_from_storage_path(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(object_name, '/', 2)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

drop policy "admins update handoffs" on public.handoffs;
drop policy "admins delete handoffs" on public.handoffs;

create policy "admins update draft handoffs" on public.handoffs
for update to authenticated
using (public.is_organization_admin(organization_id) and status = 'draft')
with check (public.is_organization_admin(organization_id) and status = 'draft');

create policy "admins delete draft handoffs" on public.handoffs
for delete to authenticated
using (public.is_organization_admin(organization_id) and status = 'draft');

drop policy "admins create handoff sources" on public.sources;
drop policy "admins update handoff sources" on public.sources;
drop policy "admins delete handoff sources" on public.sources;

create policy "admins create draft handoff sources" on public.sources
for insert to authenticated
with check (
  public.is_organization_admin(organization_id)
  and created_by = (select auth.uid())
  and public.is_draft_handoff(handoff_id, organization_id)
);

create policy "admins update draft handoff sources" on public.sources
for update to authenticated
using (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
)
with check (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
);

create policy "admins delete draft handoff sources" on public.sources
for delete to authenticated
using (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
);

drop policy "admins create handoff knowledge" on public.knowledge_items;
drop policy "admins update handoff knowledge" on public.knowledge_items;
drop policy "admins delete handoff knowledge" on public.knowledge_items;

create policy "admins create draft handoff knowledge" on public.knowledge_items
for insert to authenticated
with check (
  public.is_organization_admin(organization_id)
  and created_by = (select auth.uid())
  and public.is_draft_handoff(handoff_id, organization_id)
);

create policy "admins update draft handoff knowledge" on public.knowledge_items
for update to authenticated
using (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
)
with check (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
);

create policy "admins delete draft handoff knowledge" on public.knowledge_items
for delete to authenticated
using (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
);

drop policy "admins create knowledge provenance" on public.knowledge_item_sources;
drop policy "admins update knowledge provenance" on public.knowledge_item_sources;
drop policy "admins delete knowledge provenance" on public.knowledge_item_sources;

create policy "admins create draft knowledge provenance" on public.knowledge_item_sources
for insert to authenticated
with check (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
);

create policy "admins update draft knowledge provenance" on public.knowledge_item_sources
for update to authenticated
using (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
)
with check (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
);

create policy "admins delete draft knowledge provenance" on public.knowledge_item_sources
for delete to authenticated
using (
  public.is_organization_admin(organization_id)
  and public.is_draft_handoff(handoff_id, organization_id)
);

drop policy "admins upload handoff source files" on storage.objects;
drop policy "admins delete handoff source files" on storage.objects;

create policy "admins upload draft handoff source files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'handoff-sources'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
  and public.is_draft_handoff(
    public.handoff_id_from_storage_path(name),
    public.organization_id_from_storage_path(name)
  )
);

create policy "admins delete draft handoff source files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'handoff-sources'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
  and public.is_draft_handoff(
    public.handoff_id_from_storage_path(name),
    public.organization_id_from_storage_path(name)
  )
);

create or replace function public.new_handoff_access_token()
returns text
language sql
volatile
security definer
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
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

create or replace function public.revoke_handoff_link(requested_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_handoff public.handoffs;
begin
  select * into target_handoff from public.handoffs where id = requested_handoff_id;
  if actor is null or target_handoff.id is null
    or not public.is_organization_admin(target_handoff.organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;

  update public.handoff_publications
  set status = 'revoked', revoked_by = actor, revoked_at = now()
  where handoff_id = target_handoff.id and status = 'active';
  if not found then
    raise exception 'Active published link unavailable' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.replace_handoff_link(requested_handoff_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_handoff public.handoffs;
  issued_token text := public.new_handoff_access_token();
begin
  select * into target_handoff from public.handoffs where id = requested_handoff_id;
  if actor is null or target_handoff.id is null or target_handoff.status <> 'published'
    or not public.is_organization_admin(target_handoff.organization_id) then
    raise exception 'Published handoff unavailable' using errcode = '42501';
  end if;

  update public.handoff_publications
  set access_token = issued_token,
      status = 'active',
      revoked_by = null,
      revoked_at = null
  where handoff_id = target_handoff.id;
  if not found then
    raise exception 'Published link unavailable' using errcode = '22023';
  end if;
  return issued_token;
end;
$$;

create or replace function public.get_shared_handoff(requested_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'publicationId', publication.id,
    'organizationName', publication.organization_name,
    'organizationInstitution', publication.organization_institution,
    'roleTitle', publication.role_title,
    'roleDescription', publication.role_description,
    'servicePeriod', publication.service_period,
    'publishedAt', publication.published_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'knowledgeType', item.knowledge_type,
          'title', item.title,
          'content', item.content,
          'sortOrder', item.sort_order
        ) order by item.sort_order, item.created_at, item.id
      )
      from public.handoff_publication_items item
      where item.publication_id = publication.id
    ), '[]'::jsonb)
  )
  from public.handoff_publications publication
  where char_length(requested_token) = 64
    and requested_token ~ '^[0-9a-f]{64}$'
    and publication.access_token = requested_token
    and publication.status = 'active';
$$;

revoke all on function public.is_draft_handoff(uuid, uuid) from public;
revoke all on function public.handoff_id_from_storage_path(text) from public;
revoke all on function public.new_handoff_access_token() from public;
revoke all on function public.publish_handoff(uuid) from public;
revoke all on function public.revoke_handoff_link(uuid) from public;
revoke all on function public.replace_handoff_link(uuid) from public;
revoke all on function public.get_shared_handoff(text) from public;

grant execute on function public.is_draft_handoff(uuid, uuid) to authenticated;
grant execute on function public.handoff_id_from_storage_path(text) to authenticated;
grant execute on function public.publish_handoff(uuid) to authenticated;
grant execute on function public.revoke_handoff_link(uuid) to authenticated;
grant execute on function public.replace_handoff_link(uuid) to authenticated;
grant execute on function public.get_shared_handoff(text) to anon, authenticated;
