-- 사내 메신저: 지운 메세지를 대표는 볼 수 있게 (2026-11-04 사장님 요청)
--
-- '모두에게서 삭제' 는 그대로 행을 비우고 '삭제된 메세지입니다' 로 남긴다. 다만 비우기 전에 원본을
-- office_chat_deleted_messages 에 옮겨 두고, 그 사무소 대표만 읽게 한다(직원·보낸 사람 본인은 못 본다).
-- 대표도 자기가 들어가 있는 방의 것만 본다(can_access_office_thread). 직원끼리 1:1 방은 대표가 멤버가 아니라 안 보인다.
-- 사진·파일은 대표가 열어 볼 수 있게 저장소에서 지우지 않는다 — 함수가 빈 목록을 돌려줘 화면도 안 지운다.
-- 이 파일 전에 지운 메세지(60건)는 이미 내용이 비워져 되살릴 수 없다.
--
-- 적용 순서: 이 파일 → 앱 배포(옛 화면도 빈 목록을 받으니 그대로 돌아간다).

create table if not exists public.office_chat_deleted_messages (
  message_id uuid primary key references public.office_chat_messages(id) on delete cascade,
  thread_id uuid not null references public.office_chat_threads(id) on delete cascade,
  sender_broker_id uuid references public.broker_profiles(id) on delete set null,
  body text not null default '',
  image_url text,
  image_paths text[],
  file_url text,
  file_name text,
  deleted_at timestamptz not null default now()
);
create index if not exists idx_office_chat_deleted_thread on public.office_chat_deleted_messages(thread_id);
create index if not exists idx_office_chat_deleted_sender on public.office_chat_deleted_messages(sender_broker_id);

alter table public.office_chat_deleted_messages enable row level security;
-- 읽기는 그 사무소 대표만. 쓰기 정책은 두지 않는다(삭제 함수만 넣는다)
drop policy if exists ocdm_select on public.office_chat_deleted_messages;
create policy ocdm_select on public.office_chat_deleted_messages
  for select using (
    exists (select 1 from public.office_chat_threads t
            join public.broker_profiles me on me.id = t.office_broker_id and me.user_id = (select auth.uid())
            where t.id = office_chat_deleted_messages.thread_id)
    and public.can_access_office_thread(thread_id)
  );
revoke all on public.office_chat_deleted_messages from anon;
grant select on public.office_chat_deleted_messages to authenticated;

create or replace function public.delete_office_chat_message(p_id uuid)
 returns text[]
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_msg office_chat_messages%rowtype;
begin
  select m.* into v_msg from office_chat_messages m
   join broker_profiles me on me.id = m.sender_broker_id and me.user_id = auth.uid()
   where m.id = p_id and m.deleted_at is null;
  if not found then raise exception '내가 보낸 메시지만 지울 수 있어요' using errcode = '42501'; end if;

  -- 비우기 전에 원본을 대표용으로 옮겨 둔다
  insert into office_chat_deleted_messages
    (message_id, thread_id, sender_broker_id, body, image_url, image_paths, file_url, file_name)
  values (v_msg.id, v_msg.thread_id, v_msg.sender_broker_id, coalesce(v_msg.body, ''), v_msg.image_url, v_msg.image_paths, v_msg.file_url, v_msg.file_name)
  on conflict (message_id) do nothing;

  update office_chat_messages
     set deleted_at = now(), body = '', image_url = null, image_paths = null, file_url = null, file_name = null
   where id = p_id;
  update office_chat_threads set notice_message_id = null where notice_message_id = p_id;
  delete from office_chat_reactions where message_id = p_id;
  -- 첨부는 대표가 볼 수 있게 남긴다 — 화면이 저장소에서 지우지 않도록 빈 목록
  return '{}'::text[];
end;
$function$;
