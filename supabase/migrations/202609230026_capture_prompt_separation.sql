-- A guided prompt names the user-facing Capture, not its internal text evidence.
-- Keep provenance neutral so prompt guidance cannot masquerade as source meaning.

update public.sources source
set title = 'Capture note'
where exists (
  select 1 from public.capture_sources relation
  where relation.source_id = source.id and relation.relationship = 'text'
);

create or replace function public.create_capture_draft(
  requested_organization_id uuid,
  requested_handoff_id uuid,
  requested_title text,
  requested_prompt_id text default null,
  requested_text_content text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  created_capture_id uuid := gen_random_uuid();
  created_source_id uuid;
  clean_text text := nullif(btrim(requested_text_content), '');
begin
  if actor is null
    or not public.is_role_holder_for_handoff(requested_handoff_id)
    or not public.is_draft_handoff(requested_handoff_id, requested_organization_id) then
    raise exception 'Handoff unavailable' using errcode = '42501';
  end if;
  if char_length(btrim(requested_title)) not between 1 and 160
    or (clean_text is not null and char_length(clean_text) > 50000)
    or (requested_prompt_id is not null and requested_prompt_id not in (
      'role-responsibilities', 'annual-registration-training', 'finances-budget',
      'recurring-events', 'advisor-vendor-contacts', 'account-tool-access',
      'calendars-deadlines', 'constitution-policies', 'lessons-common-mistakes'
    )) then
    raise exception 'Capture content is invalid' using errcode = '22023';
  end if;

  insert into public.captures (
    id, organization_id, handoff_id, created_by, title, text_content, prompt_id
  ) values (
    created_capture_id, requested_organization_id, requested_handoff_id, actor,
    btrim(requested_title), clean_text, requested_prompt_id
  );

  if clean_text is not null then
    insert into public.sources (
      organization_id, handoff_id, created_by, kind, title, text_content,
      processing_status, structuring_status, structured_at, structured_proposal_count
    ) values (
      requested_organization_id, requested_handoff_id, actor, 'typed_text',
      'Capture note', clean_text, 'ready', 'ready', now(), 0
    ) returning id into created_source_id;

    insert into public.capture_sources (
      capture_id, source_id, organization_id, handoff_id,
      relationship, position, created_for_capture
    ) values (
      created_capture_id, created_source_id, requested_organization_id,
      requested_handoff_id, 'text', 0, true
    );
  end if;

  return created_capture_id;
end;
$$;
