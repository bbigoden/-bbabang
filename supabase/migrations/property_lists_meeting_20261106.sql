-- 미팅 리스트 개편 (2026-11-06)
-- 리스트가 이름과 매물뿐이라 '언제, 누구랑' 이 없었다. 미팅 날짜·시간, 손님(고객목록 연결), 상태,
-- 담긴 매물의 보여 줄 순서와 한 줄 메모를 더한다. 순서·메모 고치기는 리스트 만든 사람과 대표·이사만.

alter table public.property_lists
  add column if not exists meeting_at timestamptz,
  add column if not exists customer_id uuid references public.broker_customers(id) on delete set null,
  add column if not exists status text not null default 'ready' check (status in ('ready', 'done'));
create index if not exists property_lists_customer_idx on public.property_lists (customer_id);

alter table public.property_list_items
  add column if not exists sort_order integer not null default 0,
  add column if not exists note text check (note is null or char_length(note) <= 200);

-- 이미 담긴 매물은 담은 순서대로 번호를 매긴다
update public.property_list_items i set sort_order = r.n
from (select list_id, property_id, row_number() over (partition by list_id order by added_at) as n
      from public.property_list_items) r
where r.list_id = i.list_id and r.property_id = i.property_id;

drop policy if exists property_list_items_update on public.property_list_items;
create policy property_list_items_update on public.property_list_items for update
  using (exists (select 1 from public.property_lists l
                 where l.id = list_id and public.office_res_can_manage(l.office_broker_id, l.created_by)))
  with check (exists (select 1 from public.property_lists l
                      where l.id = list_id and public.office_res_can_manage(l.office_broker_id, l.created_by)));
