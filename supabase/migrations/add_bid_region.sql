-- 입찰 — 참가가능지역.
--
-- 지역제한 공고는 정해진 시·도(또는 시·군)에 본사가 있는 업체만 들어갈 수 있다.
-- 사장님 업체는 충청남도 아산시라, 그 밖으로 묶인 공고는 보여 봐야 넣을 수 없다.
--
-- prtcpt_rgns: 나라장터 '참가가능지역' 목록. null = 아직 안 받음, '{}' = 제한 없음(전국).
-- bid_region : 우리 업체 소재지 "충청남도 아산시". 비면 거르지 않는다.

alter table public.bid_notices
  add column if not exists prtcpt_rgns text[];

alter table public.broker_profiles
  add column if not exists bid_region text;
