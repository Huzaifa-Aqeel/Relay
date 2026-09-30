-- Make Organization Memory truthful about absence and commit comparisons
-- atomically so a failed rerun cannot destroy the last ready result.

alter table public.role_memory_changes
  drop constraint if exists role_memory_changes_change_type_check;

alter table public.role_memory_changes
  add constraint role_memory_changes_change_type_check check (
    change_type in ('added', 'changed', 'not_carried_forward', 'retired', 'resolved')
  );

alter table public.role_memory_changes
  add column reason_provenance jsonb not null default '[]'::jsonb
  check (jsonb_typeof(reason_provenance) = 'array');

comment on column public.role_memory_changes.reason_provenance is
  'Safe published provenance for an optional explicit reason. Before and after provenance remain in their respective immutable snapshots.';

create or replace function public.commit_role_memory_comparison(
  requested_organization_id uuid,
  requested_role_id uuid,
  requested_previous_publication_id uuid,
  requested_current_publication_id uuid,
  requested_previous_service_period text,
  requested_current_service_period text,
  requested_created_by uuid,
  requested_changes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_comparison_id uuid;
  publication_count integer;
  change jsonb;
  before_snapshot jsonb;
  after_snapshot jsonb;
begin
  if requested_previous_publication_id = requested_current_publication_id
    or jsonb_typeof(requested_changes) <> 'array'
    or jsonb_array_length(requested_changes) > 100 then
    raise exception 'Invalid Organization Memory comparison' using errcode = '22023';
  end if;

  select count(*)::integer into publication_count
  from public.handoff_publications publication
  join public.handoffs handoff
    on handoff.id = publication.handoff_id
   and handoff.organization_id = publication.organization_id
  where publication.id in (
      requested_previous_publication_id,
      requested_current_publication_id
    )
    and publication.organization_id = requested_organization_id
    and handoff.role_id = requested_role_id;

  if publication_count <> 2 then
    raise exception 'Organization Memory publication scope is invalid' using errcode = '22023';
  end if;

  insert into public.role_memory_comparisons (
    organization_id, role_id,
    previous_publication_id, current_publication_id,
    previous_service_period, current_service_period,
    status, failure_reason, material_change_count,
    created_by, completed_at
  ) values (
    requested_organization_id, requested_role_id,
    requested_previous_publication_id, requested_current_publication_id,
    btrim(requested_previous_service_period), btrim(requested_current_service_period),
    'ready', null, jsonb_array_length(requested_changes),
    requested_created_by, now()
  )
  on conflict (role_id, previous_publication_id, current_publication_id)
  do update set
    previous_service_period = excluded.previous_service_period,
    current_service_period = excluded.current_service_period,
    status = 'ready',
    failure_reason = null,
    material_change_count = excluded.material_change_count,
    created_by = excluded.created_by,
    completed_at = excluded.completed_at
  returning id into target_comparison_id;

  delete from public.role_memory_changes
  where comparison_id = target_comparison_id;

  for change in select value from jsonb_array_elements(requested_changes)
  loop
    if jsonb_typeof(change) <> 'object' then
      raise exception 'Invalid Organization Memory change' using errcode = '22023';
    end if;

    before_snapshot := case
      when jsonb_typeof(change->'beforeSnapshot') = 'object' then change->'beforeSnapshot'
      else null
    end;
    after_snapshot := case
      when jsonb_typeof(change->'afterSnapshot') = 'object' then change->'afterSnapshot'
      else null
    end;

    insert into public.role_memory_changes (
      comparison_id, organization_id, role_id,
      change_type, title, summary,
      previous_publication_item_id, current_publication_item_id,
      match_basis, reason_statement,
      before_snapshot, after_snapshot,
      supporting_provenance, reason_provenance
    ) values (
      target_comparison_id, requested_organization_id, requested_role_id,
      change->>'changeType', btrim(change->>'title'), btrim(change->>'summary'),
      nullif(change->>'previousPublicationItemId', '')::uuid,
      nullif(change->>'currentPublicationItemId', '')::uuid,
      change->>'matchBasis', nullif(btrim(change->>'reasonStatement'), ''),
      before_snapshot, after_snapshot,
      coalesce(change->'supportingProvenance', '[]'::jsonb),
      coalesce(change->'reasonProvenance', '[]'::jsonb)
    );
  end loop;

  return target_comparison_id;
end;
$$;

revoke all on function public.commit_role_memory_comparison(
  uuid, uuid, uuid, uuid, text, text, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.commit_role_memory_comparison(
  uuid, uuid, uuid, uuid, text, text, uuid, jsonb
) to service_role;

comment on function public.commit_role_memory_comparison(
  uuid, uuid, uuid, uuid, text, text, uuid, jsonb
) is 'Atomically replaces one adjacent Role comparison only after the complete grounded result is ready.';
