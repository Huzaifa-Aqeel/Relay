-- Organization Memory reports only operational changes that are present in
-- the current approved handoff. Previous-only knowledge remains preserved in
-- immutable publication history but is omitted from comparison results.

delete from public.role_memory_changes
where change_type = 'not_carried_forward';

update public.role_memory_comparisons comparison
set material_change_count = (
  select count(*)::integer
  from public.role_memory_changes change
  where change.comparison_id = comparison.id
)
where comparison.status = 'ready';

alter table public.role_memory_changes
  drop constraint if exists role_memory_changes_change_type_check;

alter table public.role_memory_changes
  add constraint role_memory_changes_change_type_check check (
    change_type in ('added', 'changed', 'retired', 'resolved')
  );

comment on column public.role_memory_changes.change_type is
  'User-facing Organization Memory result: added, changed, retired, or resolved. Previous-only knowledge is omitted and remains available in immutable handoff history.';
