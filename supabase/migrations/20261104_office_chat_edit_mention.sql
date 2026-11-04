-- 사내 메신저: 보낸 메세지 수정 + @태그(언급) (2026-11-04 사장님 요청)
--
-- 수정: 내가 보낸 글자 메세지만, 보낸 지 24시간 안(카톡과 같다). 사진·파일·삭제된 것·봇 답장은 못 고친다.
--       행에 직접 update 정책은 여전히 두지 않고 함수로만 고친다(삭제와 같은 방식).
-- 태그: 본문의 '@이름' 으로 고른 사람을 mention_ids 에 담는다. 알림을 끈 방이어도 태그된 사람에겐 푸시가 간다.
--
-- 적용 순서: 이 파일 → 앱 배포.

alter table public.office_chat_messages
  add column if not exists edited_at timestamptz,
  add column if not exists mention_ids uuid[];

create or replace function public.edit_office_chat_message(p_id uuid, p_body text, p_mentions uuid[] default null)
 returns timestamptz
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_msg office_chat_messages%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_at timestamptz := now();
begin
  if v_body = '' then raise exception '내용을 입력해 주세요' using errcode = '22023'; end if;

  select m.* into v_msg from office_chat_messages m
   join broker_profiles me on me.id = m.sender_broker_id and me.user_id = auth.uid()
   where m.id = p_id and m.deleted_at is null and m.bot_name is null;
  if not found then raise exception '내가 보낸 메세지만 고칠 수 있어요' using errcode = '42501'; end if;
  if not public.can_access_office_thread(v_msg.thread_id) then raise exception '이 대화방에 없어요' using errcode = '42501'; end if;
  if v_msg.image_url is not null or v_msg.image_paths is not null or v_msg.file_url is not null then
    raise exception '사진·파일은 고칠 수 없어요' using errcode = '22023';
  end if;
  if v_msg.created_at < now() - interval '24 hours' then
    raise exception '보낸 지 24시간이 지나 고칠 수 없어요' using errcode = '22023';
  end if;

  update office_chat_messages
     set body = v_body, edited_at = v_at, mention_ids = nullif(p_mentions, '{}')
   where id = p_id;
  return v_at;
end;
$function$;

revoke execute on function public.edit_office_chat_message(uuid, text, uuid[]) from public, anon;
grant execute on function public.edit_office_chat_message(uuid, text, uuid[]) to authenticated, service_role;
