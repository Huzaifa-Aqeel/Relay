-- Keep the established Organization plan response backward-compatible for
-- older strict clients. Role availability belongs to the continuity response.
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

create or replace function public.get_organization_continuity(requested_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_organization_member(requested_organization_id) then
    raise exception 'Organization unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'isOwner', public.is_organization_admin(requested_organization_id),
    'currentOwnerName', (
      select profile.display_name
      from public.organizations organization
      join public.profiles profile on profile.id = organization.created_by
      where organization.id = requested_organization_id
    ),
    'members', case when public.is_organization_admin(requested_organization_id) then coalesce((
      select jsonb_agg(jsonb_build_object('userId', member.user_id, 'name', profile.display_name))
      from public.organization_members member
      join public.profiles profile on profile.id = member.user_id
      where member.organization_id = requested_organization_id and member.status = 'active'
    ), '[]'::jsonb) else '[]'::jsonb end,
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'roleId', role.id,
        'title', role.title,
        'planAvailable', public.organization_role_is_entitled(role.organization_id, role.id),
        'assignments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', assignment.id,
            'userId', assignment.user_id,
            'name', profile.display_name,
            'servicePeriod', assignment.service_period
          ) order by public.service_period_start(assignment.service_period) desc,
            assignment.accepted_at desc)
          from public.role_assignments assignment
          join public.profiles profile on profile.id = assignment.user_id
          where assignment.role_id = role.id and assignment.status = 'active'
        ), '[]'::jsonb),
        'handoffs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', handoff.id,
            'servicePeriod', handoff.service_period,
            'status', handoff.status,
            'stage', handoff.stage,
            'updatedAt', handoff.updated_at,
            'canMaintain', public.is_role_holder_for_handoff(handoff.id),
            'approvedCount', (
              select count(*) from public.knowledge_items knowledge
              where knowledge.handoff_id = handoff.id and knowledge.status = 'approved'
            ),
            'preflightStatus', (
              select status from public.preflight_runs
              where handoff_id = handoff.id order by created_at desc, id desc limit 1
            ),
            'unresolvedCount', (
              select count(*) from public.preflight_findings finding
              where finding.run_id = (
                select id from public.preflight_runs
                where handoff_id = handoff.id order by created_at desc, id desc limit 1
              ) and finding.status <> 'resolved'
            ),
            'publicationStatus', (
              select status from public.handoff_publications where handoff_id = handoff.id
            )
          ) order by public.service_period_start(handoff.service_period) desc, handoff.updated_at desc)
          from public.handoffs handoff
          where handoff.role_id = role.id
            and (
              public.is_organization_admin(requested_organization_id)
              or public.can_view_role_history(role.id)
            )
        ), '[]'::jsonb)
      ) order by role.title)
      from public.roles role
      where role.organization_id = requested_organization_id and role.archived_at is null
    ), '[]'::jsonb),
    'pendingTransfer', (
      select jsonb_build_object(
        'id', transfer.id,
        'toUserId', transfer.to_user_id,
        'expiresAt', transfer.expires_at
      )
      from public.organization_ownership_transfers transfer
      where transfer.organization_id = requested_organization_id
        and transfer.status = 'pending'
        and transfer.expires_at > now()
        and auth.uid() in (transfer.from_user_id, transfer.to_user_id)
    )
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_organization_continuity(uuid) from public;
grant execute on function public.get_organization_continuity(uuid) to authenticated;
