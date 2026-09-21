create or replace function public.claim_public_ask_request(
  requested_token text,
  requested_free_limit integer,
  requested_pro_limit integer
)
returns table (
  publication_id uuid,
  organization_id uuid,
  handoff_id uuid,
  remaining integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  publication public.handoff_publications;
  current_count integer;
  effective_limit integer;
  caller_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role'
  );
begin
  if caller_role <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if requested_free_limit < 1 or requested_free_limit > 1000
    or requested_pro_limit < requested_free_limit or requested_pro_limit > 10000 then
    raise exception 'Invalid Ask limit' using errcode = '22023';
  end if;

  select candidate.* into publication
  from public.handoff_publications candidate
  where candidate.access_token = requested_token and candidate.status = 'active';
  if publication.id is null then
    raise exception 'Published handoff unavailable' using errcode = 'P0002';
  end if;

  effective_limit := case
    when public.has_relay_pro(publication.published_by) then requested_pro_limit
    else requested_free_limit
  end;

  perform pg_advisory_xact_lock(hashtextextended(publication.id::text || current_date::text, 0));
  select usage.request_count into current_count
  from public.ask_usage_daily usage
  where usage.publication_id = publication.id and usage.usage_date = current_date;
  current_count := coalesce(current_count, 0);
  if current_count >= effective_limit then
    raise exception 'ASK_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  insert into public.ask_usage_daily (publication_id, usage_date, owner_user_id, request_count)
  values (publication.id, current_date, publication.published_by, 1)
  on conflict on constraint ask_usage_daily_pkey do update
  set request_count = public.ask_usage_daily.request_count + 1,
      updated_at = now()
  returning request_count into current_count;

  return query select
    publication.id,
    publication.organization_id,
    publication.handoff_id,
    greatest(effective_limit - current_count, 0);
end;
$$;

revoke all on function public.claim_public_ask_request(text, integer, integer) from public;
grant execute on function public.claim_public_ask_request(text, integer, integer) to service_role;
