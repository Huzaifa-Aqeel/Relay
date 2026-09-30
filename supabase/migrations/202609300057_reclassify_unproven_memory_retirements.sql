-- Existing comparison output is derived and may be safely regenerated. A
-- previous-only item never proved deliberate retirement, so make old results
-- truthful without touching either immutable publication snapshot.

update public.role_memory_changes
set change_type = 'not_carried_forward',
    summary = 'This approved knowledge appeared previously but was not documented in the current published handoff.',
    reason_statement = null,
    reason_provenance = '[]'::jsonb
where change_type = 'retired'
  and current_publication_item_id is null;
