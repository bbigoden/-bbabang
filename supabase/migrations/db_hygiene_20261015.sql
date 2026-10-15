-- 22단계 점검(2026-10-15) DB 정리 4건: g3/S2-6(P1), g3/S2-3·S2-4·S2-5(P2).
-- 리드가 적용한다. 작성할 때 DDL·DML 은 돌리지 않았고, 근거는 모두 읽기 쿼리와
-- rollback 트랜잭션 안의 사칭(set local role + request.jwt.claims) EXPLAIN 으로 확인했다.
-- 맨 아래에 적용 뒤 돌릴 검사(역할별 행 수 기준값 포함)를 적어 두었다.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) g3/S2-6 (P1) profiles 수정: 지금은 '누구도 못 고친다', 고치고 나면 '본인은 허용 칸만'
--
--    근거(2026-10-15 실측):
--    · 7/22 에 authenticated 의 profiles admin_note SELECT 권한을 회수했는데 profiles_update
--      WITH CHECK 에 `(select p.admin_note from profiles p where p.id = profiles.id)` 가
--      남아 있다. 대표 계정 사칭 `explain update profiles set name='x' where id=<본인>` →
--      42501 permission denied for table profiles. 같은 사칭으로 role·account_status·
--      suspended_until 서브쿼리는 읽히고 admin_note 만 막힌다. OR 의 관리자 갈래가 있어도
--      권한 검사는 계획 단계에서 하므로 관리자도 똑같이 막힌다.
--    · 그래서 7/22 이후 settings/account(이름·휴대폰), settings/notifications(알림 설정),
--      관리자 회원관리(역할·정지·메모), 가입 폼 upsert(마케팅 동의)가 모두 실패했다.
--    · 서브쿼리를 걷어 내면, 이번엔 with_check 가 지키는 칸이 role·account_status·
--      suspended_until·admin_note 넷뿐이라 본인이 referred_by·referral_code·created_at·email 을
--      바꿀 수 있다. authenticated·anon 에 profiles UPDATE 가 테이블 단위로 GRANT 되어 있어
--      칼럼 REVOKE 로는 못 막는다 → broker_profiles 와 같은 가드 트리거로 막는다.
--
--    앱에서 profiles 를 고치는 곳(src 전체 grep):
--      settings/account:76        name, phone                  ← 허용
--      settings/notifications:81  notification_preferences     ← 허용
--      auth/signup/signup-form:77 update(notification_preferences) — 원래 upsert(email·phone 포함)였는데
--                                 ON CONFLICT 가 EXCLUDED.email·phone 을 읽으려면 그 칸 SELECT 권한이
--                                 필요해(authenticated 엔 없다) 이 정책을 고쳐도 실패한다. 그래서 같은
--                                 날 앱을 update 로 바꿨다(나머지 칸은 가입 트리거가 넣는다).
--      broker/register:154        role:'broker' — 고객→중개사 셀프 승격. 7/22 정책부터 막아 온
--                                 그대로 계속 막힌다(화면은 오류를 안 보고 넘어간다).
--      admin/users:640            role·account_status·suspended_until·admin_note ← 관리자라 통과
--    서버 쪽: auto-verify 는 service_role, join_office_by_code·handle_new_user 는
--    SECURITY DEFINER(주인 postgres)라 current_user 가 authenticated 가 아니어서 통과한다.
--    avatar_url 은 쓰는 화면이 없지만 본인 정보라 허용 칸으로 둔다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_profile_self_update()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_admin_user() then return new; end if;

  -- 가입 폼 upsert 가 대소문자만 다른 같은 주소를 보낸다 — 막지 않고 저장된 값을 유지
  if lower(btrim(new.email)) = lower(btrim(old.email)) then
    new.email := old.email;
  end if;

  if new.id              is distinct from old.id
  or new.email           is distinct from old.email
  or new.role            is distinct from old.role
  or new.account_status  is distinct from old.account_status
  or new.suspended_until is distinct from old.suspended_until
  or new.admin_note      is distinct from old.admin_note
  or new.referral_code   is distinct from old.referral_code
  or new.referred_by     is distinct from old.referred_by
  or new.created_at      is distinct from old.created_at
  then
    raise exception '권한 없음: 역할·계정 상태·이메일·추천·가입일은 관리자만 바꿀 수 있습니다'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_profile_self_update on public.profiles;
create trigger trg_guard_profile_self_update
  before update on public.profiles
  for each row execute function public.guard_profile_self_update();

-- 칸 단위 검사는 트리거가 맡으므로 정책은 '누구 행인가' 만 본다.
-- profiles 를 다시 읽는 서브쿼리가 없어야 칼럼 SELECT 회수와 부딪히지 않는다.
-- anon 은 auth.uid() 가 NULL 이라 원래도 통과 못 했다 → authenticated 로 좁혀도 뜻은 같다.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using      ((select auth.uid()) = id or (select public.is_admin_user()))
  with check ((select auth.uid()) = id or (select public.is_admin_user()));


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) g3/S2-3 (P2) 같은 역할·같은 동작에 허용 정책이 둘 — 조회마다 둘 다 평가된다
--
--    근거: get_advisors multiple_permissive_policies 11건(2026-10-15).
--      naver/daangn_article_views: *_views_write 가 FOR ALL 이라 SELECT 에서도 *_views_read 와
--        함께 평가(anon·authenticated·authenticator·dashboard_user·supabase_privileged_role 각 1건).
--        collect_listings 가 SECURITY INVOKER 라 매물수집 화면을 열 때마다 이 두 정책을 탄다.
--      job_posts: authenticated SELECT 에 jobs_select_own + jobs_select_public.
--
--    views: ALL 을 INSERT/UPDATE/DELETE 로 쪼개고, 지금 views_write 가 열어 주던
--    '본인 행 보기(user_id = 나)' 를 읽기 정책에 합친다. 이걸 빼면
--      · 소속 해제·미승인 사용자(naver 43행)가 자기 기록을 못 보고,
--      · 열람 권한(can_see_others)이 꺼진 직원은 broker_id=대표 id 로 쓴 자기 행이 안 보여
--        naver/page.tsx 의 upsert(ON CONFLICT DO UPDATE — 기존 행이 SELECT 정책을 통과해야 함)가
--        깨진다.
--    허용 정책은 OR 로 묶이므로 '읽기 ∪ 본인' 하나는 지금 두 정책과 같은 행을 돌려준다.
--    anon 은 auth.uid()·my_visible_broker_ids 가 비어 원래도 0행 → authenticated 로 좁힌다.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists naver_views_write on public.naver_article_views;
drop policy if exists naver_views_read  on public.naver_article_views;
create policy naver_views_read on public.naver_article_views
  for select to authenticated
  using ((select public.is_admin_user())
         or broker_id in (select unnest(public.my_visible_broker_ids()))
         or user_id = (select auth.uid()));
create policy naver_views_insert on public.naver_article_views
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy naver_views_update on public.naver_article_views
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy naver_views_delete on public.naver_article_views
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists daangn_views_write on public.daangn_article_views;
drop policy if exists daangn_views_read  on public.daangn_article_views;
create policy daangn_views_read on public.daangn_article_views
  for select to authenticated
  using ((select public.is_admin_user())
         or broker_id in (select unnest(public.my_visible_broker_ids()))
         or user_id = (select auth.uid()));
create policy daangn_views_insert on public.daangn_article_views
  for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy daangn_views_update on public.daangn_article_views
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy daangn_views_delete on public.daangn_article_views
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- job_posts: 점검 제안은 'anon, authenticated 에 정책 하나(status='open' OR 내 사무소)' 였지만
-- anon 은 broker_profiles.user_id SELECT 권한이 없다(7/22 회수). OR 이어도 권한 검사는
-- 계획 단계라, anon 사칭 `select count(*) from job_posts where status='open' or exists(...bp.user_id...)`
-- → 42501 permission denied for table broker_profiles. 하나로 합치면 비로그인 /jobs 가 깨진다.
-- 그래서 역할마다 정책을 하나씩 둔다 — 역할·동작별로 하나라 advisor 경고도 사라진다.
drop policy if exists jobs_select_own    on public.job_posts;
drop policy if exists jobs_select_public on public.job_posts;
create policy jobs_select_public on public.job_posts
  for select to anon
  using (status = 'open');
create policy jobs_select on public.job_posts
  for select to authenticated
  using (status = 'open'
         or exists (select 1 from public.broker_profiles bp
                    where bp.id = job_posts.office_broker_id
                      and bp.user_id = (select auth.uid())));


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) g3/S2-4 (P2) 받쳐 주는 인덱스가 없는 FK 4개
--
--    근거: get_advisors unindexed_foreign_keys 4건(2026-10-15).
--      naver_article_views.article_no  → naver_articles  ON DELETE CASCADE (PK 가 (user_id, article_no)
--        라 article_no 단독으로는 못 씀. collect_listings 가 `v.article_no in (...)` 로 묶는다.
--        naver_articles_delete 정책이 승인 중개사에게 열려 있어 지우면 views 를 순차 스캔한다)
--      daangn_article_views.article_no → daangn_articles ON DELETE CASCADE (같은 이유)
--      ad_jobs.requested_by            → auth.users      ON DELETE SET NULL (회원 삭제 때 ad_jobs 순차 스캔)
--      shared_reports.created_by       → broker_profiles (NO ACTION — 미승인 직원 거절 등으로
--        broker_profiles 를 지울 때마다 검사)
--    표가 작아(views 333·4행, ad_jobs 271행) 잠금은 순간이다 → CONCURRENTLY 없이 트랜잭션 안에서 만든다.
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists naver_article_views_article_no_idx  on public.naver_article_views (article_no);
create index if not exists daangn_article_views_article_no_idx on public.daangn_article_views (article_no);
create index if not exists ad_jobs_requested_by_idx            on public.ad_jobs (requested_by);
create index if not exists shared_reports_created_by_idx       on public.shared_reports (created_by);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) g3/S2-5 (P2) 다른 인덱스에 완전히 덮이는 일반 인덱스 6개
--
--    근거: pg_index 키 비교(2026-10-15). 지울 것 → 대신 쓰일 것(제약을 받치는 인덱스는 손대지 않음)
--      idx_api_rate_limit_bucket_ts    (bucket, ts)          = api_rate_limit_pkey (bucket, ts) — 정의가 똑같아
--                                                              rate_limit_check 쓰기마다 인덱스를 두 번 고친다
--      broker_diary_broker_id_idx      (broker_id)           ⊂ broker_diary_broker_id_date_key UNIQUE (broker_id, date)
--      broker_diary_date_idx           (broker_id, date DESC) ⊂ 같은 UNIQUE — btree 는 거꾸로도 읽는다
--      ad_posts_listing_idx            (listing_id)          ⊂ ad_posts_listing_id_channel_key UNIQUE (listing_id, channel)
--                                                              (스캔 35만 회 — PC 에이전트 주 경로. 같은 16KB UNIQUE 가 대신함)
--      idx_broker_properties_broker_id (broker_id)           ⊂ idx_broker_properties_broker_seq (broker_id, seq_no)
--      user_term_consents_user_idx     (user_id)             ⊂ user_term_consents_user_id_terms_version_id_key UNIQUE
--    여섯 다 제약을 받치지 않는 일반 인덱스이고(pg_constraint.conindid 없음), 앞 칼럼이 같은
--    인덱스가 남아 FK 커버도 그대로다. 코드·SQL 어디에도 이 이름을 부르는 곳이 없다(grep).
--    덮어 주는 인덱스가 그사이 없어졌으면 지우지 않고 멈춘다.
-- ─────────────────────────────────────────────────────────────────────────────
-- 앞 절과 따로 적용한다. DROP INDEX 가 PC 에이전트가 자주 읽는 표(ad_posts)의 긴 조회를 기다리는
-- 동안 잠금을 쥐고 있지 않게, 3초 안에 못 잡으면 포기한다.
set local lock_timeout = '3s';
do $$
begin
  if to_regclass('public.api_rate_limit_pkey') is null
  or to_regclass('public.broker_diary_broker_id_date_key') is null
  or to_regclass('public.ad_posts_listing_id_channel_key') is null
  or to_regclass('public.idx_broker_properties_broker_seq') is null
  or to_regclass('public.user_term_consents_user_id_terms_version_id_key') is null
  then
    raise exception '덮어 주는 인덱스가 없어 중복 인덱스를 지우지 않습니다';
  end if;
end $$;

drop index if exists public.idx_api_rate_limit_bucket_ts;
drop index if exists public.broker_diary_broker_id_idx;
drop index if exists public.broker_diary_date_idx;
drop index if exists public.ad_posts_listing_idx;
drop index if exists public.idx_broker_properties_broker_id;
drop index if exists public.user_term_consents_user_idx;


-- ═════════════════════════════════════════════════════════════════════════════
-- 적용 뒤 검사 (읽기 전용 — 사칭은 모두 begin … rollback 안에서)
-- ═════════════════════════════════════════════════════════════════════════════
--
-- [검사 1] 정책 모양
--   select tablename, policyname, cmd, roles from pg_policies
--   where schemaname = 'public'
--     and tablename in ('profiles','naver_article_views','daangn_article_views','job_posts')
--   order by 1, 3, 2;
--   기대: profiles_update UPDATE {authenticated} (서브쿼리 없음)
--         naver/daangn: *_views_read SELECT · *_views_insert · *_views_update · *_views_delete,
--                       모두 {authenticated}, *_views_write 없음
--         job_posts: jobs_select {authenticated}, jobs_select_public {anon}, insert/update/delete 그대로
--   select tgname from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal;
--   기대: trg_guard_profile_self_update
--
-- [검사 2] get_advisors(performance)
--   기대: unindexed_foreign_keys 0건(전 4건), multiple_permissive_policies 0건(전 11건).
--   unused_index 에 새 인덱스 4개가 한동안 뜨는 건 정상(만든 지 얼마 안 됨).
--
-- [검사 3] 역할별 보이는 행 수 — 적용 전(2026-10-15 실측)과 같아야 한다
--   begin;
--   select set_config('request.jwt.claims',
--     json_build_object('sub', (select id from public.profiles where id::text like '<앞 8자리>%'),
--                       'role', 'authenticated')::text, true);
--   set local role authenticated;
--   select (select count(*) from public.naver_article_views)                          nv,
--          (select count(*) from public.naver_article_views where user_id = auth.uid()) nv_own,
--          (select count(*) from public.daangn_article_views)                         dv,
--          (select count(*) from public.job_posts)                                    jp;
--   rollback;
--
--   사용자(앞 8자리)                    nv   nv_own  dv  jp
--   대표            041861af            332    31    4   0
--   직원            94e5a264            332   241    4   0
--   직원            7746b018            332     0    4   0
--   소속 해제·미승인 35b97883             43    43    0   0   ← 본인 행이 views_write 로만 보이던 사람.
--                                                            합친 SELECT 가 이 43 을 지켜야 한다
--   소속 없음 중개사 0cc54c6b              0     0    0   0
--   고객            8a9ed9a6              0     -    0   0
--   관리자          3110f77e            333     0    4   0
--   anon (set local role anon; claims '{"role":"anon"}')
--                                         0     -    0   0   ← job_posts 가 오류 없이 0 이어야 함
--
-- [검사 4] profiles UPDATE 가 권한 오류 없이 계획되는지 (적용 전: 전부 42501)
--   위와 같은 사칭으로(대표·직원·고객·관리자 각각):
--   explain update public.profiles set name = 'x' where id = auth.uid();
--   explain update public.profiles set notification_preferences = '{}'::jsonb where id = auth.uid();
--   관리자(3110f77e)로 남의 행:
--   explain update public.profiles set admin_note = 'x', account_status = 'active', suspended_until = null
--     where id = (select id from public.profiles where id::text like '8a9ed9a6%');
--   기대: 셋 다 계획이 나온다(permission denied 없음). 가입 폼은 update 로 바꿔 위 두 번째와 같은 경로다.
--
-- [검사 5] 매물수집 '본 기록' upsert 경로 (직원 94e5a264 사칭)
--   explain insert into public.naver_article_views (user_id, broker_id, article_no, view_count, seen_at)
--     values (auth.uid(), (select parent_broker_id from public.broker_profiles where user_id = auth.uid()),
--             'x', 1, now())
--     on conflict (user_id, article_no) do update
--       set view_count = excluded.view_count, seen_at = excluded.seen_at, broker_id = excluded.broker_id;
--   기대: 계획이 나온다(적용 전에도 나옴 — 바뀌지 않았는지 보는 것).
--
-- [검사 6] 인덱스
--   select indexrelid::regclass from pg_index
--   where indrelid in ('public.naver_article_views'::regclass, 'public.daangn_article_views'::regclass,
--                      'public.ad_jobs'::regclass, 'public.shared_reports'::regclass,
--                      'public.api_rate_limit'::regclass, 'public.broker_diary'::regclass,
--                      'public.ad_posts'::regclass, 'public.broker_properties'::regclass,
--                      'public.user_term_consents'::regclass)
--   order by 1;
--   기대: *_article_no_idx 2개·ad_jobs_requested_by_idx·shared_reports_created_by_idx 있음,
--         지운 6개 없음, PK·UNIQUE 는 그대로.
--   하루 뒤: pg_stat_user_indexes 에서 api_rate_limit_pkey·ad_posts_listing_id_channel_key·
--   broker_diary_broker_id_date_key·idx_broker_properties_broker_seq 의 idx_scan 이 느는지,
--   PC 에이전트의 ad_posts 조회가 느려지지 않았는지 본다.
--
-- [선택 — DML 이라 리드 판단, 반드시 begin … rollback] 가드가 실제로 막고·통과시키는지
--   본인(대표) 사칭: update public.profiles set referral_code = 'HACKED' where id = auth.uid();
--                    → 42501 '권한 없음: 역할·계정 상태·…'
--                    update public.profiles set notification_preferences = notification_preferences
--                    where id = auth.uid();  → UPDATE 1
--   관리자 사칭:     update public.profiles set admin_note = 'x'
--                    where id = (select id from public.profiles where id::text like '8a9ed9a6%');  → UPDATE 1
--   적용 뒤 실제 화면: 설정 > 계정(이름·휴대폰 저장), 설정 > 알림, 관리자 > 회원관리(메모 저장).
