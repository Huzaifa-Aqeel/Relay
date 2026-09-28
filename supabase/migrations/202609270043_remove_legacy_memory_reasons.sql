-- Organization Memory no longer stores or confirms a causal taxonomy.
-- The current path keeps only an optional evidence-backed reason statement.

drop function if exists public.confirm_memory_change_reason(uuid, text, text);
drop function if exists public.confirm_memory_change_reason_v13(uuid, text, text, uuid);

drop table if exists public.knowledge_relationships;

alter table public.role_memory_changes
  drop column if exists reason_category,
  drop column if exists reason_explanation,
  drop column if exists reason_evidence,
  drop column if exists human_confirmed,
  drop column if exists confirmed_by,
  drop column if exists confirmed_at;
