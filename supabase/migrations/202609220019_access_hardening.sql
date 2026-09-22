-- Supabase default privileges include explicit anon/authenticated grants, so PUBLIC alone is insufficient.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef and p.proname <> 'get_shared_handoff'
  loop execute format('revoke execute on function %s from public, anon', f.signature); end loop;
end;
$$;
revoke execute on function public.mark_preflight_stale_for_handoff(uuid), public.new_handoff_access_token(),
  public.organization_has_relay_pro(uuid), public.purchaser_has_active_relay_pro(uuid),
  public.replace_source_version_changes(uuid,jsonb), public.claim_public_ask_request(text,integer,integer)
from authenticated;

-- An uploaded storage path must identify this exact workspace and Source, not another Role's file.
alter table public.sources add constraint sources_storage_workspace_check check (
  storage_path is null or (split_part(storage_path,'/',1) = organization_id::text
    and split_part(storage_path,'/',2) = handoff_id::text and split_part(storage_path,'/',3) = id::text)
) not valid;

-- Preserve the publication freeze for every mutating RPC as well as direct RLS writes.
do $$
declare spec record; definition text; old_check text;
begin
  for spec in select * from (values
    ('move_knowledge_item(uuid,text)','current_item'),
    ('decide_knowledge_proposal(uuid,text)','proposal'),
    ('replace_source_knowledge_proposals_v13(uuid,jsonb)','target_source'),
    ('complete_preflight_run(uuid,jsonb)','target_run'),
    ('decide_preflight_finding(uuid,text)','target_finding'),
    ('resolve_preflight_finding(uuid,uuid,text,text,text)','target_finding')
  ) s(signature,variable) loop
    definition := pg_get_functiondef(('public.' || spec.signature)::regprocedure);
    old_check := 'public.is_role_holder_for_handoff(' || spec.variable || '.handoff_id)';
    execute replace(definition,old_check,'(' || old_check || ' and public.is_draft_handoff(' || spec.variable || '.handoff_id,' || spec.variable || '.organization_id))');
  end loop;
end;
$$;

-- Serialize verified store association writes with ownership transfer and competing purchases.
create function public.sync_verified_organization_subscription(
  requested_purchaser uuid, requested_organization uuid, requested_entitlement text,
  requested_active boolean, requested_product text, requested_store text, requested_expiry timestamptz
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare existing public.organization_subscriptions; association public.organization_subscriptions; target uuid; owner_id uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Service role required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(requested_purchaser::text,91));
  select * into existing from public.organization_subscriptions where revenuecat_app_user_id = requested_purchaser::text and entitlement_id = requested_entitlement for update;
  target := existing.organization_id;
  if requested_organization is not null then
    select created_by into owner_id from public.organizations where id = requested_organization for update;
    if owner_id is distinct from requested_purchaser or not exists (select 1 from public.organization_members where organization_id = requested_organization and user_id = requested_purchaser and status = 'active') then
      raise exception 'Only the current Owner can attach a purchase' using errcode = '42501'; end if;
    if requested_active then
      if target is not null and target <> requested_organization then raise exception 'Purchase already associated with another organization' using errcode = '22023'; end if;
      select * into association from public.organization_subscriptions where organization_id = requested_organization for update;
      if association.id is not null and association.id is distinct from existing.id then
        if association.status = 'active' and (association.expires_at is null or association.expires_at > now()) then
          raise exception 'Organization already associated with an active purchase' using errcode = '22023'; end if;
        update public.organization_subscriptions set organization_id = null where id = association.id;
      end if;
      target := requested_organization;
    end if;
  end if;
  insert into public.organization_subscriptions(organization_id,purchaser_user_id,revenuecat_app_user_id,entitlement_id,status,product_identifier,store,expires_at,revenuecat_checked_at)
  values(target,requested_purchaser,requested_purchaser::text,requested_entitlement,case when requested_active then 'active' else 'inactive' end,requested_product,requested_store,requested_expiry,now())
  on conflict (revenuecat_app_user_id,entitlement_id) do update set status = excluded.status,organization_id = excluded.organization_id,
    product_identifier = excluded.product_identifier,store = excluded.store,expires_at = excluded.expires_at,revenuecat_checked_at = excluded.revenuecat_checked_at;
  return target;
end;
$$;
revoke all on function public.sync_verified_organization_subscription(uuid,uuid,text,boolean,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_verified_organization_subscription(uuid,uuid,text,boolean,text,text,timestamptz) to service_role;
