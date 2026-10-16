-- 업무일지는 '본인 것 + 대표' 만 보게 한다 (2026-10-16).
--
-- 사장님 규칙은 "직원은 다른 직원의 업무일지를 볼 수 없다" 이고 화면도 그렇게 돼 있다
-- (일지 화면에서 남의 일지를 여는 직원 선택·알림 링크 ?broker= 는 둘 다 대표일 때만 동작).
-- 그런데 DB 는 broker_diary·broker_diary_customers 를 can_view_broker_data(= 매물 열람 규칙)
-- 로 열어 두었다. 매물은 같은 사무소 동료·대표 것까지 보는 게 맞지만(can_see_others 가 꺼지지
-- 않은 한), 일지까지 같은 규칙을 타서 화면을 거치지 않고 API 를 직접 부르면 동료·대표 일지를
-- 읽을 수 있었고 정책이 ALL 이라 고치고 지우는 것도 열려 있었다.
-- 2026-10-16 확인: 직원 넷 모두 일지 121건 전부를 읽었다(남의 것 100·121·43·102건).
-- diary_customers_for_date 로 동료의 그날 고객 목록(예: 32명)도 그대로 나왔다.
--
-- 새 규칙 can_access_diary(일지 주인 broker_id):
--   관리자 / 일지 주인 본인(승인된 계정) / 그 직원이 속한 사무소의 승인된 대표(is_owner, 소속 없음)
-- 직원→동료, 직원→대표 방향만 닫힌다. 대표가 직원 일지를 보고 고치는 흐름은 그대로다.
--
-- 막혀도 되는지 확인한 흐름:
--   · 일지 화면 불러오기: 보고 있는 같은 사람의 다른 날짜를 읽어 온다(직원이면 자기 것).
--   · 섹션 구성(템플릿): broker_profiles.col_settings 에서 읽는다. 일지 표가 아니다.
--   · 퇴사자 보관(broker_diary_archive·_customers_archive): 정책이 따로라 손대지 않는다.
--   · transfer_broker_data: SECURITY DEFINER(postgres 소유, FORCE RLS 아님)라 RLS 를 안 탄다.
--   · 그 밖에 src·옆 레포(부소장광고)·다른 DB 함수·뷰·크론에 이 두 표를 쓰는 곳이 없다.
--
-- diary_customers_for_date 는 첫 검사(그 일지를 볼 수 있나)만 바꾼다. 둘째 검사(고객 주인)는
-- can_view_broker_data 그대로 둔다 — 직원 일지에는 담당자 매칭으로 대표·동료 소유 고객도
-- 연결되므로, 여기까지 좁히면 직원이 자기 일지의 고객 행을 못 보게 된다.

create or replace function public.can_access_diary(p_broker_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path = public, pg_temp
as $function$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      or exists (
        select 1
        from public.broker_profiles me
        join public.broker_profiles target on target.id = p_broker_id
        where me.user_id = auth.uid()
          and me.is_approved is true
          and (
                target.id = me.id                              -- 본인 일지
             or (me.is_owner is true
                 and me.parent_broker_id is null
                 and target.parent_broker_id = me.id)          -- 대표 → 소속 직원 일지
          )
      );
$function$;
-- RLS 정책 안에서 부르므로 authenticated 는 실행할 수 있어야 한다
revoke all on function public.can_access_diary(uuid) from public, anon;
grant execute on function public.can_access_diary(uuid) to authenticated;

-- 정책 이름·명령(ALL)·대상 역할은 그대로 두고 조건만 바꾼다
alter policy broker_diary_office on public.broker_diary
  using (public.can_access_diary(broker_id))
  with check (public.can_access_diary(broker_id));

alter policy diary_customers_office on public.broker_diary_customers
  using (public.can_access_diary(broker_id))
  with check (public.can_access_diary(broker_id));

-- SECURITY DEFINER 라 RLS 를 안 탄다 — 위 정책만 바꾸면 이 길로 동료 일지 고객 목록이 그대로 나온다
create or replace function public.diary_customers_for_date(p_broker_id uuid, p_date date)
 returns table(link_id uuid, sort_order integer, proposed_property_ids uuid[], id uuid, client_name text, contact text, received_date date, assignee text, category text, source text, status text, request text, interest text, consult_note text, custom_fields jsonb, is_deleted boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select dc.id, dc.sort_order, coalesce(dc.proposed_property_ids, '{}'::uuid[]),
         c.id, c.client_name, c.contact, c.received_date, c.assignee, c.category, c.source,
         c.status, c.request, c.interest, c.consult_note, c.custom_fields,
         (c.deleted_at is not null)
  from broker_diary_customers dc
  join broker_customers c on c.id = dc.customer_id
  where dc.broker_id = p_broker_id
    and dc.diary_date = p_date
    and public.can_access_diary(p_broker_id)       -- 그 일지를 볼 수 있나 (본인·대표·관리자)
    and public.can_view_broker_data(c.broker_id)   -- 고객 자체를 볼 권한도
  order by dc.sort_order;
$function$;
revoke all on function public.diary_customers_for_date(uuid, date) from public, anon;
grant execute on function public.diary_customers_for_date(uuid, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 되돌리기 (이 순서대로 — 정책·RPC 가 함수를 쓰고 있으면 drop 이 막힌다)
-- ─────────────────────────────────────────────────────────────────────────────
-- alter policy broker_diary_office on public.broker_diary
--   using (can_view_broker_data(broker_id)) with check (can_view_broker_data(broker_id));
-- alter policy diary_customers_office on public.broker_diary_customers
--   using (can_view_broker_data(broker_id)) with check (can_view_broker_data(broker_id));
-- create or replace function public.diary_customers_for_date(p_broker_id uuid, p_date date)
--  returns table(link_id uuid, sort_order integer, proposed_property_ids uuid[], id uuid, client_name text, contact text, received_date date, assignee text, category text, source text, status text, request text, interest text, consult_note text, custom_fields jsonb, is_deleted boolean)
--  language sql
--  stable security definer
--  set search_path to 'public'
-- as $function$
--   select dc.id, dc.sort_order, coalesce(dc.proposed_property_ids, '{}'::uuid[]),
--          c.id, c.client_name, c.contact, c.received_date, c.assignee, c.category, c.source,
--          c.status, c.request, c.interest, c.consult_note, c.custom_fields,
--          (c.deleted_at is not null)
--   from broker_diary_customers dc
--   join broker_customers c on c.id = dc.customer_id
--   where dc.broker_id = p_broker_id
--     and dc.diary_date = p_date
--     and public.can_view_broker_data(p_broker_id)
--     and public.can_view_broker_data(c.broker_id)
--   order by dc.sort_order;
-- $function$;
-- drop function if exists public.can_access_diary(uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- 덧붙임(검토에서 나온 것): 퇴사자 보관 일지 INSERT 정책에 `or can_view_broker_data(office_broker_id)`
-- 가 있어, 직원이 API 로 대표 사무소 보관 일지에 작성자·이름을 지어낸 가짜 행을 넣을 수 있었다.
-- 정상 쓰기는 대표 화면(office_broker_id = 본인)과 transfer_broker_data(DEFINER) 뿐이라
-- 고치기(UPDATE) 정책과 같은 '대표 본인 또는 관리자' 로 좁힌다.
-- ─────────────────────────────────────────────────────────────────────────────
alter policy diary_archive_insert on public.broker_diary_archive
  with check (
    exists (select 1 from public.broker_profiles
            where user_id = (select auth.uid()) and id = broker_diary_archive.office_broker_id and is_owner = true)
    or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));
alter policy diary_cust_archive_insert on public.broker_diary_customers_archive
  with check (
    exists (select 1 from public.broker_profiles
            where user_id = (select auth.uid()) and id = broker_diary_customers_archive.office_broker_id and is_owner = true)
    or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));
