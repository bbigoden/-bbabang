-- 채팅 첨부 스토리지 정책 정리 (점검 g7/F3·F4·F8, 2026-10-15)
--
-- 1) office-chat-images 읽기·올리기를 "그 대화방을 볼 수 있는 사람"으로 좁힌다 (F3)
--    경로는 `${사무소}/${스레드}/uuid.ext` 인데 정책이 폴더[1](사무소)만 봐서, DM·단체방 첨부를
--    대화에 없는 동료와 대표도 list → createSignedUrl 로 받을 수 있었다. 메시지 행은
--    can_access_office_thread 로 막혀 있는데 파일만 사무소 전체에 열려 있던 것.
--    판정은 can_access_office_thread 를 그대로 불러 테이블 RLS 와 항상 같게 둔다
--    (오늘 고친 판: 현재 소속·승인된 사람만, group 외에는 멤버 행 필요).
--
-- 2) office-chat-images 에 DELETE 정책을 둔다 (F8)
--    메시지를 지워도 첨부 파일이 남았다(클라이언트가 지울 방법 자체가 없었다).
--    "그 메시지가 내 것인가"로 판정하면 순서가 꼬인다 — 행을 먼저 지우면 판정할 행이 없고,
--    파일을 먼저 지우면 행 삭제 실패 시 깨진 메시지가 남는다. 그래서 올린 사람(owner_id)
--    기준으로 한다. 메시지 삭제(ocmsg_delete)도 보낸 사람만 되므로 결과가 같다.
--
-- 3) 고객↔중개사 채팅 사진용 비공개 버킷 chat-images (F4)
--    예전엔 공개 버킷 property-images 의 `chat/${room}/...` 에 올렸는데, 그 버킷 INSERT 정책은
--    폴더[1] = 본인 uid 라서 업로드가 한 번도 성공하지 못했다(chat_messages 에 image 0건).
--    경로만 고치면 고객 대화 사진이 영구 공개 URL 로 남으므로 비공개 버킷으로 옮긴다.
--    경로는 `${room_id}/uuid.ext`, 메시지 content 에는 경로만 저장하고 볼 때 서명 URL 로 연다.
--    chat_rooms.broker_id 는 broker_profiles.id 가 아니라 auth 사용자 id 다(FK → profiles).
--
-- 적용 순서: 이 파일 → 앱 배포. 앱이 먼저 나가도 사진 전송이 "버킷 없음" 오류 토스트로
-- 끝날 뿐이라(지금도 항상 실패) 퇴행은 없다. 1)·2) 는 앱과 무관하게 바로 적용해도 된다.


-- ── 1) office-chat-images: 대화방 단위 접근 ─────────────────────────────
-- 경로를 직접 uuid 로 캐스팅하면 형식이 틀린 이름에서 오류가 나므로 plpgsql 로 먼저 거른다.
create or replace function public.can_access_office_chat_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_thread uuid;
begin
  if coalesce(array_length(v_parts, 1), 0) < 2
     or v_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_thread := v_parts[2]::uuid;
  -- 폴더[1](사무소)도 스레드의 사무소와 맞아야 한다 — 남의 사무소 폴더에 끼워 넣기 방지
  return exists (
    select 1 from office_chat_threads t
    where t.id = v_thread and t.office_broker_id::text = v_parts[1]
  ) and public.can_access_office_thread(v_thread);
end;
$$;

revoke all on function public.can_access_office_chat_object(text) from public, anon;
grant execute on function public.can_access_office_chat_object(text) to authenticated;

drop policy if exists "office_chat_img_select" on storage.objects;
create policy "office_chat_img_select" on storage.objects for select to authenticated
  using (bucket_id = 'office-chat-images' and public.can_access_office_chat_object(name));

drop policy if exists "office_chat_img_insert" on storage.objects;
create policy "office_chat_img_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'office-chat-images' and public.can_access_office_chat_object(name));


-- ── 2) office-chat-images: 올린 사람만 삭제 ─────────────────────────────
-- 스토리지 삭제는 RETURNING 을 쓰므로 위 select 정책(방 접근)도 함께 통과해야 지워진다.
drop policy if exists "office_chat_img_delete" on storage.objects;
create policy "office_chat_img_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'office-chat-images' and owner_id = (select auth.uid())::text);


-- ── 3) chat-images: 고객↔중개사 채팅 사진 (비공개) ────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 폴더[1] = 채팅방 id, 그 방의 고객(user_id) 또는 중개사(broker_id = auth uid)만.
create or replace function public.can_access_chat_image(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_parts text[] := storage.foldername(p_name);
  v_uid uuid := auth.uid();
begin
  if v_uid is null
     or coalesce(array_length(v_parts, 1), 0) < 1
     or v_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from chat_rooms r
    where r.id = v_parts[1]::uuid
      and v_uid in (r.user_id, r.broker_id)
  );
end;
$$;

revoke all on function public.can_access_chat_image(text) from public, anon;
grant execute on function public.can_access_chat_image(text) to authenticated;

drop policy if exists "chat_images_select" on storage.objects;
create policy "chat_images_select" on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and public.can_access_chat_image(name));

drop policy if exists "chat_images_insert" on storage.objects;
create policy "chat_images_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and public.can_access_chat_image(name));

-- 메시지 기록이 실패했을 때 방금 올린 파일을 되돌리는 용도. 채팅 메시지 자체는 삭제가 없다.
-- 이미 메시지로 간 사진은 올린 사람도 못 지운다 — 상대에게 보낸 사진이 깨진 자리로 남고,
-- 분쟁 때 증거가 사라진다.
drop policy if exists "chat_images_delete" on storage.objects;
create policy "chat_images_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and owner_id = (select auth.uid())::text
         and not exists (select 1 from public.chat_messages m
                         where m.message_type = 'image' and m.content = storage.objects.name));
