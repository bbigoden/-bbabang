-- 2026-11-06 현황판 뱅크·당근 수도 DB 에서 센다 (아직 운영에 적용 안 함 — 사장님 승인 후 적용)
--
-- 전에는 브라우저가 당근 게시중 광고(ad_posts)를 날짜 없이 전부 받아 담당자별로 셌다.
-- 1,000줄을 넘으면 PostgREST 가 말없이 잘라 숫자가 틀려지고, 늘어날수록 폰이 무거워진다.
-- 이제 office_board_counts 가 사람(broker_id)마다 매물장 수에 더해 담당자(ad_listings.manager)마다
-- 뱅크(등록매물 탭)·뱅크 오늘·당근(게시중)·당근 오늘 수를 같이 돌려준다.
--
-- 줄 모양: kind = 'broker'  → broker_id, total, avail, today  (예전과 같은 값)
--          kind = 'manager' → manager(빈 담당자는 null/''), bank, bank_today, daangn, daangn_today
-- 화면(src/lib/office-board.ts)은 kind 칸이 있으면 이 숫자를 쓰고, 없으면(적용 전) 예전처럼 직접 센다.
--
-- SECURITY INVOKER — 부르는 사람의 RLS 가 그대로 걸린다(직원은 원래 보던 것만).
-- 오늘 날짜는 declare 변수로(AGENTS.md — with 표로 조인하면 색인을 못 쓴다).
-- 돌려주는 칸이 바뀌어 create or replace 로는 안 된다 — 한 트랜잭션에서 지우고 다시 만든다.

begin;

drop function if exists public.office_board_counts(uuid);

create function public.office_board_counts(p_office uuid)
returns table (
  kind text, broker_id uuid, manager text,
  total integer, avail integer, today integer,
  bank integer, bank_today integer, daangn integer, daangn_today integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_start timestamptz := (now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul';
  v_end   timestamptz := ((now() at time zone 'Asia/Seoul')::date + 1)::timestamp at time zone 'Asia/Seoul';
  -- 뱅크 등록기간('26.10.30 ~26.11.29')이 오늘 시작한 것 — 사무실 화면 bankToday 와 같은 잣대
  v_bank  text        := to_char((now() at time zone 'Asia/Seoul')::date, 'YY.MM.DD');
begin
  -- 사람마다 매물장 전체·거래가능·오늘 등록 (예전 함수와 같다)
  return query
  select 'broker'::text, p.broker_id, null::text,
         count(*)::int,
         count(*) filter (where p.status = 'available')::int,
         count(*) filter (where p.created_at >= v_start)::int,
         null::int, null::int, null::int, null::int
  from broker_properties p
  where p.office_broker_id = p_office and p.deleted_at is null
  group by p.broker_id;

  -- 담당자마다 뱅크·당근
  return query
  select 'manager'::text, null::uuid, m.manager,
         null::int, null::int, null::int,
         sum(m.bank)::int, sum(m.bank_today)::int, sum(m.daangn)::int, sum(m.daangn_today)::int
  from (
    -- 광고관리 [등록매물] 탭·뱅크 화면과 같은 잣대(상태가 아니라 bank_tab)
    select l.manager, 1 as bank,
           case when l.bank_period like v_bank || '%' then 1 else 0 end as bank_today,
           0 as daangn, 0 as daangn_today
    from ad_listings l
    where l.broker_id = p_office and l.bank_tab = '등록매물'
    union all
    select l.manager, 0, 0, 1,
           case when ap.posted_at >= v_start and ap.posted_at < v_end then 1 else 0 end
    from ad_posts ap
    join ad_listings l on l.id = ap.listing_id
    where l.broker_id = p_office and ap.status = 'posted' and ap.channel = 'daangn'
  ) m
  group by m.manager;
end;
$$;

revoke execute on function public.office_board_counts(uuid) from public, anon;
grant  execute on function public.office_board_counts(uuid) to authenticated, service_role;

commit;
