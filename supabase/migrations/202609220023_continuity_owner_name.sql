-- An active Organization member may see the current Owner's display name for
-- ownership-transfer context. The full member list remains Owner-only.
create or replace function public.get_organization_continuity(requested_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_organization_member(requested_organization_id) then
    raise exception 'Organization unavailable' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'isOwner',public.is_organization_admin(requested_organization_id),
    'currentOwnerName',(select p.display_name
      from public.organizations o join public.profiles p on p.id = o.created_by
      where o.id = requested_organization_id),
    'members',case when public.is_organization_admin(requested_organization_id) then coalesce((
      select jsonb_agg(jsonb_build_object('userId',m.user_id,'name',p.display_name))
      from public.organization_members m join public.profiles p on p.id = m.user_id
      where m.organization_id = requested_organization_id and m.status = 'active'
    ),'[]'::jsonb) else '[]'::jsonb end,
    'roles',coalesce((select jsonb_agg(jsonb_build_object(
      'roleId',r.id,'title',r.title,
      'assignments',coalesce((select jsonb_agg(jsonb_build_object(
        'id',a.id,'userId',a.user_id,'name',p.display_name,'servicePeriod',a.service_period
      ) order by public.service_period_start(a.service_period) desc,a.accepted_at desc)
        from public.role_assignments a join public.profiles p on p.id = a.user_id
        where a.role_id = r.id and a.status = 'active'),'[]'::jsonb),
      'handoffs',coalesce((select jsonb_agg(jsonb_build_object(
        'id',h.id,'servicePeriod',h.service_period,'status',h.status,'stage',h.stage,'updatedAt',h.updated_at,
        'canMaintain',public.is_role_holder_for_handoff(h.id),
        'approvedCount',(select count(*) from public.knowledge_items k where k.handoff_id = h.id and k.status = 'approved'),
        'preflightStatus',(select status from public.preflight_runs where handoff_id = h.id order by created_at desc,id desc limit 1),
        'unresolvedCount',(select count(*) from public.preflight_findings f where f.run_id = (
          select id from public.preflight_runs where handoff_id = h.id order by created_at desc,id desc limit 1
        ) and f.status <> 'resolved'),
        'publicationStatus',(select status from public.handoff_publications where handoff_id = h.id)
      ) order by public.service_period_start(h.service_period) desc,h.updated_at desc)
        from public.handoffs h where h.role_id = r.id
          and (public.is_organization_admin(requested_organization_id) or public.can_view_role_history(r.id))
      ),'[]'::jsonb)
    ) order by r.title) from public.roles r
      where r.organization_id = requested_organization_id and r.archived_at is null),'[]'::jsonb),
    'pendingTransfer',(select jsonb_build_object('id',t.id,'toUserId',t.to_user_id,'expiresAt',t.expires_at)
      from public.organization_ownership_transfers t
      where t.organization_id = requested_organization_id and t.status = 'pending' and t.expires_at > now()
        and auth.uid() in (t.from_user_id,t.to_user_id))
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_organization_continuity(uuid) from public;
grant execute on function public.get_organization_continuity(uuid) to authenticated;
