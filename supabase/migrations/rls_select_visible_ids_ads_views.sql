-- 광고·수집 표의 읽기 정책이 행마다 can_view_broker_property() 를 불렀다.
-- 직원 계정으로 광고 목록(608행 + ad_posts)이 83ms → 7ms, 조회 기록은 쌓일수록 느려졌다.
-- broker_properties·broker_customers 와 같은 꼴로 바꾼다: 볼 수 있는 broker id 목록을
-- 한 번만 구해(my_visible_broker_ids) 그 안에 드는지만 본다.
--
-- 뜻은 같다. my_visible_broker_ids 의 승인 확인과 갈래 넷(본인 / 대표→직원 / 동료
-- (can_see_others) / 직원→대표)이 can_view_broker_property 와 같고, 관리자는
-- is_admin_user 로 따로 연다. 2026-10-14 사용자 12명 × 표 5개를 견줘 행 수가 모두 같았다.
-- 읽기(SELECT) 정책만 바꾼다. 쓰기 정책(can_manage_office_ads 등)은 그대로다.

alter policy ad_listings_select on public.ad_listings
  using ((select is_admin_user()) or broker_id in (select unnest(my_visible_broker_ids())));

-- 광고 글은 매물(ad_listings)을 볼 수 있으면 본다 — 그 표의 정책에 맡긴다.
alter policy ad_posts_select on public.ad_posts
  using (listing_id in (select id from public.ad_listings));

alter policy ad_jobs_select on public.ad_jobs
  using ((select is_admin_user()) or broker_id in (select unnest(my_visible_broker_ids())));

alter policy ad_agents_select on public.ad_agents
  using ((select is_admin_user()) or broker_id in (select unnest(my_visible_broker_ids())));

alter policy naver_views_read on public.naver_article_views
  using ((select is_admin_user()) or broker_id in (select unnest(my_visible_broker_ids())));

alter policy daangn_views_read on public.daangn_article_views
  using ((select is_admin_user()) or broker_id in (select unnest(my_visible_broker_ids())));
