-- 직원이 사무소의 광고를 다룰 수 있게 한다.
--
-- 증상: 직원 계정으로 광고관리에서 [가져오기] 를 누르면
--   "new row violates row-level security policy for table ad_jobs"
--
-- 원인: `can_view_broker_property` 에는 **직원이 사무소 것을 본다** 갈래가 있는데
-- `can_edit_broker_property` 에는 없다. 그래서 목록은 보이고 버튼만 막혔다.
--
-- `can_edit_broker_property` 자체는 고치지 않는다. 그 함수는 broker_properties
-- (매물)·collect_settings 도 함께 쓰므로 거기까지 권한이 번진다.
-- 광고 표(ad_*)에만 쓰는 함수를 따로 둔다.
--
-- 권한은 매물 편집 권한을 따라간다 — 매물을 고칠 수 있는 직원이면 그 매물의
-- 광고도 다룰 수 있다. permissions 가 비어 있는 옛 직원 행은 허용으로 본다
-- (can_see_others 가 쓰는 규칙과 같다).
create or replace function public.can_manage_office_ads(prop_broker_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    public.can_edit_broker_property(prop_broker_id)
    or exists (
      select 1 from public.broker_profiles bp_me
      where bp_me.user_id = auth.uid()
        and bp_me.is_approved = true
        and bp_me.parent_broker_id = prop_broker_id
        and (bp_me.permissions->'properties'->>'edit') is distinct from 'false'
    )
$$;

-- ad_jobs — [가져오기]·[올리기]·[내리기] 가 여기에 한 줄 넣는 것으로 시작한다
drop policy if exists ad_jobs_insert on public.ad_jobs;
create policy ad_jobs_insert on public.ad_jobs
  for insert with check (public.can_manage_office_ads(broker_id));

drop policy if exists ad_jobs_update on public.ad_jobs;
create policy ad_jobs_update on public.ad_jobs
  for update using (public.can_manage_office_ads(broker_id));

drop policy if exists ad_jobs_delete on public.ad_jobs;
create policy ad_jobs_delete on public.ad_jobs
  for delete using (public.can_manage_office_ads(broker_id));

-- ad_listings — [내리기] 가 contracted_at 을 적는다
drop policy if exists ad_listings_insert on public.ad_listings;
create policy ad_listings_insert on public.ad_listings
  for insert with check (public.can_manage_office_ads(broker_id));

drop policy if exists ad_listings_update on public.ad_listings;
create policy ad_listings_update on public.ad_listings
  for update using (public.can_manage_office_ads(broker_id));

drop policy if exists ad_listings_delete on public.ad_listings;
create policy ad_listings_delete on public.ad_listings
  for delete using (public.can_manage_office_ads(broker_id));

-- ad_posts — 발행 기록. 매물을 따라간다.
drop policy if exists ad_posts_insert on public.ad_posts;
create policy ad_posts_insert on public.ad_posts
  for insert with check (exists (
    select 1 from public.ad_listings l
    where l.id = ad_posts.listing_id and public.can_manage_office_ads(l.broker_id)));

drop policy if exists ad_posts_update on public.ad_posts;
create policy ad_posts_update on public.ad_posts
  for update using (exists (
    select 1 from public.ad_listings l
    where l.id = ad_posts.listing_id and public.can_manage_office_ads(l.broker_id)));

drop policy if exists ad_posts_delete on public.ad_posts;
create policy ad_posts_delete on public.ad_posts
  for delete using (exists (
    select 1 from public.ad_listings l
    where l.id = ad_posts.listing_id and public.can_manage_office_ads(l.broker_id)));

-- 확인한 것 (직원 계정·다른 사무소 계정으로 실제 insert 를 해 봤다)
--   직원        → 통과
--   다른 사무소 → 막힘
