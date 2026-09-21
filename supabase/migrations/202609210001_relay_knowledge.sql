alter table public.handoffs
add constraint handoffs_id_organization_id_key unique (id, organization_id);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('typed_text', 'voice', 'document')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  text_content text check (text_content is null or char_length(text_content) between 1 and 50000),
  storage_path text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 1 and 26214400),
  processing_status text not null default 'ready'
    check (processing_status in ('processing', 'ready', 'failed')),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  provider_reference text check (provider_reference is null or char_length(provider_reference) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (handoff_id, organization_id)
    references public.handoffs(id, organization_id) on delete cascade,
  unique (id, handoff_id, organization_id),
  check (kind <> 'typed_text' or text_content is not null),
  check (processing_status = 'failed' or failure_reason is null),
  check (storage_path is null or split_part(storage_path, '/', 1) = organization_id::text)
);

create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  handoff_id uuid not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  knowledge_type text not null check (
    knowledge_type in ('responsibility', 'deadline', 'contact', 'process', 'warning', 'resource', 'lesson')
  ),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  content text not null check (char_length(btrim(content)) between 1 and 5000),
  status text not null check (status in ('proposed', 'approved', 'rejected')),
  origin text not null check (origin in ('manual', 'ai')),
  uncertainty_note text check (uncertainty_note is null or char_length(uncertainty_note) <= 500),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (handoff_id, organization_id)
    references public.handoffs(id, organization_id) on delete cascade,
  unique (id, handoff_id, organization_id),
  check (origin <> 'manual' or status = 'approved'),
  check (origin = 'ai' or uncertainty_note is null)
);

create table public.knowledge_item_sources (
  knowledge_item_id uuid not null,
  source_id uuid not null,
  handoff_id uuid not null,
  organization_id uuid not null,
  source_excerpt text check (source_excerpt is null or char_length(source_excerpt) <= 2000),
  source_locator text check (source_locator is null or char_length(source_locator) <= 200),
  created_at timestamptz not null default now(),
  primary key (knowledge_item_id, source_id),
  foreign key (knowledge_item_id, handoff_id, organization_id)
    references public.knowledge_items(id, handoff_id, organization_id) on delete cascade,
  foreign key (source_id, handoff_id, organization_id)
    references public.sources(id, handoff_id, organization_id) on delete cascade
);

create index sources_handoff_created_idx
on public.sources(handoff_id, created_at desc);

create index knowledge_items_handoff_status_order_idx
on public.knowledge_items(handoff_id, status, sort_order, created_at);

create index knowledge_item_sources_source_idx
on public.knowledge_item_sources(source_id);

create trigger sources_set_updated_at before update on public.sources
for each row execute function public.set_updated_at();

create trigger knowledge_items_set_updated_at before update on public.knowledge_items
for each row execute function public.set_updated_at();

create or replace function public.assign_knowledge_sort_order()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.sort_order = 0 then
    select coalesce(max(item.sort_order), 0) + 1000
      into new.sort_order
      from public.knowledge_items item
      where item.handoff_id = new.handoff_id;
  end if;
  return new;
end;
$$;

create trigger knowledge_items_assign_sort_order
before insert on public.knowledge_items
for each row execute function public.assign_knowledge_sort_order();

create or replace function public.touch_parent_handoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.handoffs
  set updated_at = now()
  where id = coalesce(new.handoff_id, old.handoff_id);
  return coalesce(new, old);
end;
$$;

create trigger sources_touch_handoff
after insert or update or delete on public.sources
for each row execute function public.touch_parent_handoff();

create trigger knowledge_items_touch_handoff
after insert or update or delete on public.knowledge_items
for each row execute function public.touch_parent_handoff();

alter table public.sources enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.knowledge_item_sources enable row level security;

create policy "members read handoff sources" on public.sources
for select to authenticated
using (public.is_organization_member(organization_id));

create policy "admins create handoff sources" on public.sources
for insert to authenticated
with check (
  public.is_organization_admin(organization_id)
  and created_by = (select auth.uid())
);

create policy "admins update handoff sources" on public.sources
for update to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "admins delete handoff sources" on public.sources
for delete to authenticated
using (public.is_organization_admin(organization_id));

create policy "members read handoff knowledge" on public.knowledge_items
for select to authenticated
using (public.is_organization_member(organization_id));

create policy "admins create handoff knowledge" on public.knowledge_items
for insert to authenticated
with check (
  public.is_organization_admin(organization_id)
  and created_by = (select auth.uid())
);

create policy "admins update handoff knowledge" on public.knowledge_items
for update to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "admins delete handoff knowledge" on public.knowledge_items
for delete to authenticated
using (public.is_organization_admin(organization_id));

create policy "members read knowledge provenance" on public.knowledge_item_sources
for select to authenticated
using (public.is_organization_member(organization_id));

create policy "admins create knowledge provenance" on public.knowledge_item_sources
for insert to authenticated
with check (public.is_organization_admin(organization_id));

create policy "admins update knowledge provenance" on public.knowledge_item_sources
for update to authenticated
using (public.is_organization_admin(organization_id))
with check (public.is_organization_admin(organization_id));

create policy "admins delete knowledge provenance" on public.knowledge_item_sources
for delete to authenticated
using (public.is_organization_admin(organization_id));

create or replace function public.move_knowledge_item(requested_item_id uuid, direction text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  current_item public.knowledge_items;
  adjacent_item public.knowledge_items;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if direction not in ('up', 'down') then
    raise exception 'Direction must be up or down' using errcode = '22023';
  end if;

  select * into current_item
  from public.knowledge_items
  where id = requested_item_id and status = 'approved';

  if current_item.id is null
    or not public.is_organization_admin(current_item.organization_id) then
    raise exception 'Knowledge item unavailable' using errcode = '42501';
  end if;

  if direction = 'up' then
    select * into adjacent_item
    from public.knowledge_items
    where handoff_id = current_item.handoff_id
      and status = 'approved'
      and (sort_order, created_at, id) <
        (current_item.sort_order, current_item.created_at, current_item.id)
    order by sort_order desc, created_at desc, id desc
    limit 1;
  else
    select * into adjacent_item
    from public.knowledge_items
    where handoff_id = current_item.handoff_id
      and status = 'approved'
      and (sort_order, created_at, id) >
        (current_item.sort_order, current_item.created_at, current_item.id)
    order by sort_order, created_at, id
    limit 1;
  end if;

  if adjacent_item.id is null then
    return;
  end if;

  update public.knowledge_items
  set sort_order = case
    when id = current_item.id then adjacent_item.sort_order
    else current_item.sort_order
  end
  where id in (current_item.id, adjacent_item.id);
end;
$$;

revoke all on function public.move_knowledge_item(uuid, text) from public;
grant execute on function public.move_knowledge_item(uuid, text) to authenticated;
