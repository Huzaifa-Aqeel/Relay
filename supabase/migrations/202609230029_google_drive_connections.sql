-- Persist a user's Google Drive grant without exposing provider credentials to
-- the Relay client. Refresh tokens are encrypted by the Edge Function before
-- they reach this table; only the service role can access the rows.

create table public.google_drive_connections (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  refresh_token_ciphertext text not null,
  refresh_token_iv text not null,
  scope text not null default 'https://www.googleapis.com/auth/drive.file'
    check (scope = 'https://www.googleapis.com/auth/drive.file'),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger google_drive_connections_set_updated_at
before update on public.google_drive_connections
for each row execute function public.set_updated_at();

alter table public.google_drive_connections enable row level security;

revoke all on table public.google_drive_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.google_drive_connections to service_role;

comment on table public.google_drive_connections is
  'Server-only encrypted Google Drive refresh grants. No client role has table access.';

