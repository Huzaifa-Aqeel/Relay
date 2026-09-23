-- Restore the original one-use Google One Picker integration. Relay does not
-- retain Google access or refresh tokens between attachment selections.

drop table if exists public.google_drive_connections;
