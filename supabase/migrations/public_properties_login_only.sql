-- 매물 상세는 로그인해야 본다 (2026-10-29 사장님).
-- public_properties 는 '거래가능' 매물을 사무소 밖에도 보여 주는 뷰인데(상가·사무실은 호수만 지우고
-- 지번은 남긴다), 비로그인(anon)에게도 열려 있어 1,684건이 sitemap 으로 검색엔진에 나가 있었다.
-- 앱은 /property/* 를 로그인 경로로 막았고, 여기서 API 직접 조회 길도 끊는다. 멱등.
revoke select on public.public_properties from anon;
