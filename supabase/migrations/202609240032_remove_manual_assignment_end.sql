-- Role assignments end only through accepted replacement/succession invites.
-- Remove the obsolete standalone Owner action so assignments cannot be ended
-- outside the atomic successor-transfer workflow.

drop function if exists public.end_role_assignment(uuid);
