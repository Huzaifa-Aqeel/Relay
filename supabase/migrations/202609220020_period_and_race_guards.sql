-- New invites use a single year-period spelling, preventing duplicate assignments for 2026-27 / 2026–2027.
create function public.normalize_service_period(value text)
returns text language plpgsql immutable set search_path = '' as $$
declare parts text[]; first_year integer; last_year integer;
begin
  parts := regexp_match(btrim(value), '^([0-9]{4})\s*[-–—/]\s*([0-9]{2}|[0-9]{4})$');
  if parts is null then raise exception 'Use a service period such as 2026–2027' using errcode = '22023'; end if;
  first_year := parts[1]::integer;
  last_year := case when length(parts[2]) = 2 then (first_year / 100) * 100 + parts[2]::integer else parts[2]::integer end;
  if last_year < first_year and length(parts[2]) = 2 then last_year := last_year + 100; end if;
  if last_year <> first_year + 1 then raise exception 'Service period must span consecutive years' using errcode = '22023'; end if;
  return first_year::text || '–' || last_year::text;
end;
$$;
revoke all on function public.normalize_service_period(text) from public,anon,authenticated;

-- Preserve existing spellings and IDs. Refuse ambiguous legacy periods rather than fork a workspace.
create function public.canonical_role_period(requested_role_id uuid, value text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare normalized text := public.normalize_service_period(value); existing text; candidate record; matches integer := 0;
begin
  for candidate in select service_period from public.handoffs where role_id = requested_role_id loop
    begin
      if public.normalize_service_period(candidate.service_period) = normalized then existing := candidate.service_period; matches := matches + 1; end if;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  if matches > 1 then raise exception 'Ambiguous existing service periods require review' using errcode = '22023'; end if;
  return coalesce(existing,normalized);
end;
$$;
revoke all on function public.canonical_role_period(uuid,text) from public,anon,authenticated;

do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.create_role_assignment_invite(uuid,text,boolean)'::regprocedure);
  definition := replace(definition, 'perform 1 from public.organizations where id = r.organization_id for update;',
    'perform 1 from public.organizations where id = r.organization_id for update;
     if not public.is_organization_admin(r.organization_id) then raise exception ''Owner access required'' using errcode = ''42501''; end if;
     requested_service_period := public.canonical_role_period(r.id,requested_service_period);');
  execute definition;
  definition := pg_get_functiondef('public.end_role_assignment(uuid)'::regprocedure);
  definition := replace(definition,'perform 1 from public.organizations where id = a.organization_id for update;',
    'perform 1 from public.organizations where id = a.organization_id for update;
     if not public.is_organization_admin(a.organization_id) then raise exception ''Owner access required'' using errcode = ''42501''; end if;');
  execute definition;
  definition := pg_get_functiondef('public.create_role(uuid,text,text)'::regprocedure);
  definition := replace(definition,'begin' || chr(10), 'begin' || chr(10) || '  perform 1 from public.organizations where id = requested_organization_id for update;' || chr(10));
  execute definition;
end;
$$;

-- Never allow file deletion to destroy evidence still referenced by an existing Source.
drop policy "holders delete draft files" on storage.objects;
create policy "holders clean orphan draft uploads" on storage.objects for delete to authenticated using (
  bucket_id = 'handoff-sources' and public.is_role_holder_for_handoff(public.handoff_id_from_storage_path(name))
  and public.is_draft_handoff(public.handoff_id_from_storage_path(name),public.organization_id_from_storage_path(name))
  and not exists (select 1 from public.sources s where s.storage_path = name)
);
alter table public.sources validate constraint sources_storage_workspace_check;
