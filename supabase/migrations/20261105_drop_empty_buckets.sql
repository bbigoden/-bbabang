-- 2026-11-05 빈 저장소 버킷 3개 삭제 (사장님 승인)
-- 견적서·고객 채팅용이었고 파일 0개, 코드에서 안 씀. 파일이 하나라도 있으면 멈춘다.
do $$
begin
  if exists (select 1 from storage.objects where bucket_id in ('chat-images','estimate-files','estimate-stamps')) then
    raise exception 'bucket not empty';
  end if;
end $$;
select set_config('storage.allow_delete_query','true',true);
delete from storage.buckets where id in ('chat-images','estimate-files','estimate-stamps');
