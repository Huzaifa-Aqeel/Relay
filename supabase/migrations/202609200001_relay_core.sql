create extension if not exists pgcrypto with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 100));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique check (char_length(token) between 20 and 512),
  platform text not null check (platform in ('android', 'ios')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_enabled_idx on public.push_tokens(user_id, enabled);

create trigger push_tokens_set_updated_at before update on public.push_tokens
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.push_tokens enable row level security;

create policy "users manage their profile" on public.profiles
for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "users manage their push tokens" on public.push_tokens
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.claim_push_token(requested_token text, requested_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(requested_token) not between 20 and 512 then
    raise exception 'Invalid push token' using errcode = '22023';
  end if;
  if requested_platform not in ('android', 'ios') then
    raise exception 'Invalid push platform' using errcode = '22023';
  end if;

  delete from public.push_tokens where token = requested_token;
  insert into public.push_tokens (user_id, token, platform, enabled, last_seen_at)
  values (actor, requested_token, requested_platform, true, now());
end;
$$;

revoke all on function public.claim_push_token(text, text) from public;
grant execute on function public.claim_push_token(text, text) to authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  institution text not null default '' check (char_length(institution) <= 160),
  description text not null default '' check (char_length(description) <= 800),
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (logo_path is null or split_part(logo_path, '/', 1) = id::text)
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role text not null default 'member' check (member_role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null default '' check (char_length(description) <= 800),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index roles_active_title_idx
on public.roles (organization_id, lower(btrim(title)))
where archived_at is null;

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  service_period text not null check (char_length(btrim(service_period)) between 1 and 40),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  stage text not null default 'capture' check (stage in ('capture', 'review', 'preflight', 'preview', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (role_id, organization_id) references public.roles(id, organization_id) on delete cascade,
  unique (role_id, service_period),
  check ((status = 'published') = (published_at is not null)),
  check (status <> 'published' or stage = 'published')
);

create index organizations_created_by_idx on public.organizations(created_by);
create index organization_members_user_idx on public.organization_members(user_id, organization_id);
create index roles_organization_idx on public.roles(organization_id, archived_at, created_at);
create index handoffs_role_updated_idx on public.handoffs(role_id, updated_at desc);
create index handoffs_organization_status_idx on public.handoffs(organization_id, status, updated_at desc);

create trigger organizations_set_updated_at before update on public.organizations
for each row execute function public.set_updated_at();
create trigger roles_set_updated_at before update on public.roles
for each row execute function public.set_updated_at();
create trigger handoffs_set_updated_at before update on public.handoffs
for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.roles enable row level security;
alter table public.handoffs enable row level security;

create or replace function public.is_organization_member(requested_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = requested_organization_id
      and member.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_organization_admin(requested_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = requested_organization_id
      and member.user_id = (select auth.uid())
      and member.member_role = 'admin'
  );
$$;

revoke all on function public.is_organization_member(uuid) from public;
revoke all on function public.is_organization_admin(uuid) from public;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.is_organization_admin(uuid) to authenticated;

create policy "members read organizations" on public.organizations
for select to authenticated
using (public.is_organization_member(id));

create policy "admins update organizations" on public.organizations
for update to authenticated
using (public.is_organization_admin(id))
with check (public.is_organization_admin(id));

create policy "admins delete organizations" on public.organizations
for delete to authenticated
using (public.is_organization_admin(id));

create policy "members read organization membership" on public.organization_members
for select to authenticated
using (public.is_organization_member(organization_id));

create policy "admins add organization members" on public.organization_members
for insert to authenticated
with check (public.is_organization_admin(organization_id));

create policy "admins update organization members" on public.organization_members
for update to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "admins remove organization members" on public.organization_members
for delete to authenticated
using (public.is_organization_admin(organization_id));

create policy "members read roles" on public.roles
for select to authenticated
using (public.is_organization_member(organization_id));

create policy "admins create roles" on public.roles
for insert to authenticated
with check (
  public.is_organization_admin(organization_id)
  and created_by = (select auth.uid())
);

create policy "admins update roles" on public.roles
for update to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "admins delete roles" on public.roles
for delete to authenticated
using (public.is_organization_admin(organization_id));

create policy "members read handoffs" on public.handoffs
for select to authenticated
using (public.is_organization_member(organization_id));

create policy "admins create handoffs" on public.handoffs
for insert to authenticated
with check (
  public.is_organization_admin(organization_id)
  and created_by = (select auth.uid())
);

create policy "admins update handoffs" on public.handoffs
for update to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "admins delete handoffs" on public.handoffs
for delete to authenticated
using (public.is_organization_admin(organization_id));

create or replace function public.create_organization(
  organization_name text,
  organization_institution text default '',
  organization_description text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  created_organization_id uuid;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(organization_name, ''))) not between 1 and 100 then
    raise exception 'Organization name must be between 1 and 100 characters' using errcode = '22023';
  end if;
  if char_length(coalesce(organization_institution, '')) > 160
    or char_length(coalesce(organization_description, '')) > 800 then
    raise exception 'Organization details are too long' using errcode = '22023';
  end if;

  insert into public.organizations (created_by, name, institution, description)
  values (
    actor,
    btrim(organization_name),
    btrim(coalesce(organization_institution, '')),
    btrim(coalesce(organization_description, ''))
  )
  returning id into created_organization_id;

  insert into public.organization_members (organization_id, user_id, member_role)
  values (created_organization_id, actor, 'admin');

  return created_organization_id;
end;
$$;

revoke all on function public.create_organization(text, text, text) from public;
grant execute on function public.create_organization(text, text, text) to authenticated;

create or replace function public.organization_id_from_storage_path(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return split_part(object_name, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-logos',
  'organization-logos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members read organization logos" on storage.objects
for select to authenticated
using (
  bucket_id = 'organization-logos'
  and public.is_organization_member(public.organization_id_from_storage_path(name))
);

create policy "admins upload organization logos" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'organization-logos'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
);

create policy "admins update organization logos" on storage.objects
for update to authenticated
using (
  bucket_id = 'organization-logos'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
)
with check (
  bucket_id = 'organization-logos'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
);

create policy "admins delete organization logos" on storage.objects
for delete to authenticated
using (
  bucket_id = 'organization-logos'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
);
