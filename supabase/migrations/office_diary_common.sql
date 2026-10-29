-- 업무일지 3번 '광고현황' 은 사람마다가 아니라 사무실 공통이다 (2026-10-29 사장님).
--
-- 사장님이 매일 일지에 손으로 적던 '매물장 259(거래가능 238) / 부동산뱅크 202 / 당근 178' 을
-- 가상사무실 현황판이 대신 센다. 일지 3번 칸은 그 숫자 + 모두가 같이 쓰는 메모 한 칸이 된다.
--
-- 사무실·날짜마다 한 줄:
--   ad_board    — 그날 현황판 숫자(사람별 줄 + 사무실 전체). 오늘 일지를 열 때마다 새로 찍는다.
--                 지난 날짜는 마지막으로 찍힌 숫자가 남는다.
--   ad_memo     — 공통 메모. 누가 써도 모든 직원 일지에 같은 글.
--
-- broker_diary 는 '본인 + 대표' 만 열리므로(can_access_diary) 거기에 둘 수 없다.
-- 이 표는 사무실 사람이면 누구나 읽고 쓴다(is_office_member). 지우기는 없다.
create table if not exists public.office_diary_common (
  office_id   uuid not null references public.broker_profiles(id) on delete cascade,
  date        date not null,
  ad_board    jsonb,
  ad_board_at timestamptz,
  ad_memo     text,
  memo_by     uuid references public.broker_profiles(id) on delete set null,
  memo_at     timestamptz,
  primary key (office_id, date)
);

alter table public.office_diary_common enable row level security;

drop policy if exists office_diary_common_select on public.office_diary_common;
create policy office_diary_common_select on public.office_diary_common
  for select to authenticated using (public.is_office_member(office_id));

drop policy if exists office_diary_common_insert on public.office_diary_common;
create policy office_diary_common_insert on public.office_diary_common
  for insert to authenticated with check (public.is_office_member(office_id));

drop policy if exists office_diary_common_update on public.office_diary_common;
create policy office_diary_common_update on public.office_diary_common
  for update to authenticated using (public.is_office_member(office_id))
  with check (public.is_office_member(office_id));
