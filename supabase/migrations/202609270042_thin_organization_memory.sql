-- Thin Organization Memory down to a lineage-first Added/Changed/Retired view.
-- Migration 043 removes the historical taxonomy, confirmation functions, and
-- relationship rows after this transition migration installs the replacement.

alter table public.role_memory_changes
  add column reason_statement text check (
    reason_statement is null
    or char_length(btrim(reason_statement)) between 1 and 300
  );

-- Current publications always snapshot lineage. Nullable publication lineage
-- exists only so genuinely old/imported snapshots can remain readable and use
-- the conservative fallback without rewriting immutable history.
alter table public.handoff_publication_items
  alter column knowledge_lineage_id drop not null;

-- These temporary defaults permit the new comparison path to operate between
-- migrations 042 and 043 without participating in the old causal taxonomy.
alter table public.role_memory_changes
  alter column reason_category set default 'unknown',
  alter column reason_explanation set default 'Reason not documented.';

comment on column public.role_memory_changes.reason_statement is
  'Optional evidence-backed explanation for the simplified Organization Memory UI. Null means the reason is not documented.';
comment on column public.role_memory_changes.reason_category is
  'Transitional only; removed by migration 043.';
comment on column public.role_memory_changes.reason_explanation is
  'Transitional only; removed by migration 043.';
comment on column public.role_memory_changes.match_basis is
  'Internal compatibility metadata. same_lineage is normal; strong_semantic is restricted to legacy snapshots with missing lineage and is never shown in the UI.';
comment on column public.handoff_publication_items.knowledge_lineage_id is
  'Preserved carry-forward lineage for normal comparisons. Null is allowed only for legacy/imported publication compatibility.';
comment on table public.knowledge_relationships is
  'Obsolete lesson-to-practice relationship storage; removed by migration 043.';
