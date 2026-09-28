begin;

select no_plan();

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'role_memory_changes'
      and column_name = 'reason_statement' and is_nullable = 'YES'
  ),
  'simplified Memory has an optional evidence-backed reason statement'
);

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'role_memory_changes'
     and column_name in (
       'reason_category', 'reason_explanation', 'reason_evidence',
       'human_confirmed', 'confirmed_by', 'confirmed_at'
     )),
  0::bigint,
  'the obsolete causal taxonomy and confirmation columns are removed'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'handoff_publication_items'
      and column_name = 'knowledge_lineage_id' and is_nullable = 'YES'
  ),
  'legacy/imported immutable publications may remain readable without lineage'
);

select ok(to_regclass('public.knowledge_relationships') is null,
  'obsolete lesson-to-process relationship storage is removed');
select ok(to_regprocedure('public.confirm_memory_change_reason(uuid,text,text)') is null,
  'the obsolete reason confirmation RPC is removed');
select ok(to_regprocedure('public.confirm_memory_change_reason_v13(uuid,text,text,uuid)') is null,
  'the obsolete v1.3 reason confirmation RPC is removed');

select ok(
  position(
    'item.status = ''approved''' in pg_get_functiondef('public.publish_handoff(uuid)'::regprocedure)
  ) > 0,
  'publication snapshots only approved Knowledge Items for later comparison'
);

select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'role_memory_comparisons'
     and cmd = 'SELECT' and qual like '%can_view_role_history%'),
  1::bigint,
  'comparison reads retain Role-history RLS authorization'
);

select is(
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'role_memory_changes'
     and cmd = 'SELECT' and qual like '%can_view_role_history%'),
  1::bigint,
  'change reads retain Role-history RLS authorization'
);

select * from finish();
rollback;
