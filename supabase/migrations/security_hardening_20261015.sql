-- 보안 점검(2026-10-15): RLS 를 건너뛰는 SECURITY DEFINER 함수 36개 감사에서 확인된 구멍을 막는다.
-- 함수·정책은 PostgREST 로 아무 인자나 넣어 부를 수 있으므로, 앱이 부르는 모양만 믿으면 안 된다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 근본 원인: 누구나 자기 broker_profiles 를 고쳐 '남의 사무소 승인 직원' 이 될 수 있었다
--    broker_profiles_update 정책은 본인 행이면 WITH CHECK 없이 통과하고, authenticated 에
--    parent_broker_id·is_approved·is_owner·permissions UPDATE/INSERT 권한이 있었다(is_approved
--    기본값 true). 고객도 POST 한 번으로 메인 사무소 고객 867명·매물 1,979건을 읽을 수 있었다.
--    my_visible_broker_ids·can_view_broker_property·can_manage_office_ads·is_office_member 가
--    모두 이 칸들을 믿으므로 여기서 막는다.
--    정상 경로: 대표 신규 등록(INSERT, 소속 없음), 대표의 직원 승인, 직원 본인의 사무소 탈퇴
--    (소속 해제). 합류(join_office_by_code)·퇴사 처리(remove_employee_from_office 등)는
--    SECURITY DEFINER 함수라 current_user 가 함수 주인이어서 통과한다. 자동 인증은 service_role.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.guard_broker_profile_privileged()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_admin_user() then return new; end if;

  if tg_op = 'INSERT' then
    -- 직접 넣을 수 있는 건 내 사무소(대표) 등록뿐. 직원 합류는 join_office_by_code 로만.
    if new.parent_broker_id is not null then
      raise exception '권한 없음: 사무소 합류는 사무소 코드로만 할 수 있습니다' using errcode = '42501';
    end if;
    -- permissions 기본값이 '{}' 라 NULL 로 막으면 대표 등록이 깨진다 → 기본값으로 고정
    new.permissions := '{}'::jsonb;
    new.is_verified := false;   -- 인증 배지는 자동 인증(service_role)·관리자만
    return new;
  end if;

  if new.user_id is distinct from old.user_id or new.is_owner is distinct from old.is_owner then
    raise exception '권한 없음: user_id·is_owner 는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  -- 사무소 연결은 끊기(NULL)만
  if new.parent_broker_id is distinct from old.parent_broker_id and new.parent_broker_id is not null then
    raise exception '권한 없음: 소속 사무소는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  -- 승인·권한은 소속 사무소 대표만. 예외: 본인이 사무소를 떠나며 내리는 경우
  if (new.is_approved is distinct from old.is_approved or new.permissions is distinct from old.permissions)
     and not (old.parent_broker_id is not null and exists (
           select 1 from public.broker_profiles o
           where o.id = old.parent_broker_id and o.user_id = v_uid and o.is_owner = true))
     and not (new.parent_broker_id is null and coalesce(new.is_approved, false) = false and new.permissions is null)
  then
    raise exception '권한 없음: 승인·권한은 사무소 대표만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_broker_profile_privileged on public.broker_profiles;
create trigger trg_guard_broker_profile_privileged
  before insert or update on public.broker_profiles
  for each row execute function public.guard_broker_profile_privileged();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 사내 메신저: 퇴사자·승인 전 직원이 옛 사무소 대화를 계속 읽고 썼다
--    멤버 행은 퇴사해도 안 지워지고, 사무소 전체방 조건은 is_approved 를 안 봤다.
--    이제 '지금 그 사무소 소속(승인)' 이어야 한다.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- 새 행의 칸만으로 판정해야 사무소 전체방을 만들 때의 insert(...).select() 가 계속 통과한다
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
  -- 대표면 내 사무소, 직원이면 승인된 경우에만 소속 사무소. 아니면 셀 대화가 없다.
  select id,
         case when parent_broker_id is null and is_owner is not false then id
              when parent_broker_id is not null and is_approved then parent_broker_id end
    into v_me, v_office
  from broker_profiles where user_id = auth.uid() limit 1;
  if v_me is null or v_office is null then return 0; end if;

  select coalesce(sum(c), 0) into v_count from (
    -- 내가 멤버인 방(dm/team + 읽은 group) — 지금 사무소 것만
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
    -- 아직 한 번도 안 본 사무소 전체방
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 연락처: 가짜 채팅방 하나로 아무 회원의 이메일·휴대폰을 읽을 수 있었다
--    profiles_visible 이 can_notify_user 로 연락처를 보일지 정한다. 채팅방은 아무 상대로나
--    만들 수 있었고, 같은 사무소 조건은 승인 여부를 안 봤다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.can_notify_user(p_target_user_id uuid)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  select exists (
    -- 1) 같은 채팅방 — 방 당사자가 실제 제안의 중개사·의뢰인일 때만
    select 1
    from public.chat_rooms cr
    join public.proposals p        on p.id = cr.proposal_id and p.request_id = cr.request_id
    join public.broker_profiles bp on bp.id = p.broker_id and bp.user_id = cr.broker_id
    join public.request_posts rp   on rp.id = p.request_id and rp.user_id = cr.user_id
    where (cr.user_id = auth.uid() and cr.broker_id = p_target_user_id)
       or (cr.broker_id = auth.uid() and cr.user_id = p_target_user_id)
  ) or exists (
    -- 2) 같은 사무소. 호출자는 대표 또는 승인 직원. 대상은 대표·승인 직원,
    --    또는 내가 대표인 사무소의 승인 대기자(팀 화면에서 지원자 확인용).
    select 1
    from public.broker_profiles bp1
    join public.broker_profiles bp2
      on coalesce(bp1.parent_broker_id, bp1.id) = coalesce(bp2.parent_broker_id, bp2.id)
    where bp1.user_id = auth.uid()
      and bp2.user_id = p_target_user_id
      and (bp1.parent_broker_id is null or bp1.is_approved = true)
      and (bp2.parent_broker_id is null or bp2.is_approved = true or bp2.parent_broker_id = bp1.id)
  ) or exists (
    -- 3) 제안으로 연결 (중개사 ↔ 의뢰인)
    select 1
    from public.proposals p
    join public.broker_profiles bp on bp.id = p.broker_id
    join public.request_posts rp on rp.id = p.request_id
    where (bp.user_id = auth.uid() and rp.user_id = p_target_user_id)
       or (rp.user_id = auth.uid() and bp.user_id = p_target_user_id)
  );
$function$;

-- 채팅방은 실제 제안의 두 당사자 사이에서만 만든다 (앱은 늘 제안 정보로 만든다)
alter policy chatroom_insert on public.chat_rooms
  with check (
    ((select auth.uid()) = user_id or (select auth.uid()) = broker_id)
    and exists (
      select 1
      from public.proposals p
      join public.broker_profiles bp on bp.id = p.broker_id
      join public.request_posts rp on rp.id = p.request_id
      where p.id = chat_rooms.proposal_id
        and p.request_id = chat_rooms.request_id
        and bp.user_id = chat_rooms.broker_id
        and rp.user_id = chat_rooms.user_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 업무일지: 내 일지에 남의 사무소 고객을 연결한 뒤 조회하면 그 고객 정보가 나왔다
--    (FK 검사는 RLS 를 안 탄다). 읽을 때 고객 주인도 확인하고, 연결할 때도 막는다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.diary_customers_for_date(p_broker_id uuid, p_date date)
 returns table(link_id uuid, sort_order integer, proposed_property_ids uuid[], id uuid, client_name text, contact text, received_date date, assignee text, category text, source text, status text, request text, interest text, consult_note text, custom_fields jsonb, is_deleted boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select dc.id, dc.sort_order, coalesce(dc.proposed_property_ids, '{}'::uuid[]),
         c.id, c.client_name, c.contact, c.received_date, c.assignee, c.category, c.source,
         c.status, c.request, c.interest, c.consult_note, c.custom_fields,
         (c.deleted_at is not null)
  from broker_diary_customers dc
  join broker_customers c on c.id = dc.customer_id
  where dc.broker_id = p_broker_id
    and dc.diary_date = p_date
    and public.can_view_broker_data(p_broker_id)
    and public.can_view_broker_data(c.broker_id)   -- 고객 자체를 볼 권한도
  order by dc.sort_order;
$function$;
revoke all on function public.diary_customers_for_date(uuid, date) from public, anon;
grant execute on function public.diary_customers_for_date(uuid, date) to authenticated;

create or replace function public.trg_diary_customer_same_scope()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $$
begin
  if auth.uid() is not null
     and not public.can_view_broker_data((select broker_id from broker_customers where id = new.customer_id)) then
    raise exception '권한 없음: 볼 수 없는 고객은 일지에 연결할 수 없습니다' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists diary_customer_same_scope on public.broker_diary_customers;
create trigger diary_customer_same_scope
  before insert or update of customer_id on public.broker_diary_customers
  for each row execute function public.trg_diary_customer_same_scope();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) 휴지통: 담당자를 '이름 글자' 로, 사무소를 본인이 고칠 수 있는 칸으로 판정했다
--    이름을 바꾸면 남의 휴지통을 보고·되살리고·영구삭제할 수 있었다. 담당자는 ID(assignee_ids)로,
--    승인된 같은 사무소 구성원만. 대상 건수는 바뀌기 전과 같은 것을 확인했다(27/0/2/10/1).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.can_manage_trash_row(p_broker_id uuid, p_assignee_ids uuid[])
 returns boolean
 language sql
 stable security definer
 set search_path = public, pg_temp
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or exists (
        select 1
        from broker_profiles me
        join broker_profiles target on target.id = p_broker_id
        where me.user_id = auth.uid()
          and me.is_approved is true
          and (
                target.id = me.id                                  -- 본인 것
             or (me.is_owner and target.parent_broker_id = me.id)  -- 대표 → 소속 직원 것
             or (me.id = any (p_assignee_ids)                      -- 담당자(ID)
                 and coalesce(target.parent_broker_id, target.id) = coalesce(me.parent_broker_id, me.id))
          )
      );
$$;
revoke execute on function public.can_manage_trash_row(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.get_trash_customers()
 returns setof broker_customers
 language sql
 security definer
 set search_path = public
as $$
  select c.* from broker_customers c
  where c.deleted_at is not null
    and public.can_manage_trash_row(c.broker_id, c.assignee_ids)
  order by c.deleted_at desc;
$$;

create or replace function public.get_trash_properties()
 returns setof broker_properties
 language sql
 security definer
 set search_path = public
as $$
  select pr.* from broker_properties pr
  where pr.deleted_at is not null
    and public.can_manage_trash_row(pr.broker_id, pr.assignee_ids)
  order by pr.deleted_at desc;
$$;

create or replace function public.purge_customer(cust_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and not exists (select 1 from broker_profiles
                     where user_id = auth.uid() and is_owner and is_approved is true) then
    raise exception '권한 없음: 영구 삭제는 사무소 대표만 할 수 있습니다';
  end if;
  if not exists (
    select 1 from broker_customers c
    where c.id = cust_id and c.deleted_at is not null
      and public.can_manage_trash_row(c.broker_id, c.assignee_ids)
  ) then
    raise exception 'unauthorized or not found';
  end if;
  delete from broker_customers where id = cust_id and deleted_at is not null;
end;
$$;

create or replace function public.purge_property(prop_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and not exists (select 1 from broker_profiles
                     where user_id = auth.uid() and is_owner and is_approved is true) then
    raise exception '권한 없음: 영구 삭제는 사무소 대표만 할 수 있습니다';
  end if;
  if not exists (
    select 1 from broker_properties pr
    where pr.id = prop_id and pr.deleted_at is not null
      and public.can_manage_trash_row(pr.broker_id, pr.assignee_ids)
  ) then
    raise exception 'unauthorized or not found';
  end if;
  delete from broker_properties where id = prop_id and deleted_at is not null;
end;
$$;

create or replace function public.restore_customer(cust_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $$
begin
  if not exists (
    select 1 from broker_customers c
    where c.id = cust_id and c.deleted_at is not null
      and public.can_manage_trash_row(c.broker_id, c.assignee_ids)
  ) then
    raise exception 'unauthorized or not found';
  end if;
  update broker_customers set deleted_at = null where id = cust_id;
end;
$$;

create or replace function public.restore_property(prop_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public
as $$
begin
  if not exists (
    select 1 from broker_properties pr
    where pr.id = prop_id and pr.deleted_at is not null
      and public.can_manage_trash_row(pr.broker_id, pr.assignee_ids)
  ) then
    raise exception 'unauthorized or not found';
  end if;
  update broker_properties set deleted_at = null where id = prop_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) 데이터 이전(퇴사·탈퇴): 소속을 위조해 남의 사무소로 가짜 기록을 밀어 넣을 수 있었다
--    from 은 승인된 직원이어야 하고, 승인 전 신청자는 넘길 것이 없어 조용히 끝낸다.
--    채팅방 broker_id 는 사용자 id(profiles)인데 사무소 id 로 찾고 있어 한 번도 안 넘어갔다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.transfer_broker_data(from_broker_id uuid, to_broker_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  departing_name text;
  owner_name text;
  caller_broker_id uuid;
  from_parent uuid;
  from_approved boolean;
  from_user uuid;
  to_user uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized: not authenticated'; end if;
  select id into caller_broker_id from broker_profiles where user_id = auth.uid() limit 1;
  if caller_broker_id is null then raise exception 'unauthorized: no broker profile'; end if;

  -- from 은 어떤 사무소의 직원이어야 한다(대표 자기 자신 → 자기 자신 금지)
  select parent_broker_id, is_approved, user_id into from_parent, from_approved, from_user
  from broker_profiles where id = from_broker_id;
  if from_parent is null then raise exception 'invalid: from_broker_id is not an office employee'; end if;
  if caller_broker_id <> from_broker_id and caller_broker_id <> from_parent then
    raise exception 'unauthorized: caller is neither the broker nor their office owner';
  end if;
  if to_broker_id <> from_parent then raise exception 'unauthorized: target must be the office owner'; end if;
  -- 승인 전 신청자는 사무소로 넘길 기록이 없다 → 탈퇴 흐름이 막히지 않게 조용히 끝낸다
  if from_approved is not true then return; end if;
  select user_id into to_user from broker_profiles where id = to_broker_id;

  set local session_replication_role = 'replica';

  select p.name into departing_name from broker_profiles b left join profiles p on p.id = b.user_id where b.id = from_broker_id;
  select p.name into owner_name from broker_profiles b left join profiles p on p.id = b.user_id where b.id = to_broker_id;

  insert into broker_diary_archive (
    office_broker_id, author_broker_id, author_name,
    date, title, content, work_summary, ad_status, suggestions, delivery_notes, sections_content,
    original_created_at, original_updated_at
  )
  select to_broker_id, from_broker_id, departing_name,
    date, title, content, work_summary, ad_status, suggestions, delivery_notes, sections_content,
    created_at, updated_at
  from broker_diary where broker_id = from_broker_id;
  delete from broker_diary where broker_id = from_broker_id;

  insert into broker_diary_customers_archive (
    office_broker_id, author_broker_id, author_name,
    diary_date, customer_id, customer_name, customer_contact, sort_order, proposed_property_ids
  )
  select to_broker_id, from_broker_id, departing_name,
    dc.diary_date, dc.customer_id, c.client_name, c.contact, dc.sort_order, dc.proposed_property_ids
  from broker_diary_customers dc
  left join broker_customers c on c.id = dc.customer_id
  where dc.broker_id = from_broker_id;
  delete from broker_diary_customers where broker_id = from_broker_id;

  update broker_customers  set broker_id = to_broker_id where broker_id = from_broker_id;
  update broker_properties set broker_id = to_broker_id where broker_id = from_broker_id;
  -- chat_rooms.broker_id 는 profiles(id) — 사용자 id 로 옮긴다
  update chat_rooms        set broker_id = to_user      where broker_id = from_user and to_user is not null;
  update proposals         set broker_id = to_broker_id where broker_id = from_broker_id;
  update reviews           set broker_id = to_broker_id where broker_id = from_broker_id;

  if departing_name is not null and owner_name is not null and departing_name <> owner_name then
    update broker_customers set assignee = departing_name || ', ' || owner_name
      where broker_id = to_broker_id and assignee = departing_name;
    update broker_properties set assignee = departing_name || ', ' || owner_name
      where broker_id = to_broker_id and assignee = departing_name;
  end if;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) 낮은 위험: 남의 id 를 넣어 경쟁 중개사의 제안 이력을 추정, 승인된 직원을 '신청 거절' 로 삭제
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.recommend_requests_for_broker(p_broker_id uuid, p_limit integer default 20)
 returns table(request_id uuid, city text, district text, dong text, deal_type text, room_type text, min_price bigint, max_price bigint, proposal_count integer, created_at timestamp with time zone, score integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with me as (
    select id, user_id, alert_regions, is_verified, rating from public.broker_profiles
    where id = p_broker_id and user_id = auth.uid()   -- 본인 broker 행만
  )
  select rp.id, rp.city, rp.district, rp.dong, rp.deal_type, rp.room_type, rp.min_price, rp.max_price, rp.proposal_count, rp.created_at,
    (case
       when exists (select 1 from jsonb_array_elements((select alert_regions from me)) ar where ar->>'sido' = rp.city and ar->>'sigungu' = rp.district and (ar->>'dong' = rp.dong or (ar->>'dong') is null)) then 30
       when exists (select 1 from jsonb_array_elements((select alert_regions from me)) ar where ar->>'sido' = rp.city and ar->>'sigungu' = rp.district) then 15
       when exists (select 1 from jsonb_array_elements((select alert_regions from me)) ar where ar->>'sido' = rp.city) then 5
       else 0 end
     + case when rp.created_at > now() - interval '1 day' then 5 when rp.created_at > now() - interval '7 days' then 3 else 0 end
     + case when rp.proposal_count = 0 then 5 when rp.proposal_count < 3 then 2 else 0 end
    )::int as score
  from public.request_posts rp, me
  where rp.status = 'active' and rp.closed_at is null
    and (rp.expires_at is null or rp.expires_at > now())
    and rp.is_co_broker is not true
    and rp.user_id is distinct from me.user_id
    and exists (select 1 from jsonb_array_elements(me.alert_regions) ar where ar->>'sido' = rp.city)
    and not exists (select 1 from public.proposals p where p.broker_id = p_broker_id and p.request_id = rp.id)
  order by score desc, rp.created_at desc
  limit greatest(least(p_limit, 100), 1);
$function$;

create or replace function public.recommend_brokers_for_request(p_request_id uuid, p_limit integer default 20)
 returns table(broker_id uuid, user_id uuid, office_name text, score integer, region_score integer, activity_score integer, rating_score integer, verified_bonus integer)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with req as (
    select id, user_id, city, district, dong from public.request_posts
    where id = p_request_id
      and (user_id = auth.uid()
           or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))   -- 요청 작성자(또는 관리자)만
  ),
  scored as (
    select bp.id as broker_id, bp.user_id, bp.office_name,
      case
        when exists (select 1 from jsonb_array_elements(bp.alert_regions) ar, req r where ar->>'sido' = r.city and ar->>'sigungu' = r.district and (ar->>'dong' = r.dong or (ar->>'dong') is null)) then 30
        when exists (select 1 from jsonb_array_elements(bp.alert_regions) ar, req r where ar->>'sido' = r.city and ar->>'sigungu' = r.district) then 15
        when exists (select 1 from jsonb_array_elements(bp.alert_regions) ar, req r where ar->>'sido' = r.city) then 5
        else 0 end as region_score,
      least(10, (select count(*)::int from public.proposals p where p.broker_id = bp.id and p.created_at > now() - interval '30 days')) as activity_score,
      least(10, coalesce(bp.rating, 0)::int * 2) as rating_score,
      case when bp.is_verified then 5 else 0 end as verified_bonus
    from public.broker_profiles bp, req r
    where bp.is_approved = true and bp.is_owner = true
      and bp.user_id is distinct from r.user_id
  )
  select broker_id, user_id, office_name,
         (region_score + activity_score + rating_score + verified_bonus) as score,
         region_score, activity_score, rating_score, verified_bonus
  from scored
  order by score desc, rating_score desc
  limit greatest(least(p_limit, 100), 1);
$function$;

create or replace function public.reject_employee_application(emp_broker_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  my_broker_id uuid;
begin
  select id into my_broker_id from broker_profiles
  where user_id = auth.uid() and is_owner = true limit 1;
  if my_broker_id is null then
    raise exception 'unauthorized: no owner broker profile found';
  end if;
  -- '신청 거절' 은 승인 대기자만. 승인된 직원을 지우면 영업 기록이 이전 없이 CASCADE 로 사라진다
  if not exists (
    select 1 from broker_profiles
    where id = emp_broker_id and parent_broker_id = my_broker_id and is_approved = false
  ) then
    raise exception 'unauthorized: no pending application in your office';
  end if;
  delete from broker_profiles where id = emp_broker_id and is_approved = false;
end;
$function$;

-- 보고서 공유: 작성자가 앱에서 볼 수 있는 매물만 (남의 매물 열람이 막힌 직원이 보고서로 우회 못 하게)
create or replace function public.get_shared_report(p_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  r record;
  office_name_v text;
  props jsonb;
begin
  select * into r from shared_reports where id = p_id and expires_at > now();
  if not found then return null; end if;

  update shared_reports
  set viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
  where id = p_id;

  select bp.office_name into office_name_v from broker_profiles bp where bp.id = r.office_broker_id;

  select coalesce(jsonb_agg(x.item order by x.ord), '[]'::jsonb) into props
  from (
    select ord, jsonb_build_object(
      'seq_no', p.seq_no,
      'deal_type', p.deal_type,
      'room_type', p.room_type,
      'region', nullif(btrim(regexp_replace(coalesce(p.address,''), '[0-9].*$', '')), ''),
      'price', p.price,
      'monthly_rent', p.monthly_rent,
      'management_fee', p.management_fee,
      'premium', p.premium,
      'size_pyeong', p.size_pyeong,
      'area_supplied', p.area_supplied,
      'area_type', p.area_type,
      'area_unit', p.area_unit,
      'floor', p.floor,
      'total_floors', p.total_floors,
      'options', p.options,
      'images', p.images,
      'move_in_date', p.move_in_date,
      'rooms_bathrooms', p.rooms_bathrooms,
      'direction', p.direction,
      'parking', p.parking,
      'approval_date', p.approval_date,
      'status', p.status
    ) as item
    from unnest(r.property_ids) with ordinality as t(pid, ord)
    join broker_properties p on p.id = t.pid
    join broker_profiles cb on cb.id = r.created_by
    where p.deleted_at is null and p.office_broker_id = r.office_broker_id
      and (cb.is_owner = true or p.broker_id = cb.id
           or (cb.permissions->>'can_see_others') is distinct from 'false')
  ) x;

  return jsonb_build_object(
    'title', r.title,
    'office_name', office_name_v,
    'created_at', r.created_at,
    'properties', props
  );
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) 호출 제한: 창 길이를 0·음수로 주면 기록이 지워져 제한이 풀렸다. 인자 범위를 막는다.
--    (남의 버킷 채우기는 앱을 service_role 로 옮긴 뒤 EXECUTE 를 회수해 막는다 — 별도 배포)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.rate_limit_check(p_bucket text, p_max integer, p_window_seconds integer)
 returns boolean
 language plpgsql
 security definer
 set search_path = public
as $$
declare v_count int;
begin
  if p_bucket is null or length(p_bucket) > 200
     or p_max is null or p_max not between 1 and 1000
     or p_window_seconds is null or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid rate limit args' using errcode = '22023';
  end if;
  delete from api_rate_limit where bucket = p_bucket and ts < now() - interval '1 day';
  select count(*) into v_count from api_rate_limit
   where bucket = p_bucket and ts > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_max then return false; end if;
  insert into api_rate_limit(bucket) values (p_bucket);
  return true;
end $$;
