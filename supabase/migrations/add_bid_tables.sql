-- 입찰 — 도장·방수 공사 입찰공고 수집과 낙찰가 분석.
--
-- 사장님이 따로 운영하는 전문건설업(도장·습식·방수·석공사업) 일이다. 중개업과 섞이지
-- 않게 사무소 하나에만 켠다(broker_profiles.bid_enabled). 다른 사무소엔 메뉴도 안 보인다.
--
-- 원본은 조달청 나라장터 공공데이터 API 다. 유료 입찰정보 사이트들이 쓰는 것과 같은
-- 데이터라, 그쪽 화면을 긁지 않고 여기서 직접 받는다.
--
-- 쓰기는 서버(service_role)만 한다 — 수집은 Vercel cron 과 [가져오기] 라우트가 맡는다.
-- 나라장터 시각은 전부 한국시간 문자열("2026-10-27 08:04:20")로 오므로 +09:00 을 붙여 넣는다.

alter table public.broker_profiles
  add column if not exists bid_enabled boolean not null default false;

-- ── 1. 입찰공고 ─────────────────────────────────────────────
-- 공고 목록 + 기초금액 조회를 한 줄에 합친다. 기초금액은 공고 뒤에 따로 공개되므로
-- 처음엔 비어 있다가 나중에 채워진다.
create table if not exists public.bid_notices (
  bid_ntce_no      text not null,
  bid_ntce_ord     text not null,
  name             text not null,
  ntce_instt_nm    text,
  dminstt_cd       text,
  dminstt_nm       text,
  cntrct_mthd      text,          -- 제한경쟁·수의계약 …
  sucsfbid_mthd    text,          -- 낙찰방법 원문
  lwlt_rate        numeric,       -- 낙찰하한율 %
  presmpt_prce     bigint,        -- 추정가격
  bdgt_amt         bigint,        -- 배정예산
  site_region      text,          -- 공사현장 지역 "서울특별시 강동구"
  ntce_at          timestamptz,
  bid_close_at     timestamptz,
  openg_at         timestamptz,
  detail_url       text,
  -- 기초금액 조회
  bssamt           bigint,
  rng_bgn          numeric,       -- 예가 범위 -3
  rng_end          numeric,       -- 예가 범위 +3
  -- A값: 국민연금·건강보험·노인장기요양·퇴직공제·안전관리비·품질관리비 합.
  -- 이 금액은 낙찰하한율을 곱하지 않고 그대로 더한다 — 하한선 = (예정가격-A)×하한율+A
  a_amount         bigint,
  bssamt_open_at   timestamptz,
  first_seen_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (bid_ntce_no, bid_ntce_ord)
);

create index if not exists bid_notices_close_idx on public.bid_notices (bid_close_at desc);
create index if not exists bid_notices_ntce_idx on public.bid_notices (ntce_at desc);
create index if not exists bid_notices_dminstt_idx on public.bid_notices (dminstt_cd);

-- ── 2. 낙찰결과 ─────────────────────────────────────────────
-- 낙찰 목록 + 예비가격 상세(15개 예가·추첨)를 한 줄에. 분석의 재료다.
create table if not exists public.bid_results (
  bid_ntce_no      text not null,
  bid_ntce_ord     text not null,
  rbid_no          text not null default '000',
  name             text not null,
  dminstt_cd       text,
  dminstt_nm       text,
  openg_at         timestamptz,
  prtcpt_cnum      integer,       -- 참여업체 수
  winner_nm        text,
  winner_bizno     text,
  sucsf_amt        bigint,        -- 낙찰금액
  sucsf_rate       numeric,       -- 낙찰률 (예정가격 대비 %)
  -- 예비가격 상세
  bssamt           bigint,        -- 기초금액
  plnprc           bigint,        -- 예정가격 (추첨된 4개 평균)
  -- [{ sno, price, drawn, picks }] — picks 는 그 번호를 고른 업체 수
  prices           jsonb,
  -- 공고에서 옮겨 둔다. 공고가 없으면 상세를 받을 때 찾아 채운다
  lwlt_rate        numeric,
  a_amount         bigint,
  -- 분석용으로 미리 재 둔 값 (src/lib/bid-analysis.ts normalize).
  -- sajeong = (예정가격-A)/(기초금액-A), win_y = 하한선을 넘은 가장 낮은 업체의 투찰값.
  -- 이 둘만 있으면 '그 공고에 y 로 넣었으면 땄나'를 업체 목록 없이 바로 센다.
  sajeong          numeric,
  win_y            numeric,       -- null = 하한선을 넘은 업체가 없었다
  rng              numeric,       -- 예가 범위 2 또는 3 (±%). 범위가 다르면 사정률 퍼짐이 달라 따로 본다
  detail_at        timestamptz,   -- 예가 상세를 받은 시각 (null = 아직)
  bids_at          timestamptz,   -- 업체별 투찰을 받은 시각 (null = 아직)
  first_seen_at    timestamptz not null default now(),
  primary key (bid_ntce_no, bid_ntce_ord, rbid_no)
);

create index if not exists bid_results_openg_idx on public.bid_results (openg_at desc);
create index if not exists bid_results_dminstt_idx on public.bid_results (dminstt_cd);
create index if not exists bid_results_detail_todo_idx on public.bid_results (openg_at desc) where detail_at is null;
create index if not exists bid_results_bids_todo_idx on public.bid_results (openg_at desc) where bids_at is null;

-- ── 3. 업체별 투찰 ──────────────────────────────────────────
-- 경쟁사가 어디에 몰려 넣는지가 추천 투찰가의 핵심이다.
create table if not exists public.bid_result_bids (
  bid_ntce_no      text not null,
  bid_ntce_ord     text not null,
  rbid_no          text not null default '000',
  rank             integer not null,
  bizno            text not null,
  company_nm       text,
  amount           bigint,
  rate             numeric,       -- 투찰률 (예정가격 대비 %)
  picks            smallint[],    -- 그 업체가 고른 예가 번호 2개
  rmrk             text,
  primary key (bid_ntce_no, bid_ntce_ord, rbid_no, rank, bizno)
);

create index if not exists bid_result_bids_bizno_idx on public.bid_result_bids (bizno);

-- ── 4. 수집 상태 ────────────────────────────────────────────
-- 과거 데이터를 어디까지 채웠는지, 오늘 API 를 몇 번 불렀는지(하루 1,000건 한도).
create table if not exists public.bid_sync (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ── RLS: bid_enabled 인 사무소의 대표만 읽는다. 쓰기 정책은 두지 않는다(service_role 전용).
alter table public.bid_notices enable row level security;
alter table public.bid_results enable row level security;
alter table public.bid_result_bids enable row level security;
alter table public.bid_sync enable row level security;

create or replace function public.can_view_bids()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.broker_profiles bp
    where bp.user_id = (select auth.uid())
      and bp.bid_enabled
      and bp.is_owner is not false
  )
$$;

drop policy if exists bid_notices_select on public.bid_notices;
create policy bid_notices_select on public.bid_notices
  for select to authenticated using ((select public.can_view_bids()));

drop policy if exists bid_results_select on public.bid_results;
create policy bid_results_select on public.bid_results
  for select to authenticated using ((select public.can_view_bids()));

drop policy if exists bid_result_bids_select on public.bid_result_bids;
create policy bid_result_bids_select on public.bid_result_bids
  for select to authenticated using ((select public.can_view_bids()));

drop policy if exists bid_sync_select on public.bid_sync;
create policy bid_sync_select on public.bid_sync
  for select to authenticated using ((select public.can_view_bids()));
