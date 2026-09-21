insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'handoff-sources',
  'handoff-sources',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/markdown',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/webp',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/webm',
    'audio/3gpp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "members read handoff source files" on storage.objects
for select to authenticated
using (
  bucket_id = 'handoff-sources'
  and public.is_organization_member(public.organization_id_from_storage_path(name))
);

create policy "admins upload handoff source files" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'handoff-sources'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
);

create policy "admins delete handoff source files" on storage.objects
for delete to authenticated
using (
  bucket_id = 'handoff-sources'
  and public.is_organization_admin(public.organization_id_from_storage_path(name))
);
