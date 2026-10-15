-- 푸시 구독 테이블에 '본인 행 UPDATE' 정책을 더한다.
-- 구독 등록(/api/push/subscribe POST)은 upsert(onConflict: 'endpoint') = INSERT … ON CONFLICT DO UPDATE 다.
-- 정책이 select/insert/delete_own 셋뿐이라, 같은 기기(같은 endpoint)로 다시 등록하면 충돌 경로의
-- UPDATE 가 RLS 기본 거부에 걸려 500(db_error)이 났다. 같은 사람이 재구독해도 실패했다.
-- 앱은 로그아웃 때 이 기기 행을 지우고 다음 로그인 때 같은 구독을 다시 붙이므로(src/lib/push.ts
-- claimPushSubscription) 이 정책이 있어야 재로그인 뒤 알림이 다시 온다.
-- USING·WITH CHECK 모두 본인 행 — 남의 endpoint 행을 넘겨받는 건 여기서 열지 않는다
-- (계정 전환 때 이전 사람 행이 남아 있으면 여전히 실패한다. 그 처리는 서버 라우트 몫).
drop policy if exists push_sub_update_own on public.push_subscriptions;
create policy push_sub_update_own on public.push_subscriptions
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
