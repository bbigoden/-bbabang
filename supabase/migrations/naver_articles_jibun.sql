-- 매물수집: 네이버 공장/창고 매물의 지번.
--
-- 네이버 화면은 리까지만 보이지만, 상세 화면이 부르는 API(article/key)가 필지번호(PNU)를
-- 준다. 중개사가 주소를 숨긴 매물도 준다 — 그래서 숨김 여부를 같이 담아 화면에 표시한다.
-- 받는 쪽은 PC 프로그램(부소장광고/src/naver.js)이다.
alter table naver_articles
  add column if not exists pnu text,
  add column if not exists li text,
  add column if not exists address_hidden boolean,
  add column if not exists jibun_checked_at timestamptz;

-- 아직 지번을 안 물어본 공장만 빨리 고르려고.
create index if not exists naver_articles_jibun_todo
  on naver_articles (exposure_start_date desc)
  where jibun_checked_at is null and real_estate_type = 'E02';
