begin;
select set_config('request.jwt.claims','{"sub":"e0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
do $$
begin
  assert public.is_organization_admin('e0000000-0000-4000-8000-000000000002'), 'Legacy ownership lost';
  assert public.is_role_holder_for_handoff('e0000000-0000-4000-8000-000000000004'), 'Legacy role assignment missing';
  assert (select count(*) = 1 from public.role_assignments where role_id = 'e0000000-0000-4000-8000-000000000003'), 'Duplicate legacy assignments';
  assert (select text_content = 'Preserve these private notes.' from public.sources where id = 'e0000000-0000-4000-8000-000000000005'), 'Legacy source/access lost';
  assert (select content = 'Meet the advisor in September.' from public.knowledge_items where id = 'e0000000-0000-4000-8000-000000000006'), 'Legacy knowledge changed';
  assert public.get_organization_plan('e0000000-0000-4000-8000-000000000002')->>'plan' = 'pro', 'Legacy Pro association lost';
  assert public.get_shared_handoff(repeat('e',64))->'items'->0->>'content' = 'Meet the advisor in September.', 'Legacy publication changed';
end;
$$;
rollback;
