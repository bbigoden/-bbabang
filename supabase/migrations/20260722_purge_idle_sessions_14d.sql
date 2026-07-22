-- 2026-07-22 원격 적용됨 (purge_idle_sessions_14d)
--
-- 2주간 사용되지 않은 로그인 세션을 자동 정리한다.
-- Supabase의 inactivity timeout 설정은 Pro 플랜 전용이라 DB 레벨에서 직접 구현.
-- 기준은 "마지막 사용(refreshed_at) 후 14일" — 매일 쓰는 사람은 영향 없고,
-- 방치된 기기·퇴사자 기기만 만료된다.
--
-- 배경: 세션에 만료가 전혀 없어 퇴사자(김규영)의 아이폰 세션이 두 달 뒤에도
-- 살아 있었다. 해당 세션 5건은 수동 삭제했고, 재발 방지를 위해 이 정리 작업을 둔다.
create or replace function public.purge_idle_sessions(max_idle interval default interval '14 days')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted integer;
begin
  -- refresh token을 먼저 지운다(회전 이력이 세션당 수십~수백 건 쌓임)
  delete from auth.refresh_tokens rt
   where rt.session_id in (
     select s.id from auth.sessions s
      where coalesce(s.refreshed_at, s.created_at) < now() - max_idle
   );

  delete from auth.sessions s
   where coalesce(s.refreshed_at, s.created_at) < now() - max_idle;
  get diagnostics deleted = row_count;

  return deleted;
end;
$$;

-- 일반 사용자는 호출할 수 없다(cron은 postgres 권한으로 실행됨)
revoke all on function public.purge_idle_sessions(interval) from public;
revoke all on function public.purge_idle_sessions(interval) from anon;
revoke all on function public.purge_idle_sessions(interval) from authenticated;

-- 매일 03:30 KST(18:30 UTC) 실행
select cron.schedule(
  'purge-idle-sessions-14d',
  '30 18 * * *',
  $cron$ select public.purge_idle_sessions(); $cron$
);
