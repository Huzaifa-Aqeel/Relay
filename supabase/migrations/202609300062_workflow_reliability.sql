alter table public.role_memory_comparisons
  add column pipeline_version integer not null default 0,
  add column run_id uuid,
  add column run_status text not null default 'idle' check (run_status in ('idle','processing','failed')),
  add column lease_expires_at timestamptz,
  add column covered_item_count integer not null default 0,
  add column total_item_count integer not null default 0,
  add column omitted_change_count integer not null default 0;

create function public.claim_memory_run(org uuid, role uuid, previous_id uuid, current_id uuid, previous_period text, current_period text, actor uuid, version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.role_memory_comparisons; token uuid := gen_random_uuid();
begin
  perform pg_advisory_xact_lock(hashtextextended(role::text, 0));
  if not exists (select 1 from public.handoff_publications p join public.handoffs h on h.id=p.handoff_id where p.id=previous_id and p.organization_id=org and h.role_id=role)
    or not exists (select 1 from public.handoff_publications p join public.handoffs h on h.id=p.handoff_id where p.id=current_id and p.organization_id=org and h.role_id=role)
    or previous_id=current_id then raise exception 'Invalid publication scope'; end if;
  select * into r from public.role_memory_comparisons where role_id=role and run_status='processing' and lease_expires_at>now() limit 1;
  if found then return jsonb_build_object('comparisonId',r.id,'joined',true); end if;
  select * into r from public.role_memory_comparisons where role_id=role and previous_publication_id=previous_id and current_publication_id=current_id for update;
  if found and r.status='ready' and r.pipeline_version=version and r.covered_item_count=r.total_item_count then
    return jsonb_build_object('comparisonId',r.id,'ready',true);
  end if;
  insert into public.role_memory_comparisons(organization_id,role_id,previous_publication_id,current_publication_id,previous_service_period,current_service_period,status,created_by,run_id,run_status,lease_expires_at)
  values(org,role,previous_id,current_id,previous_period,current_period,'processing',actor,token,'processing',now()+interval '145 seconds')
  on conflict(role_id,previous_publication_id,current_publication_id) do update set run_id=token,run_status='processing',lease_expires_at=now()+interval '145 seconds',failure_reason=null
  returning * into r;
  return jsonb_build_object('comparisonId',r.id,'runId',token);
end $$;
revoke all on function public.claim_memory_run(uuid,uuid,uuid,uuid,text,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_memory_run(uuid,uuid,uuid,uuid,text,text,uuid,integer) to service_role;

create function public.finish_memory_run(comparison uuid, token uuid, changes jsonb, covered integer, total integer, omitted integer, version integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.role_memory_comparisons;
begin
  select * into r from public.role_memory_comparisons where id=comparison for update;
  if r.run_id is distinct from token or r.run_status<>'processing' or r.lease_expires_at<now() then raise exception 'Memory run lease expired'; end if;
  if covered<0 or covered>total or omitted<0 then raise exception 'Invalid coverage'; end if;
  perform public.commit_role_memory_comparison(r.organization_id,r.role_id,r.previous_publication_id,r.current_publication_id,r.previous_service_period,r.current_service_period,r.created_by,changes);
  update public.role_memory_comparisons set run_status='idle',lease_expires_at=null,pipeline_version=version,covered_item_count=covered,total_item_count=total,omitted_change_count=omitted where id=comparison;
  return comparison;
end $$;
revoke all on function public.finish_memory_run(uuid,uuid,jsonb,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.finish_memory_run(uuid,uuid,jsonb,integer,integer,integer,integer) to service_role;

-- Batching replaces the old per-request 200-claim storage ceiling.
do $$ declare definition text; begin
  definition := pg_get_functiondef('public.commit_publication_memory_claim_indexes(uuid,uuid,uuid[],uuid,integer,jsonb)'::regprocedure);
  execute replace(definition,'or jsonb_array_length(requested_claims) > 200','or jsonb_array_length(requested_claims) > 10000');
end $$;
