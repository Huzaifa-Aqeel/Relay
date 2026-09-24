-- New Relay knowledge uses five broad categories. Keep every legacy value
-- readable so existing working knowledge and immutable publications remain
-- valid without rewriting historical snapshots.

alter table public.knowledge_items
drop constraint if exists knowledge_items_knowledge_type_check;
alter table public.knowledge_items
add constraint knowledge_items_knowledge_type_check check (knowledge_type in (
  'process', 'contact', 'rule_deadline', 'access_resource', 'warning_lesson',
  'responsibility', 'deadline', 'warning', 'resource', 'lesson'
));

alter table public.handoff_publication_items
drop constraint if exists handoff_publication_items_knowledge_type_check;
alter table public.handoff_publication_items
add constraint handoff_publication_items_knowledge_type_check check (knowledge_type in (
  'process', 'contact', 'rule_deadline', 'access_resource', 'warning_lesson',
  'responsibility', 'deadline', 'warning', 'resource', 'lesson'
));

alter table public.preflight_findings
drop constraint if exists preflight_findings_suggested_knowledge_type_check;
alter table public.preflight_findings
add constraint preflight_findings_suggested_knowledge_type_check check (
  suggested_knowledge_type is null or suggested_knowledge_type in (
    'process', 'contact', 'rule_deadline', 'access_resource', 'warning_lesson',
    'responsibility', 'deadline', 'warning', 'resource', 'lesson'
  )
);

-- Preserve the latest tested RPC bodies and authorization predicates. Replace
-- only their accepted model-output taxonomy for newly created knowledge.
do $$
declare
  signature text;
  definition text;
  updated_definition text;
  old_categories text := $pattern$'responsibility'\s*,\s*'deadline'\s*,\s*'contact'\s*,\s*'process'\s*,\s*'warning'\s*,\s*'resource'\s*,\s*'lesson'$pattern$;
  broad_categories text := $replacement$'process', 'contact', 'rule_deadline', 'access_resource', 'warning_lesson'$replacement$;
begin
  foreach signature in array array[
    'replace_source_knowledge_proposals_v13(uuid,jsonb)',
    'replace_source_version_changes(uuid,jsonb)',
    'replace_capture_knowledge_proposals(uuid,jsonb)',
    'complete_preflight_run(uuid,jsonb)',
    'resolve_preflight_finding(uuid,uuid,text,text,text)'
  ] loop
    if to_regprocedure('public.' || signature) is null then
      continue;
    end if;
    definition := pg_get_functiondef(('public.' || signature)::regprocedure);
    updated_definition := regexp_replace(definition, old_categories, broad_categories, 'g');
    if updated_definition = definition then
      raise exception 'Knowledge category validation drift: %', signature;
    end if;
    execute updated_definition;
  end loop;
end;
$$;

comment on column public.knowledge_items.knowledge_type is
  'New entries use process, contact, rule_deadline, access_resource, or warning_lesson. Legacy values remain valid for historical compatibility.';
