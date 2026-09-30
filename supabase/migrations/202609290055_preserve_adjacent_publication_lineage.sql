-- Preserve continuity at publication without copying predecessor knowledge
-- into a new Draft or modifying any immutable historical publication.

create function public.preserve_adjacent_publication_lineage()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  current_handoff public.handoffs;
  previous_publication_id uuid;
  matched_lineage_id uuid;
  previous_match_count integer;
  current_match_count integer;
begin
  select handoff.* into current_handoff
  from public.handoffs handoff
  where handoff.id = new.handoff_id
    and handoff.organization_id = new.organization_id;

  if current_handoff.id is null or current_handoff.period_start_year is null then
    return new;
  end if;

  -- Select the immediately previous published service period first. Title
  -- matching is intentionally limited to that one adjacent publication.
  select publication.id into previous_publication_id
  from public.handoff_publications publication
  join public.handoffs previous_handoff
    on previous_handoff.id = publication.handoff_id
   and previous_handoff.organization_id = publication.organization_id
  where publication.organization_id = current_handoff.organization_id
    and previous_handoff.role_id = current_handoff.role_id
    and previous_handoff.id <> current_handoff.id
    and publication.period_start_year < current_handoff.period_start_year
  order by publication.period_start_year desc,
    publication.period_end_year desc,
    publication.published_at desc,
    publication.id desc
  limit 1;

  if previous_publication_id is null then
    return new;
  end if;

  -- A duplicated title/category in the current approved set is not an
  -- unambiguous continuation, even if the previous publication has one match.
  select count(*)::integer into current_match_count
  from public.knowledge_items current_item
  where current_item.handoff_id = new.handoff_id
    and current_item.organization_id = new.organization_id
    and current_item.status = 'approved'
    and current_item.knowledge_type = new.knowledge_type
    and regexp_replace(lower(btrim(current_item.title)), '[^a-z0-9]+', '', 'g')
      = regexp_replace(lower(btrim(new.title)), '[^a-z0-9]+', '', 'g');

  if current_match_count <> 1 then
    return new;
  end if;

  select count(*)::integer,
    min(previous_item.knowledge_lineage_id::text)::uuid
  into previous_match_count, matched_lineage_id
  from public.handoff_publication_items previous_item
  where previous_item.publication_id = previous_publication_id
    and previous_item.knowledge_type = new.knowledge_type
    and regexp_replace(lower(btrim(previous_item.title)), '[^a-z0-9]+', '', 'g')
      = regexp_replace(lower(btrim(new.title)), '[^a-z0-9]+', '', 'g');

  if previous_match_count = 1 and matched_lineage_id is not null then
    new.knowledge_lineage_id := matched_lineage_id;
  end if;

  return new;
end;
$$;

revoke all on function public.preserve_adjacent_publication_lineage()
from public, anon, authenticated;

drop trigger if exists handoff_publication_items_preserve_adjacent_lineage
on public.handoff_publication_items;

create trigger handoff_publication_items_preserve_adjacent_lineage
before insert on public.handoff_publication_items
for each row execute function public.preserve_adjacent_publication_lineage();

comment on function public.preserve_adjacent_publication_lineage() is
  'At publication, reuses lineage only for one exact normalized-title and knowledge-type match in the immediately previous publication for the same Organization and Role.';
