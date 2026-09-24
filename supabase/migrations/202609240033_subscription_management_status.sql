alter table public.organization_subscriptions
  add column will_renew boolean;

create or replace function public.get_organization_plan(requested_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  subscription public.organization_subscriptions;
begin
  if actor is null or not public.is_organization_member(requested_organization_id) then
    raise exception 'Organization unavailable' using errcode = '42501';
  end if;

  select candidate.* into subscription
  from public.organization_subscriptions candidate
  where candidate.organization_id = requested_organization_id;

  return jsonb_build_object(
    'organizationId', requested_organization_id,
    'plan', case
      when subscription.id is not null
        and subscription.status = 'active'
        and (subscription.expires_at is null or subscription.expires_at > now())
      then 'pro'
      else 'free'
    end,
    'expiresAt', subscription.expires_at,
    'willRenew', subscription.will_renew,
    'store', subscription.store,
    'isPurchaser', coalesce(subscription.purchaser_user_id = actor, false)
  );
end;
$$;

revoke all on function public.get_organization_plan(uuid) from public, anon;
grant execute on function public.get_organization_plan(uuid) to authenticated;
