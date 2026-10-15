-- 휴지통 30일 자동 영구삭제 크론(purge-old-trash, 매일 03:00 KST)이 7/22부터 매일 실패했다.
-- 7/22 보안 정리에서 '관리자만' 검사를 넣었는데, pg_cron 은 로그인 정보(JWT) 없이 돌아
-- auth.uid() 가 NULL 이라 늘 '권한 없음' 에 걸렸다(85회 연속 실패). 휴지통 화면은
-- '30일 동안 보관되고 자동으로 영구 삭제됩니다' 라고 안내하는데 지켜지지 않았다.
--
-- 이제 로그인 정보가 없는 호출(크론·service_role)은 통과하고, 로그인한 사용자가 부르면
-- 관리자만 된다. API 실행 권한은 revoke_api_exec_trigger_and_purge 에서 이미 회수했다.
--
-- 사장님 확인(2026-10-15): 적용 뒤 첫 크론에서 30일 지난 고객 20건·매물 24건이 영구 삭제된다.
create or replace function public.purge_old_trash()
 returns table(properties_purged integer, customers_purged integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  p_count int;
  c_count int;
begin
  if auth.uid() is not null
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception '권한 없음: 휴지통 일괄 영구삭제는 관리자만 가능합니다';
  end if;

  with d as (
    delete from broker_properties
    where deleted_at is not null and deleted_at < now() - interval '30 days'
    returning 1
  ) select count(*) into p_count from d;

  with d as (
    delete from broker_customers
    where deleted_at is not null and deleted_at < now() - interval '30 days'
    returning 1
  ) select count(*) into c_count from d;

  return query select p_count, c_count;
end;
$function$;

revoke execute on function public.purge_old_trash() from public, anon, authenticated;
