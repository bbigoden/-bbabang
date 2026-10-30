-- 입찰 — 지역의무공동도급.
--
-- 참가는 '전국'이어도 지역의무공동도급이 걸리면 현장 지역 업체와 정한 비율 이상 공동도급해야만 들어간다
-- (하양초 교사동 외벽개선 R26BK01792828: 경북 49%). 참가가능지역만 보면 들어갈 수 있는 공고처럼 보였다.
--
-- rgn_duty_rt  : 지역 업체 의무 비율(%). 0 = 의무 없음, null = 아직 안 받음
-- rgn_duty_rgns: 의무 지역 (나라장터 jntcontrctDutyRgnNm1~3). 비면 공사 현장 시도

alter table public.bid_notices
  add column if not exists rgn_duty_rt numeric,
  add column if not exists rgn_duty_rgns text[];
