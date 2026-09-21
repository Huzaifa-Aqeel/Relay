-- Preserve the P0 six-field proposal RPC contract while v1.3 callers send explicit actions.
alter function public.replace_source_knowledge_proposals(uuid, jsonb)
rename to replace_source_knowledge_proposals_v13;

revoke all on function public.replace_source_knowledge_proposals_v13(uuid, jsonb) from public, authenticated;

create function public.replace_source_knowledge_proposals(
  requested_source_id uuid,
  requested_proposals jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized jsonb;
begin
  if jsonb_typeof(requested_proposals) <> 'array' then
    raise exception 'Proposal output is invalid' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(
    case
      when value ? 'proposal_action' and value ? 'target_knowledge_item_id' then value
      else value || jsonb_build_object(
        'proposal_action', 'create',
        'target_knowledge_item_id', null
      )
    end
  ), '[]'::jsonb)
  into normalized
  from jsonb_array_elements(requested_proposals);

  return public.replace_source_knowledge_proposals_v13(requested_source_id, normalized);
end;
$$;

revoke all on function public.replace_source_knowledge_proposals(uuid, jsonb) from public;
grant execute on function public.replace_source_knowledge_proposals(uuid, jsonb) to authenticated;
