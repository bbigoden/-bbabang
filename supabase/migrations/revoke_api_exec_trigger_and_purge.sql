-- 트리거 함수·크론 전용 함수는 API(PostgREST /rpc)로 부를 일이 없다. 실행 권한만 닫는다.
-- 트리거는 실행 권한과 상관없이 계속 동작한다(만들 때만 검사) — rollback 시험으로 확인했다.
-- purge_old_trash 는 pg_cron(postgres) 전용이고 앱에서 부르는 곳이 없다. 7/22부터 크론이 실패하는
-- 문제(관리자 검사)는 사장님 결정(30일 지난 휴지통 44건 영구 삭제) 뒤에 따로 고친다.
revoke execute on function public.trg_diary_customer_same_scope() from public, anon, authenticated;
revoke execute on function public.guard_broker_profile_privileged() from public, anon, authenticated;
revoke execute on function public.guard_profile_self_update() from public, anon, authenticated;
revoke execute on function public.purge_old_trash() from public, anon, authenticated;
