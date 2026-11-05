-- 2026-11-05 폰 속도 — 여러 번 묻던 것을 한 번에 (사장님 "느리면 절대 안 된다")
-- 둘 다 SECURITY INVOKER: 부르는 사람의 RLS 가 그대로 걸린다(직원은 원래 보던 것만).

-- 1) 메신저 목록: 방 + 내 읽음/고정/알림 + 마지막 메세지 + 안 읽은 수.
--    전에는 방마다 2번씩(방 5개면 10번) 물었다.
create or replace function public.office_chat_thread_list(p_office uuid, p_me uuid)
returns table (thread jsonb, my jsonb, last jsonb, unread integer)
language sql
stable
security invoker
set search_path = public
as $$
  select to_jsonb(t) as thread,
         case when m.thread_id is null then null
              else jsonb_build_object('last_read_at', m.last_read_at, 'pinned_at', m.pinned_at, 'muted', m.muted) end as my,
         l.last,
         (select count(*)::int from office_chat_messages x
           where x.thread_id = t.id
             and x.sender_broker_id is distinct from p_me
             and (m.last_read_at is null or x.created_at > m.last_read_at)) as unread
  from office_chat_threads t
  left join office_chat_members m on m.thread_id = t.id and m.broker_id = p_me
  left join lateral (
    select jsonb_build_object('id', x.id, 'body', x.body, 'image_url', x.image_url, 'image_paths', x.image_paths,
                              'file_url', x.file_url, 'file_name', x.file_name, 'deleted_at', x.deleted_at,
                              'created_at', x.created_at) as last
    from office_chat_messages x
    where x.thread_id = t.id
    order by x.created_at desc
    limit 1
  ) l on true
  where t.office_broker_id = p_office;
$$;

-- 2) 광고 현황판: 사람마다 매물 전체·거래가능·오늘 등록 수.
--    전에는 사람마다 2번 + 전체 2번 + 오늘 1번(직원 7명이면 17번) 물었다.
create or replace function public.office_board_counts(p_office uuid)
returns table (broker_id uuid, total integer, avail integer, today integer)
language sql
stable
security invoker
set search_path = public
as $$
  select p.broker_id,
         count(*)::int,
         count(*) filter (where p.status = 'available')::int,
         count(*) filter (where p.created_at >= ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul'))::int
  from broker_properties p
  where p.office_broker_id = p_office and p.deleted_at is null
  group by p.broker_id;
$$;

revoke execute on function public.office_chat_thread_list(uuid, uuid) from public, anon;
revoke execute on function public.office_board_counts(uuid)           from public, anon;
grant  execute on function public.office_chat_thread_list(uuid, uuid) to authenticated, service_role;
grant  execute on function public.office_board_counts(uuid)           to authenticated, service_role;
