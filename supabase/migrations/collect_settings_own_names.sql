-- 우리 사무소 매물을 가려내는 이름.
--
-- 네이버는 중개사무소 상호가 그대로 찍혀 broker_profiles.office_name 과 맞는다.
-- 그런데 당근은 상호가 아니라 **닉네임**이 찍힌다 — 같은 사무소가
-- '플러스불당공인중개사사무소' 로 등록해 두고 매물에는 '불당부동산은용소장' 으로
-- 나온다. 그래서 상호만 보던 '우리 사무소 매물 빼기' 가 당근에서는 한 건도
-- 못 걸렀다(0/3,103).
--
-- 소스마다 다르고 직원마다 다를 수 있으니 목록으로 받는다.
-- 비어 있으면 예전처럼 office_name 을 쓴다.
alter table collect_settings add column if not exists own_names text[];

comment on column collect_settings.own_names is
  '이 소스에서 우리 사무소 매물에 찍히는 이름들. 비어 있으면 broker_profiles.office_name 을 쓴다.';
