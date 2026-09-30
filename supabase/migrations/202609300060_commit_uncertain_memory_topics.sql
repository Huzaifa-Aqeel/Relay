-- Migration 059 made uncertain a valid stored suppression state. Keep the
-- already-deployed atomic commit RPC in sync so it can write that marker.

do $$
declare
  definition text;
  before_list constant text := $before$'active', 'pending', 'resolved', 'retired'$before$;
  after_list constant text := $after$'active', 'pending', 'resolved', 'retired', 'uncertain'$after$;
begin
  definition := pg_get_functiondef(
    'public.commit_publication_memory_claim_indexes(uuid,uuid,uuid[],uuid,integer,jsonb)'::regprocedure
  );

  if position(after_list in definition) > 0 then
    return;
  end if;
  if position(before_list in definition) = 0 then
    raise exception 'Publication Memory commit function has an unexpected definition';
  end if;

  execute replace(definition, before_list, after_list);
end;
$$;
