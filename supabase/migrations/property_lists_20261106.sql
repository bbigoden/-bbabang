-- 매물 리스트 (2026-11-06)
-- 손님 미팅 전에 매물을 한 묶음으로 모은다. 누가 리스트를 만들어 두면 사무소 사람 누구나
-- 매물목록에서 [담기] 로 거기에 보낸다. 리스트 이름은 모두 보이고(보낼 곳을 골라야 하니),
-- 담긴 내용은 만든 사람과 대표·이사만 본다(담은 사람은 자기가 담은 것만). 이름·삭제는 만든 사람과 대표·이사만.
-- 권한 함수는 자료실(office_resources)과 같은 것을 쓴다.

create table if not exists public.property_lists (
  id uuid primary key default gen_random_uuid(),
  office_broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  created_by uuid not null references public.broker_profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists property_lists_office_idx on public.property_lists (office_broker_id, created_at desc);

create table if not exists public.property_list_items (
  list_id uuid not null references public.property_lists(id) on delete cascade,
  property_id uuid not null references public.broker_properties(id) on delete cascade,
  added_by uuid not null references public.broker_profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, property_id)
);
create index if not exists property_list_items_property_idx on public.property_list_items (property_id);

alter table public.property_lists enable row level security;
alter table public.property_list_items enable row level security;

-- 리스트: 사무소 사람 누구나 보고 만든다. 이름 바꾸기·지우기는 만든 사람 또는 대표·이사.
create policy property_lists_select on public.property_lists for select
  using (public.is_office_member(office_broker_id));
create policy property_lists_insert on public.property_lists for insert
  with check (public.office_res_can_insert(office_broker_id, created_by));
create policy property_lists_update on public.property_lists for update
  using (public.office_res_can_manage(office_broker_id, created_by))
  with check (public.office_res_can_manage(office_broker_id, created_by));
create policy property_lists_delete on public.property_lists for delete
  using (public.office_res_can_manage(office_broker_id, created_by));

-- 담긴 매물: 담기는 사무소 사람 누구나(같은 사무소 매물만).
-- 보기는 리스트 만든 사람과 대표·이사만(사장님 11-06 "리스트는 만든 사람만 봄"). 담은 사람은 자기가 담은 것만.
-- 빼기는 담은 사람, 리스트 만든 사람, 대표·이사.
create policy property_list_items_select on public.property_list_items for select
  using (exists (select 1 from public.property_lists l
                 where l.id = list_id
                   and (public.office_res_can_manage(l.office_broker_id, l.created_by)
                        or public.office_res_can_insert(l.office_broker_id, added_by))));
create policy property_list_items_insert on public.property_list_items for insert
  with check (exists (select 1 from public.property_lists l
                      join public.broker_properties p on p.id = property_id
                      where l.id = list_id
                        and p.office_broker_id = l.office_broker_id
                        and public.office_res_can_insert(l.office_broker_id, added_by)));
create policy property_list_items_delete on public.property_list_items for delete
  using (exists (select 1 from public.property_lists l
                 where l.id = list_id
                   and (public.office_res_can_manage(l.office_broker_id, l.created_by)
                        or public.office_res_can_insert(l.office_broker_id, added_by))));
