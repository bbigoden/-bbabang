-- 입찰 — 주력분야.
--
-- 2022 업종 개편으로 도장·습식·방수·석공이 면허 하나(4992)로 묶여, 업종으로 거르면 석축·전석쌓기
-- 같은 석공 공사가 같이 나온다(하루 55건 중 21건). 공고마다 '주력분야'가 따로 붙어 있어 그것으로 거른다.
--
-- mfrc_flds : 공고의 주력분야 ["습식·방수공사"] (나라장터 면허제한 조회). null = 아직 안 받음, '{}' = 지정 없음
-- bid_fields: 우리 업체 주력분야. 비면 거르지 않는다.

alter table public.bid_notices
  add column if not exists mfrc_flds text[];

alter table public.broker_profiles
  add column if not exists bid_fields text[];
