-- 2026-11-05 성능 경고 정리 (사장님 "성능 경고도 정리해")

-- 1) 외래키에 인덱스 (지울 때·조인 때 전체 훑기 방지)
create index if not exists idx_bank_draft_jobs_requested_by        on public.bank_draft_jobs (requested_by);
create index if not exists idx_claude_orders_requested_by          on public.claude_orders (requested_by);
create index if not exists idx_office_chat_threads_notice_message  on public.office_chat_threads (notice_message_id);
create index if not exists idx_office_diary_ad_memos_author        on public.office_diary_ad_memos (author_id);
create index if not exists idx_office_resource_files_uploader      on public.office_resource_files (uploader_broker_id);
create index if not exists idx_office_tasks_created_by             on public.office_tasks (created_by);

-- 2) 똑같은 인덱스 두 개 중 하나 삭제
drop index if exists public.naver_articles_first_seen;

-- 3) 정책에서 auth.uid() 를 줄마다 다시 부르지 않게 (select auth.uid())
alter policy office_resource_stars_own on public.office_resource_stars
  to authenticated
  using (exists (select 1 from public.broker_profiles bp
                 where bp.user_id = (select auth.uid()) and bp.id = office_resource_stars.broker_id))
  with check (exists (select 1 from public.broker_profiles bp
                 where bp.user_id = (select auth.uid()) and bp.id = office_resource_stars.broker_id));

-- 오타도 같이 고침: p.office_broker_id = p.office_broker_id (항상 참) → 작업의 사무소와 비교.
-- 기존 35건 모두 이 조건을 만족함을 확인했다.
alter policy bank_draft_jobs_insert on public.bank_draft_jobs
  with check (
    requested_by = (select auth.uid())
    and can_manage_office_ads(office_broker_id)
    and exists (select 1 from public.broker_properties p
                where p.id = bank_draft_jobs.property_id
                  and p.office_broker_id = bank_draft_jobs.office_broker_id
                  and p.deleted_at is null
                  and can_edit_broker_property(p.broker_id)));

-- 4) office_diary_ad_memos: 'write'(ALL) 가 SELECT 까지 겹쳐 정책 두 개가 매번 돌던 것.
--    보기는 office_diary_ad_memos_select(can_see_ad_memo) 하나로, 쓰기는 셋으로 나눈다.
drop policy if exists office_diary_ad_memos_write on public.office_diary_ad_memos;

create policy office_diary_ad_memos_insert on public.office_diary_ad_memos
  for insert to authenticated
  with check (is_office_member(office_id) and (
    author_id in (select bp.id from public.broker_profiles bp where bp.user_id = (select auth.uid()))
    or (is_office_owner(office_id) and author_id in (
          select bp.id from public.broker_profiles bp
          where bp.id = office_diary_ad_memos.office_id or bp.parent_broker_id = office_diary_ad_memos.office_id))));

create policy office_diary_ad_memos_update on public.office_diary_ad_memos
  for update to authenticated
  using (is_office_member(office_id) and (
    author_id in (select bp.id from public.broker_profiles bp where bp.user_id = (select auth.uid()))
    or is_office_owner(office_id)))
  with check (is_office_member(office_id) and (
    author_id in (select bp.id from public.broker_profiles bp where bp.user_id = (select auth.uid()))
    or (is_office_owner(office_id) and author_id in (
          select bp.id from public.broker_profiles bp
          where bp.id = office_diary_ad_memos.office_id or bp.parent_broker_id = office_diary_ad_memos.office_id))));

create policy office_diary_ad_memos_delete on public.office_diary_ad_memos
  for delete to authenticated
  using (is_office_member(office_id) and (
    author_id in (select bp.id from public.broker_profiles bp where bp.user_id = (select auth.uid()))
    or is_office_owner(office_id)));
