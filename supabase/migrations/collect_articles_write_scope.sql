set local lock_timeout = '5s';
-- 매물수집 표(naver_articles·daangn_articles) 쓰기를 수집 계정에만 연다. (2026-10-16 보안 점검)
--
-- **왜** — 두 표의 넣기·고치기·지우기 정책이 '승인된 중개사면 누구나' 였다. 그런데 회원가입한
-- 사람은 누구나 빈 사무소의 승인된 대표로 자기 broker_profiles 를 만들 수 있다(대표 신규
-- 등록은 정상 경로라 막을 수 없다). 그러면 바깥사람이 PostgREST 로
--   DELETE /rest/v1/naver_articles?article_no=not.is.null
-- 한 번에 사무소 전체가 보는 수집 목록을 통째로 지우거나 엉뚱한 매물을 끼워 넣을 수 있었다.
-- 지우면 naver_article_views·daangn_article_views 의 '본 기록' 까지 외래키 cascade 로 날아간다.
--
-- **누가 실제로 쓰는가** (2026-10-16 코드 전수 확인)
--   쓰는 곳은 옆 레포 `코드/부소장광고` 두 파일뿐이고, 둘 다 supabase.js 의 getClient() —
--   부소장등록/.env 의 PPABANG_EMAIL 로 로그인한 **대표 계정**(041861af-…) 하나로 쓴다.
--     src/naver.js
--       · collectNaver       upsert(onConflict article_no)  — 받은 매물 넣기·last_seen_at/gone_at 갱신
--       · markGone           update gone_at                  — 반나절 넘게 안 보인 매물에 '사라짐'
--       · 오래된것정리         delete exposure_start_date < 90일 전
--       · fillNaverJibun     update pnu·li·address_hidden·jibun_checked_at (또는 gone_at)
--     src/daangn-watch.js
--       · collectDaangn      upsert(onConflict article_no)
--       · 오래된것정리         delete first_seen_at < 90일 전
--   부소장 웹(src/)은 이 두 표를 **쓰지 않는다.** 화면은 collect_listings RPC(SECURITY INVOKER)로
--   읽기만 하고, [가져오기] 는 ad_jobs 에 일을 넣을 뿐 — 실제 수집은 PC 프로그램이 대표 계정으로
--   한다. 그래서 직원이 [가져오기] 를 눌러도 그대로 돈다. 이 표를 건드리는 DB 함수·트리거·크론도 없다.
--
-- **어떻게** — 수집 계정 목록을 internal_config('collector_user_ids', 쉼표로 이은 uuid)에 둔다.
--   internal_config 는 RLS 정책이 없고 authenticated 에 권한도 없어(service_role·definer 전용)
--   정책이 직접 읽을 수 없다 → SECURITY DEFINER 도우미 is_article_collector() 로 묻는다.
--   PC 프로그램 계정을 바꾸면 여기 값만 고치면 된다(정책은 그대로):
--     update public.internal_config set value = '<uuid>,<uuid>' where key = 'collector_user_ids';
--   읽기(SELECT) 정책은 그대로 둔다 — 승인된 중개사는 모두 본다.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 되돌리기 (PC 프로그램이 "네이버/당근 매물 저장 실패: new row violates row-level security" 로 멈추면)
--   2026-10-16 pg_policies 에서 읽은 이전 정의 그대로다. 이 파일은 alter policy 만 쓰므로
--   UPDATE 정책의 WITH CHECK 는 원래처럼 비어 있다(USING 이 새 행 검사도 맡는다) — 아래로 그대로 돌아간다.
--
--   alter policy naver_articles_insert on public.naver_articles
--     with check (exists (select 1 from public.broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
--   alter policy naver_articles_update on public.naver_articles
--     using (exists (select 1 from public.broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
--   alter policy naver_articles_delete on public.naver_articles
--     using (exists (select 1 from public.broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
--   alter policy daangn_articles_insert on public.daangn_articles
--     with check (exists (select 1 from public.broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
--   alter policy daangn_articles_update on public.daangn_articles
--     using (exists (select 1 from public.broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
--   alter policy daangn_articles_delete on public.daangn_articles
--     using (exists (select 1 from public.broker_profiles bp where bp.user_id = (select auth.uid()) and bp.is_approved));
--
--   (도우미·설정값은 남겨 둬도 해가 없다. 굳이 걷으려면 위 여섯 줄 **다음에**)
--   drop function if exists public.is_article_collector();
--   delete from public.internal_config where key = 'collector_user_ids';
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) 수집 계정 목록. 지금은 PC 프로그램이 로그인하는 대표 계정 하나.
--    다시 돌려도 같은 값이 되도록 덮어쓴다.
insert into public.internal_config (key, value)
values ('collector_user_ids', '041861af-1f79-4723-a098-aa8035e7749a')
on conflict (key) do update set value = excluded.value;

-- 2) 지금 로그인한 사람이 수집 계정인가.
--    값에 공백·대문자가 섞여도(손으로 고칠 때) 맞도록 다듬어 비교한다.
--    키가 없거나 비었거나 로그인 안 했으면(auth.uid() 가 NULL) false — 막는 쪽으로 넘어진다.
create or replace function public.is_article_collector()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select (select auth.uid())::text
           = any (string_to_array(regexp_replace(lower(c.value), '\s', '', 'g'), ','))
    from public.internal_config c
    where c.key = 'collector_user_ids'
  ), false)
$$;

comment on function public.is_article_collector() is
  '매물수집 표(naver_articles·daangn_articles) 쓰기 정책용. internal_config.collector_user_ids(쉼표 uuid)에 auth.uid() 가 있으면 true.';

-- 정책 식은 부르는 사람 권한으로 돌므로 authenticated 에는 EXECUTE 가 있어야 한다.
-- anon 은 쓰기 정책 대상(to authenticated)이 아니라 필요 없다. Supabase 기본 권한이
-- 새 함수에 anon 까지 열어 주므로 여기서 걷는다.
revoke execute on function public.is_article_collector() from public, anon;
grant execute on function public.is_article_collector() to authenticated;

-- 3) 쓰기 정책 여섯 개를 수집 계정 전용으로. 이름·대상(authenticated)·명령은 그대로라
--    alter policy 로 식만 바꾼다(지웠다 만드는 틈이 없다).
--    (select …) 로 감싸 문장마다 한 번만 묻는다 — upsert 500행에 500번 부르지 않게.
--    UPDATE 는 WITH CHECK 를 따로 안 둔다: 없으면 USING 이 고친 뒤 행 검사도 맡는다(원래 모양 그대로).
alter policy naver_articles_insert on public.naver_articles
  with check ((select public.is_article_collector()));
alter policy naver_articles_update on public.naver_articles
  using ((select public.is_article_collector()));
alter policy naver_articles_delete on public.naver_articles
  using ((select public.is_article_collector()));

alter policy daangn_articles_insert on public.daangn_articles
  with check ((select public.is_article_collector()));
alter policy daangn_articles_update on public.daangn_articles
  using ((select public.is_article_collector()));
alter policy daangn_articles_delete on public.daangn_articles
  using ((select public.is_article_collector()));
revoke truncate, trigger, references on public.naver_articles, public.daangn_articles from anon, authenticated;
