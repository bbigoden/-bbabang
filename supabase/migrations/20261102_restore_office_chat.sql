-- 사내 메신저 되살리기 + 카톡식 기능 (2026-11-02 사장님 요청: "카카오톡의 기능들 가져와서 다시 만들어")
--
-- 10-30 정리(20261030_drop_customer_estimate_tables.sql)에서 고객 채팅과 함께 지웠던
-- 사무소 안 메신저(office_chat_*)만 다시 만든다. 고객 채팅(chat_rooms·chat_messages)은 되살리지 않는다.
-- 권한 정의는 지우기 직전 운영 상태 그대로다(security_hardening_20261015·storage_chat_policies 반영본).
-- 옛 대화(방 5·멤버 13·메시지 19)는 archive_20261030 에서 되돌린다. 백업 스키마는 그대로 둔다.
--
-- 새로 더하는 것(사장님이 고른 카톡 기능):
--   공감(office_chat_reactions) · 공지(threads.notice_message_id) · 사진 묶음(messages.image_paths)
--   모두에게서 삭제(messages.deleted_at — 행은 남기고 '삭제된 메시지입니다') · 방 고정·알림 끄기(members.pinned_at·muted)
--   프로필 사진·상태메시지(office_chat_profiles, 사진은 office-chat-images 의 `${사무소}/profiles/${나}/…`)
--
-- 적용 순서: 이 파일 → 앱 배포. 앱이 먼저 나가면 메신저 화면이 빈 목록·오류 토스트로 끝난다.

-- 1) 테이블 ─────────────────────────────────────────────
create table if not exists public.office_chat_threads (
  id uuid primary key default gen_random_uuid(),
  office_broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  kind text not null,                 -- 'group'(사무소 전체) | 'dm'(1:1) | 'team'(단체방)
  dm_key text,                        -- dm 일 때 정렬된 'idA__idB'
  title text,
  created_at timestamptz not null default now()
);
create unique index if not exists office_chat_group_uniq on public.office_chat_threads(office_broker_id) where kind = 'group';
create unique index if not exists office_chat_dm_uniq on public.office_chat_threads(dm_key) where kind = 'dm';

create table if not exists public.office_chat_members (
  thread_id uuid not null references public.office_chat_threads(id) on delete cascade,
  broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  pinned_at timestamptz,              -- 채팅 목록 맨 위 고정(고정한 순서)
  muted boolean not null default false, -- 이 방 푸시 끄기
  primary key (thread_id, broker_id)
);
create index if not exists idx_office_chat_members_broker_id on public.office_chat_members(broker_id);

create table if not exists public.office_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.office_chat_threads(id) on delete cascade,
  sender_broker_id uuid references public.broker_profiles(id) on delete set null,
  body text not null,
  image_url text,                     -- 옛 메시지의 사진 한 장(경로 또는 예전 공개 URL)
  image_paths text[],                 -- 사진 묶음(한 번에 여러 장)
  file_url text,
  file_name text,
  reply_to_id uuid references public.office_chat_messages(id) on delete set null,
  deleted_at timestamptz,             -- 모두에게서 삭제 — 내용은 비우고 자리만 남긴다
  created_at timestamptz not null default now()
);
create index if not exists office_chat_messages_thread_idx on public.office_chat_messages(thread_id, created_at);
create index if not exists idx_office_chat_messages_reply_to_id on public.office_chat_messages(reply_to_id);
create index if not exists idx_office_chat_messages_sender_broker_id on public.office_chat_messages(sender_broker_id);

-- 공지 — 방 위에 고정해 보이는 메시지 하나
alter table public.office_chat_threads
  add column if not exists notice_message_id uuid references public.office_chat_messages(id) on delete set null;

-- 공감 — 메시지마다 사람당 종류별 하나
create table if not exists public.office_chat_reactions (
  message_id uuid not null references public.office_chat_messages(id) on delete cascade,
  broker_id uuid not null references public.broker_profiles(id) on delete cascade,
  emoji text not null check (emoji in ('heart', 'like', 'check', 'smile', 'surprise', 'sad')),
  created_at timestamptz not null default now(),
  primary key (message_id, broker_id, emoji)
);
create index if not exists idx_office_chat_reactions_broker_id on public.office_chat_reactions(broker_id);

-- 메신저 프로필 — 사진·상태메시지. broker_profiles 는 권한 감시 트리거가 걸려 있어 따로 둔다
create table if not exists public.office_chat_profiles (
  broker_id uuid primary key references public.broker_profiles(id) on delete cascade,
  status_message text check (char_length(status_message) <= 60),
  avatar_path text,
  updated_at timestamptz not null default now()
);

-- 2) 옛 대화 되돌리기 ─────────────────────────────────────
-- 사무소·보낸 사람이 그 뒤 없어졌으면 FK 에 걸리므로 거른다(보낸 사람만 없으면 '(퇴사)'로 남긴다).
insert into public.office_chat_threads (id, office_broker_id, kind, dm_key, title, created_at)
select a.id, a.office_broker_id, a.kind, a.dm_key, a.title, a.created_at
from archive_20261030.office_chat_threads a
where exists (select 1 from public.broker_profiles b where b.id = a.office_broker_id)
on conflict (id) do nothing;

insert into public.office_chat_members (thread_id, broker_id, last_read_at)
select a.thread_id, a.broker_id, a.last_read_at
from archive_20261030.office_chat_members a
where exists (select 1 from public.office_chat_threads t where t.id = a.thread_id)
  and exists (select 1 from public.broker_profiles b where b.id = a.broker_id)
on conflict (thread_id, broker_id) do nothing;

insert into public.office_chat_messages
  (id, thread_id, sender_broker_id, body, image_url, file_url, file_name, reply_to_id, created_at)
select a.id, a.thread_id,
       case when exists (select 1 from public.broker_profiles b where b.id = a.sender_broker_id) then a.sender_broker_id end,
       a.body, a.image_url, a.file_url, a.file_name,
       case when exists (select 1 from archive_20261030.office_chat_messages r
                         join public.office_chat_threads t on t.id = r.thread_id
                         where r.id = a.reply_to_id) then a.reply_to_id end,
       a.created_at
from archive_20261030.office_chat_messages a
where exists (select 1 from public.office_chat_threads t where t.id = a.thread_id)
on conflict (id) do nothing;

-- 3) 함수 ──────────────────────────────────────────────
-- 지금 그 사무소 소속(대표 또는 승인 직원)이어야 한다. group 은 소속만, dm·team 은 멤버 행도 필요.
create or replace function public.can_access_office_thread(p_thread uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select exists (
    select 1
    from office_chat_threads t
    join broker_profiles me
      on me.user_id = auth.uid()
     and (me.id = t.office_broker_id
          or (me.parent_broker_id = t.office_broker_id and me.is_approved = true))
    where t.id = p_thread
      and (t.kind = 'group'
           or exists (select 1 from office_chat_members m
                      where m.thread_id = t.id and m.broker_id = me.id))
  );
$function$;

-- 1:1 방 찾거나 만들기 (RLS 닭-달걀 회피)
create or replace function public.get_or_create_dm(p_office uuid, p_other uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid;
  v_key text;
  v_thread uuid;
begin
  select id into v_me from broker_profiles
   where user_id = auth.uid()
     and (id = p_office or (parent_broker_id = p_office and is_approved = true))
   limit 1;
  if v_me is null then raise exception 'caller not in office'; end if;

  perform 1 from broker_profiles
   where id = p_other
     and (id = p_office or (parent_broker_id = p_office and is_approved = true));
  if not found then raise exception 'other not in office'; end if;

  if v_me = p_other then raise exception 'cannot dm self'; end if;

  if v_me::text < p_other::text then
    v_key := v_me::text || '__' || p_other::text;
  else
    v_key := p_other::text || '__' || v_me::text;
  end if;

  select id into v_thread from office_chat_threads where dm_key = v_key;
  if v_thread is null then
    insert into office_chat_threads (office_broker_id, kind, dm_key)
      values (p_office, 'dm', v_key)
      on conflict (dm_key) where kind = 'dm' do nothing
      returning id into v_thread;
    if v_thread is null then
      select id into v_thread from office_chat_threads where dm_key = v_key;
    end if;
  end if;

  insert into office_chat_members (thread_id, broker_id)
    values (v_thread, v_me), (v_thread, p_other)
    on conflict (thread_id, broker_id) do nothing;

  return v_thread;
end;
$function$;

-- 단체방 만들기 — 만든 사람 + 고른 멤버(같은 사무소만)
create or replace function public.create_team_thread(p_office uuid, p_title text, p_members uuid[])
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid;
  v_thread uuid;
  v_m uuid;
begin
  select id into v_me from broker_profiles
   where user_id = auth.uid()
     and (id = p_office or (parent_broker_id = p_office and is_approved = true))
   limit 1;
  if v_me is null then raise exception 'caller not in office'; end if;

  insert into office_chat_threads (office_broker_id, kind, title)
    values (p_office, 'team', nullif(btrim(coalesce(p_title, '')), ''))
    returning id into v_thread;

  insert into office_chat_members (thread_id, broker_id) values (v_thread, v_me)
    on conflict (thread_id, broker_id) do nothing;

  if p_members is not null then
    foreach v_m in array p_members loop
      if v_m <> v_me and exists (
        select 1 from broker_profiles
        where id = v_m and (id = p_office or (parent_broker_id = p_office and is_approved = true))
      ) then
        insert into office_chat_members (thread_id, broker_id) values (v_thread, v_m)
          on conflict (thread_id, broker_id) do nothing;
      end if;
    end loop;
  end if;

  return v_thread;
end;
$function$;

-- 메뉴 배지용 전체 안 읽음 수
create or replace function public.office_chat_unread_count()
 returns integer
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me uuid;
  v_office uuid;
  v_count integer := 0;
begin
  select id,
         case when parent_broker_id is null and is_owner is not false then id
              when parent_broker_id is not null and is_approved then parent_broker_id end
    into v_me, v_office
  from broker_profiles where user_id = auth.uid() limit 1;
  if v_me is null or v_office is null then return 0; end if;

  select coalesce(sum(c), 0) into v_count from (
    select (
      select count(*) from office_chat_messages msg
      where msg.thread_id = mem.thread_id
        and msg.sender_broker_id is distinct from v_me
        and msg.created_at > mem.last_read_at
    ) as c
    from office_chat_members mem
    join office_chat_threads th on th.id = mem.thread_id and th.office_broker_id = v_office
    where mem.broker_id = v_me
    union all
    select (
      select count(*) from office_chat_messages msg
      where msg.thread_id = gt.id
        and msg.sender_broker_id is distinct from v_me
    ) as c
    from office_chat_threads gt
    where gt.kind = 'group' and gt.office_broker_id = v_office
      and not exists (select 1 from office_chat_members m2 where m2.thread_id = gt.id and m2.broker_id = v_me)
  ) t;

  return v_count;
end;
$function$;

-- 첨부 경로 `${사무소}/${방}/uuid.ext` — 그 방을 볼 수 있는 사람만
-- 프로필 사진 `${사무소}/profiles/${broker}/uuid.ext` — 그 사무소 사람 누구나 본다
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
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(v_parts, 1), 0) >= 1 and v_parts[1] ~* v_uuid and v_parts[2] = 'profiles' then
    return public.is_office_member(v_parts[1]::uuid);
  end if;
  if coalesce(array_length(v_parts, 1), 0) < 2 or v_parts[2] !~* v_uuid then
    return false;
  end if;
  v_thread := v_parts[2]::uuid;
  return exists (
    select 1 from office_chat_threads t
    where t.id = v_thread and t.office_broker_id::text = v_parts[1]
  ) and public.can_access_office_thread(v_thread);
end;
$$;

-- 올리기는 한 단계 더 좁힌다 — 프로필 폴더는 내 broker 폴더에만
create or replace function public.can_write_office_chat_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_parts text[] := storage.foldername(p_name);
begin
  if coalesce(array_length(v_parts, 1), 0) >= 3 and v_parts[2] = 'profiles' then
    return public.can_access_office_chat_object(p_name)
       and exists (select 1 from broker_profiles me
                   where me.user_id = auth.uid() and me.id::text = v_parts[3]);
  end if;
  return public.can_access_office_chat_object(p_name);
end;
$$;

-- 모두에게서 삭제 — 보낸 사람만. 내용·첨부 경로를 비우고 지운 경로를 돌려준다(화면이 저장소에서 지운다)
create or replace function public.delete_office_chat_message(p_id uuid)
 returns text[]
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_msg office_chat_messages%rowtype;
  v_paths text[];
begin
  select m.* into v_msg from office_chat_messages m
   join broker_profiles me on me.id = m.sender_broker_id and me.user_id = auth.uid()
   where m.id = p_id and m.deleted_at is null;
  if not found then raise exception '내가 보낸 메시지만 지울 수 있어요' using errcode = '42501'; end if;

  v_paths := array_remove(coalesce(v_msg.image_paths, '{}') || v_msg.image_url || v_msg.file_url, null);

  update office_chat_messages
     set deleted_at = now(), body = '', image_url = null, image_paths = null, file_url = null, file_name = null
   where id = p_id;
  update office_chat_threads set notice_message_id = null where notice_message_id = p_id;
  delete from office_chat_reactions where message_id = p_id;
  return v_paths;
end;
$function$;

-- 공지 올리기·내리기(p_message null) — 그 방 사람 누구나(사무소 전체방 포함)
create or replace function public.set_office_chat_notice(p_thread uuid, p_message uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if not public.can_access_office_thread(p_thread) then
    raise exception '이 대화방에 공지를 올릴 수 없어요' using errcode = '42501';
  end if;
  if p_message is not null and not exists (
    select 1 from office_chat_messages where id = p_message and thread_id = p_thread and deleted_at is null
  ) then
    raise exception '이 방의 메시지가 아니에요' using errcode = '22023';
  end if;
  update office_chat_threads set notice_message_id = p_message where id = p_thread;
end;
$function$;

revoke execute on function public.delete_office_chat_message(uuid) from public, anon;
grant execute on function public.delete_office_chat_message(uuid) to authenticated, service_role;
revoke execute on function public.set_office_chat_notice(uuid, uuid) from public, anon;
grant execute on function public.set_office_chat_notice(uuid, uuid) to authenticated, service_role;
revoke all on function public.can_write_office_chat_object(text) from public, anon;
grant execute on function public.can_write_office_chat_object(text) to authenticated;

revoke execute on function public.get_or_create_dm(uuid, uuid) from public, anon;
grant execute on function public.get_or_create_dm(uuid, uuid) to authenticated, service_role;
revoke execute on function public.create_team_thread(uuid, text, uuid[]) from public, anon;
grant execute on function public.create_team_thread(uuid, text, uuid[]) to authenticated, service_role;
revoke execute on function public.office_chat_unread_count() from public, anon;
grant execute on function public.office_chat_unread_count() to authenticated, service_role;
revoke all on function public.can_access_office_chat_object(text) from public, anon;
grant execute on function public.can_access_office_chat_object(text) to authenticated;

-- 4) RLS ───────────────────────────────────────────────
alter table public.office_chat_threads enable row level security;
alter table public.office_chat_members enable row level security;
alter table public.office_chat_messages enable row level security;

drop policy if exists oct_select on public.office_chat_threads;
create policy oct_select on public.office_chat_threads
  for select using (
    public.is_office_member(office_broker_id)
    and (kind = 'group'
         or exists (select 1
                    from public.office_chat_members m
                    join public.broker_profiles me on me.id = m.broker_id
                    where m.thread_id = office_chat_threads.id
                      and me.user_id = (select auth.uid())))
  );
drop policy if exists oct_insert on public.office_chat_threads;
create policy oct_insert on public.office_chat_threads
  for insert with check (public.is_office_member(office_broker_id));
drop policy if exists oct_update on public.office_chat_threads;
create policy oct_update on public.office_chat_threads
  for update using (kind <> 'group' and public.can_access_office_thread(id));

drop policy if exists ocm_select on public.office_chat_members;
create policy ocm_select on public.office_chat_members
  for select using (public.can_access_office_thread(thread_id));
drop policy if exists ocm_insert on public.office_chat_members;
create policy ocm_insert on public.office_chat_members
  for insert with check (public.can_access_office_thread(thread_id));
drop policy if exists ocm_update on public.office_chat_members;
create policy ocm_update on public.office_chat_members
  for update using (exists (select 1 from public.broker_profiles me
    where me.user_id = (select auth.uid()) and me.id = office_chat_members.broker_id));
drop policy if exists ocm_delete on public.office_chat_members;
create policy ocm_delete on public.office_chat_members
  for delete using (exists (select 1 from public.broker_profiles me
    where me.user_id = (select auth.uid()) and me.id = office_chat_members.broker_id));

drop policy if exists ocmsg_select on public.office_chat_messages;
create policy ocmsg_select on public.office_chat_messages
  for select using (public.can_access_office_thread(thread_id));
drop policy if exists ocmsg_insert on public.office_chat_messages;
create policy ocmsg_insert on public.office_chat_messages
  for insert with check (public.can_access_office_thread(thread_id)
    and exists (select 1 from public.broker_profiles me
      where me.user_id = (select auth.uid()) and me.id = office_chat_messages.sender_broker_id));
-- 메시지 지우기는 delete_office_chat_message 로만 한다(행은 남기고 '삭제된 메시지'). 직접 delete·update 정책은 두지 않는다
drop policy if exists ocmsg_delete on public.office_chat_messages;

alter table public.office_chat_reactions enable row level security;
alter table public.office_chat_profiles enable row level security;

drop policy if exists ocr_select on public.office_chat_reactions;
create policy ocr_select on public.office_chat_reactions
  for select using (exists (select 1 from public.office_chat_messages m
    where m.id = office_chat_reactions.message_id and public.can_access_office_thread(m.thread_id)));
drop policy if exists ocr_insert on public.office_chat_reactions;
create policy ocr_insert on public.office_chat_reactions
  for insert with check (
    exists (select 1 from public.broker_profiles me
      where me.user_id = (select auth.uid()) and me.id = office_chat_reactions.broker_id)
    and exists (select 1 from public.office_chat_messages m
      where m.id = office_chat_reactions.message_id and m.deleted_at is null
        and public.can_access_office_thread(m.thread_id)));
drop policy if exists ocr_delete on public.office_chat_reactions;
create policy ocr_delete on public.office_chat_reactions
  for delete using (exists (select 1 from public.broker_profiles me
    where me.user_id = (select auth.uid()) and me.id = office_chat_reactions.broker_id));

-- 프로필은 같은 사무소 사람이 보고, 고치는 건 본인만
drop policy if exists ocp_select on public.office_chat_profiles;
create policy ocp_select on public.office_chat_profiles
  for select using (exists (select 1 from public.broker_profiles bp
    where bp.id = office_chat_profiles.broker_id
      and public.is_office_member(coalesce(bp.parent_broker_id, bp.id))));
drop policy if exists ocp_insert on public.office_chat_profiles;
create policy ocp_insert on public.office_chat_profiles
  for insert with check (exists (select 1 from public.broker_profiles me
    where me.user_id = (select auth.uid()) and me.id = office_chat_profiles.broker_id));
drop policy if exists ocp_update on public.office_chat_profiles;
create policy ocp_update on public.office_chat_profiles
  for update using (exists (select 1 from public.broker_profiles me
    where me.user_id = (select auth.uid()) and me.id = office_chat_profiles.broker_id));

-- 5) 첨부 저장소 권한 (버킷 office-chat-images 는 비공개로 남아 있다) ──────
drop policy if exists office_chat_img_select on storage.objects;
create policy office_chat_img_select on storage.objects for select to authenticated
  using (bucket_id = 'office-chat-images' and public.can_access_office_chat_object(name));
drop policy if exists office_chat_img_insert on storage.objects;
create policy office_chat_img_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'office-chat-images' and public.can_write_office_chat_object(name));
drop policy if exists office_chat_img_delete on storage.objects;
create policy office_chat_img_delete on storage.objects for delete to authenticated
  using (bucket_id = 'office-chat-images' and owner_id = (select auth.uid())::text);

-- 6) 실시간 — 새 메시지·삭제·읽음 표시·공감·공지 ─────────────────
alter publication supabase_realtime add table public.office_chat_messages;
alter publication supabase_realtime add table public.office_chat_members;
alter publication supabase_realtime add table public.office_chat_reactions;
alter publication supabase_realtime add table public.office_chat_threads;
-- 공감을 뗄 때 오는 옛 행은 기본키(message_id·broker_id·emoji)뿐인데 그게 행 전부라 replica identity 를 바꿀 필요가 없다
