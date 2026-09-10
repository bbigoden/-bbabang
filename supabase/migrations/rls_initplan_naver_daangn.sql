-- 매물수집 표 4개의 RLS 정책이 행마다 auth.uid() 를 다시 부르고 있었다.
-- (select auth.uid()) 로 감싸면 한 번만 셈한다. 조건은 그대로다 — 성능만 달라진다.
-- 2026-09-08 점검(22단계 2번, auth_rls_initplan WARN 11건)에서 나왔다.
alter policy naver_articles_select on public.naver_articles
  using (exists (select 1 from broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
alter policy naver_articles_insert on public.naver_articles
  with check (exists (select 1 from broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
alter policy naver_articles_update on public.naver_articles
  using (exists (select 1 from broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
alter policy naver_articles_delete on public.naver_articles
  using (exists (select 1 from broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));

alter policy daangn_articles_select on public.daangn_articles
  using (exists (select 1 from broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
alter policy daangn_articles_insert on public.daangn_articles
  with check (exists (select 1 from broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
alter policy daangn_articles_update on public.daangn_articles
  using (exists (select 1 from broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
alter policy daangn_articles_delete on public.daangn_articles
  using (exists (select 1 from broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));

alter policy naver_views_write on public.naver_article_views
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
alter policy daangn_views_write on public.daangn_article_views
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
