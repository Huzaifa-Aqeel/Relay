-- New-period Handoffs are independent empty Drafts. Do not create an
-- automatic predecessor relationship while publishing their knowledge.

drop trigger if exists handoff_publication_items_reuse_previous_lineage
on public.handoff_publication_items;

drop function if exists public.reuse_previous_publication_lineage();
