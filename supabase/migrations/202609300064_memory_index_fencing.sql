create function public.commit_memory_run_index(comparison uuid, token uuid, publication_ids uuid[], claims jsonb, version integer, complete boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.role_memory_comparisons;
begin
  select * into r from public.role_memory_comparisons where id=comparison for update;
  if r.run_id is distinct from token or r.run_status<>'processing' or r.lease_expires_at<now() then raise exception 'Memory run lease expired'; end if;
  if not publication_ids <@ array[r.previous_publication_id,r.current_publication_id] then raise exception 'Invalid publication scope'; end if;
  perform public.commit_publication_memory_claim_indexes(r.organization_id,r.role_id,publication_ids,r.created_by,version,claims);
  if not complete then update public.publication_memory_indexes set status='building' where publication_id=any(publication_ids); end if;
end $$;
revoke all on function public.commit_memory_run_index(uuid,uuid,uuid[],jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function public.commit_memory_run_index(uuid,uuid,uuid[],jsonb,integer,boolean) to service_role;
