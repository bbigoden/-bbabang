-- 당근 층수. 2026-09 개편 뒤로 목록에 floor·topFloor 가 온다("1.0" · "5").
-- 네이버와 같은 모양("1/5" = 해당층/전체층)으로 담아, 매물수집 화면의 층 조건이
-- 두 곳에서 똑같이 걸리게 한다.
alter table daangn_articles add column if not exists floor_info text;

comment on column daangn_articles.floor_info is
  '층. "1/5" = 해당층/전체층, 전체층을 모르면 "1". 네이버 naver_articles.floor_info 와 같은 모양.';
