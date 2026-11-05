-- 2026-11-05 메신저 방 열기 한 번에 (사장님 "방 열 때도 빠르게")
-- 전에는 메세지 → 공감·읽음 → 답장 원본·공지 를 차례로 물어 왕복이 세 번 쌓였다.
-- SECURITY INVOKER: 부르는 사람의 RLS 그대로(방에 들어갈 수 있는 사람만 보인다).
create or replace function public.office_chat_room_open(p_thread uuid, p_limit integer default 100)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_msgs jsonb;
  v_ids uuid[];
  v_need uuid[];
begin
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'), coalesce(array_agg(m.id), '{}')
    into v_msgs, v_ids
  from (select * from office_chat_messages x where x.thread_id = p_thread
        order by x.created_at desc limit least(greatest(p_limit, 1), 200)) m;

  -- 화면 밖 답장 원본 + 방 공지
  select coalesce(array_agg(distinct i), '{}') into v_need from (
    select x.reply_to_id as i from office_chat_messages x where x.id = any(v_ids) and x.reply_to_id is not null
    union
    select t.notice_message_id from office_chat_threads t where t.id = p_thread and t.notice_message_id is not null
  ) z where not (i = any(v_ids));

  return jsonb_build_object(
    'messages', v_msgs,
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('message_id', r.message_id, 'broker_id', r.broker_id, 'emoji', r.emoji)), '[]')
                  from office_chat_reactions r where r.message_id = any(v_ids)),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('broker_id', mm.broker_id, 'last_read_at', mm.last_read_at)), '[]')
                from office_chat_members mm where mm.thread_id = p_thread),
    'extra', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from office_chat_messages x where x.id = any(v_need))
  );
end;
$$;

revoke execute on function public.office_chat_room_open(uuid, integer) from public, anon;
grant  execute on function public.office_chat_room_open(uuid, integer) to authenticated, service_role;
