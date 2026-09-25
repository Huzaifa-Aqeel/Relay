-- Replace the two fixed Organization document slots with a small owner-managed
-- list of titled PDFs. The existing private Storage bucket and member boundary
-- remain unchanged.

create table public.organization_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (split_part(storage_path, '/', 1) = organization_id::text)
);

create index organization_files_organization_created
on public.organization_files (organization_id, created_at, id);

create trigger organization_files_set_updated_at
before update on public.organization_files
for each row execute function public.set_updated_at();

insert into public.organization_files (
  organization_id, title, file_name, storage_path, size_bytes, created_by
)
select organization.id, 'Constitution', split_part(organization.constitution_path, '/', 2),
  organization.constitution_path,
  greatest(coalesce((object.metadata ->> 'size')::bigint, 1), 1),
  organization.created_by
from public.organizations organization
left join storage.objects object
  on object.bucket_id = 'organization-content' and object.name = organization.constitution_path
where organization.constitution_path is not null
on conflict (storage_path) do nothing;

insert into public.organization_files (
  organization_id, title, file_name, storage_path, size_bytes, created_by
)
select organization.id, 'Safety statement', split_part(organization.safety_statement_path, '/', 2),
  organization.safety_statement_path,
  greatest(coalesce((object.metadata ->> 'size')::bigint, 1), 1),
  organization.created_by
from public.organizations organization
left join storage.objects object
  on object.bucket_id = 'organization-content' and object.name = organization.safety_statement_path
where organization.safety_statement_path is not null
on conflict (storage_path) do nothing;

alter table public.organizations
  drop column constitution_path,
  drop column safety_statement_path;

alter table public.organization_files enable row level security;

create policy "members read organization files"
on public.organization_files
for select to authenticated
using (public.is_organization_member(organization_id));

grant select on public.organization_files to authenticated;
revoke insert, update, delete on public.organization_files from authenticated;

create function public.save_organization_home_content(
  requested_organization_id uuid,
  requested_description text,
  requested_youtube_video_url text,
  requested_added_files jsonb default '[]'::jsonb,
  requested_removed_file_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  item jsonb;
  removed_paths text[];
begin
  if actor is null or not public.is_organization_admin(requested_organization_id) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(requested_added_files, '[]'::jsonb)) <> 'array'
    or jsonb_array_length(coalesce(requested_added_files, '[]'::jsonb)) > 20 then
    raise exception 'Invalid organization files' using errcode = '22023';
  end if;

  perform 1 from public.organizations
  where id = requested_organization_id
  for update;
  if not found then
    raise exception 'Organization unavailable' using errcode = '22023';
  end if;

  update public.organizations set
    description = btrim(coalesce(requested_description, '')),
    youtube_video_url = nullif(btrim(coalesce(requested_youtube_video_url, '')), '')
  where id = requested_organization_id;

  for item in
    select value from jsonb_array_elements(coalesce(requested_added_files, '[]'::jsonb))
  loop
    insert into public.organization_files (
      organization_id, title, file_name, storage_path, mime_type, size_bytes, created_by
    ) values (
      requested_organization_id,
      btrim(item ->> 'title'),
      btrim(item ->> 'fileName'),
      btrim(item ->> 'storagePath'),
      'application/pdf',
      (item ->> 'sizeBytes')::bigint,
      actor
    );
  end loop;

  select coalesce(array_agg(file.storage_path), '{}'::text[])
  into removed_paths
  from public.organization_files file
  where file.organization_id = requested_organization_id
    and file.id = any(coalesce(requested_removed_file_ids, '{}'::uuid[]));

  delete from public.organization_files file
  where file.organization_id = requested_organization_id
    and file.id = any(coalesce(requested_removed_file_ids, '{}'::uuid[]));

  return jsonb_build_object('removedPaths', to_jsonb(removed_paths));
end;
$$;

revoke all on function public.save_organization_home_content(uuid, text, text, jsonb, uuid[])
from public, anon;
grant execute on function public.save_organization_home_content(uuid, text, text, jsonb, uuid[])
to authenticated;
