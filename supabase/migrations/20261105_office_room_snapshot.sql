-- 2026-11-05 사무실 화면(/broker/office) 한 번에 불러오기 (사장님 "사무실 화면도 고쳐")
-- 화면이 20초마다 15가지를 따로 물어 폰에서 2~3초 걸렸다. 같은 조건을 한 번에 돌려준다.
-- SECURITY INVOKER: 부르는 사람의 RLS 그대로(직원은 원래 보던 것만). 날짜는 한국 기준.
create or replace function public.office_room_snapshot(p_office uuid, p_owner boolean)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
-- 날짜는 변수로 둔다. 처음엔 with k as (...) 를 표처럼 붙였더니(from x, k where x.t >= k.since)
-- 색인을 못 써 큰 표를 통째로 훑어 1.8초 걸렸다 — 조각마다는 합쳐 0.07초(2026-11-05)
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_since timestamptz := ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul');
  v_day timestamptz := now() - interval '24 hours';
  v_prefix text := to_char((now() at time zone 'Asia/Seoul')::date, 'YY.MM.DD');
begin
  return jsonb_build_object(
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', b.id, 'user_id', b.user_id, 'is_owner', b.is_owner, 'is_approved', b.is_approved,
                  'profiles', case when pv.id is null then null else jsonb_build_object('name', pv.name) end)), '[]')
                from broker_profiles b left join profiles_visible pv on pv.id = b.user_id
                where b.id = p_office or b.parent_broker_id = p_office),
    'todayProps', (select coalesce(jsonb_agg(jsonb_build_object('broker_id', p.broker_id)), '[]')
                from broker_properties p
                where p.office_broker_id = p_office and p.deleted_at is null and p.created_at >= v_since),
    'sessions', case when p_owner then (select coalesce(jsonb_agg(to_jsonb(s) order by s.updated_at desc), '[]') from (
                  select c.session_id, c.project, c.title, c.status, c.last_action, c.order_id, c.updated_at
                  from claude_sessions c
                  where c.office_broker_id = p_office and c.updated_at >= v_day
                  order by c.updated_at desc limit 20) s) end,
    'diaries', (select coalesce(jsonb_agg(jsonb_build_object('broker_id', d.broker_id, 'sections_content', d.sections_content,
                  'work_summary', d.work_summary, 'content', d.content, 'updated_at', d.updated_at)), '[]')
                from broker_diary d where d.date = v_today),
    'bidRun', case when p_owner then (select s.value from bid_sync s where s.key = 'last_run') end,
    'agents', (select to_jsonb(a) from ad_agents a where a.broker_id = p_office limit 1),
    'adJobs', (select coalesce(jsonb_agg(to_jsonb(j) order by j.requested_at desc), '[]') from (
                  select x.id, x.kind, x.status, x.params, x.progress, x.error, x.requested_at, x.finished_at, x.requested_by
                  from ad_jobs x
                  where x.broker_id = p_office and (x.status in ('queued', 'running') or x.requested_at >= v_day)
                  order by x.requested_at desc limit 40) j),
    'bankJobs', (select coalesce(jsonb_agg(to_jsonb(j) order by j.requested_at desc), '[]') from (
                  select x.id, x.property_id, x.status, x.progress, x.error, x.requested_at, x.finished_at, x.requested_by,
                         (select jsonb_build_object('address', bp.address) from broker_properties bp where bp.id = x.property_id) as broker_properties
                  from bank_draft_jobs x
                  where x.office_broker_id = p_office and (x.status in ('queued', 'running') or x.requested_at >= v_day)
                  order by x.requested_at desc limit 20) j),
    'postsByChannel', (select coalesce(jsonb_object_agg(channel, n), '{}') from (
                  select ap.channel, count(*) as n from ad_posts ap where ap.posted_at >= v_since group by ap.channel) c),
    'naverToday', (select count(*) from naver_articles n where n.first_seen_at >= v_since),
    'daangnToday', (select count(*) from daangn_articles n where n.first_seen_at >= v_since),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]') from (
                  select x.id, x.assignee_broker_id, x.title, x.note, x.due_date, x.status, x.created_at, x.done_at
                  from office_tasks x
                  where x.office_broker_id = p_office and (x.status = 'open' or x.done_at >= v_day)
                  order by x.created_at desc limit 100) t),
    'consult', (select coalesce(jsonb_agg(jsonb_build_object('assignee_ids', c.assignee_ids)), '[]')
                from broker_customers c
                where c.office_broker_id = p_office and c.deleted_at is null and c.created_at >= v_since),
    'bankToday', (select coalesce(jsonb_agg(jsonb_build_object('manager', l.manager)), '[]')
                from ad_listings l
                where l.broker_id = p_office and l.bank_tab = '등록매물' and l.bank_period like v_prefix || '%'),
    'daangnPosts', (select coalesce(jsonb_agg(jsonb_build_object('ad_listings', jsonb_build_object('manager', l.manager, 'broker_id', l.broker_id))), '[]')
                from ad_posts ap join ad_listings l on l.id = ap.listing_id
                where l.broker_id = p_office and ap.channel = 'daangn' and ap.status = 'posted' and ap.posted_at >= v_since)
  );
end;
$$;

revoke execute on function public.office_room_snapshot(uuid, boolean) from public, anon;
grant  execute on function public.office_room_snapshot(uuid, boolean) to authenticated, service_role;
