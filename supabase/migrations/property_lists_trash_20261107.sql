-- 미팅준비를 지우면 휴지통으로(11-07 사장님). 30일 뒤 매일 밤 비우기(purge_old_trash)에 함께 지운다.
alter table public.property_lists add column if not exists deleted_at timestamptz;

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

  -- 미팅준비(항목은 on delete cascade 로 같이 지워진다)
  delete from property_lists where deleted_at is not null and deleted_at < now() - interval '30 days';

  return query select p_count, c_count;
end;
$function$;
