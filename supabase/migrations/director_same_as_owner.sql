-- 이사 = 대표와 같은 권한 (2026-11-05 사장님: "이사도 대표와 같은 권한을 줘, 일부러 막을 건 없어")
--
-- 이사는 broker_profiles.permissions->>'grade' = 'director' 인 승인된 직원.
-- 설정 › 직원 화면에서 대표가 고른다(그 값은 guard_broker_profile_privileged 가 대표만 바꾸게 막는다).
--
-- 대표만 남기는 것(이사에게 열지 않음):
--   직원 승인·거절·내보내기, 등급(권한) 바꾸기, 사무소 코드 — 이사가 스스로 등급을 올리거나
--   사람을 들이는 길이 생기면 안 된다. broker_profiles_update / guard / reject / remove /
--   regenerate_office_code / my_office_code 는 그대로 둔다.

-- 0) 내가 이 사무소의 이사인가
create or replace function public.is_office_director(p_office uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from public.broker_profiles me
    where me.user_id = auth.uid()
      and me.parent_broker_id = p_office
      and me.is_approved is true
      and me.permissions->>'grade' = 'director'
  )
$$;

-- 1) is_office_owner — 할 일(office_tasks·guard), Claude 지시(claude_orders/sessions), 광고현황 메모 쓰기가 이걸 본다
create or replace function public.is_office_owner(office_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.broker_profiles bp
    where bp.id = office_id
      and bp.user_id = auth.uid()
      and bp.is_owner is distinct from false
  ) or public.is_office_director(office_id)
$$;

-- 2) 매물·고객 보기
create or replace function public.can_view_broker_property(prop_broker_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or (
      exists (select 1 from public.broker_profiles where user_id = auth.uid() and is_approved = true)
      and (
        exists (select 1 from public.broker_profiles where user_id = auth.uid() and id = prop_broker_id)
        or exists (
          select 1 from public.broker_profiles bp_me
          join public.broker_profiles bp_prop on bp_prop.id = prop_broker_id
          where bp_me.user_id = auth.uid() and bp_me.is_owner = true and bp_prop.parent_broker_id = bp_me.id
        )
        -- 이사 → 사무소 전체(대표 것 + 직원 것)
        or exists (
          select 1 from public.broker_profiles bp_me
          join public.broker_profiles bp_prop on bp_prop.id = prop_broker_id
          where bp_me.user_id = auth.uid()
            and bp_me.permissions->>'grade' = 'director'
            and bp_me.parent_broker_id is not null
            and (bp_prop.id = bp_me.parent_broker_id or bp_prop.parent_broker_id = bp_me.parent_broker_id)
        )
        or exists (
          select 1 from public.broker_profiles bp_me
          join public.broker_profiles bp_prop on bp_prop.id = prop_broker_id
          where bp_me.user_id = auth.uid()
            and bp_me.parent_broker_id is not null
            and bp_me.parent_broker_id = bp_prop.parent_broker_id
            and (bp_me.permissions->>'can_see_others') is distinct from 'false'
        )
        or exists (
          select 1 from public.broker_profiles bp_me
          where bp_me.user_id = auth.uid()
            and bp_me.parent_broker_id = prop_broker_id
            and (bp_me.permissions->>'can_see_others') is distinct from 'false'
        )
      )
    )
$$;

create or replace function public.my_visible_broker_ids()
returns uuid[] language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  SELECT COALESCE(array_agg(DISTINCT bp.id), ARRAY[]::uuid[])
  FROM broker_profiles bp
  WHERE EXISTS (
          SELECT 1 FROM broker_profiles me
          WHERE me.user_id = auth.uid() AND me.is_approved = true
        )
    AND (
      -- 본인 것
      bp.user_id = auth.uid()
      -- 대표 → 소속 직원
      OR EXISTS (
        SELECT 1 FROM broker_profiles me
        WHERE me.user_id = auth.uid() AND me.is_owner = true
          AND bp.parent_broker_id = me.id
      )
      -- 이사 → 사무소 전체
      OR EXISTS (
        SELECT 1 FROM broker_profiles me
        WHERE me.user_id = auth.uid()
          AND me.permissions->>'grade' = 'director'
          AND me.parent_broker_id IS NOT NULL
          AND (bp.id = me.parent_broker_id OR bp.parent_broker_id = me.parent_broker_id)
      )
      -- 같은 사무소 동료끼리 (열람 권한이 꺼져 있지 않을 때)
      OR EXISTS (
        SELECT 1 FROM broker_profiles me
        WHERE me.user_id = auth.uid()
          AND me.parent_broker_id IS NOT NULL
          AND me.parent_broker_id = bp.parent_broker_id
          AND (me.permissions->>'can_see_others') IS DISTINCT FROM 'false'
      )
      -- 직원 → 자기 사무소 대표
      OR EXISTS (
        SELECT 1 FROM broker_profiles me
        WHERE me.user_id = auth.uid()
          AND me.parent_broker_id = bp.id
          AND (me.permissions->>'can_see_others') IS DISTINCT FROM 'false'
      )
    )
$$;

-- 3) 매물 고치기·지우기 (광고관리 can_manage_office_ads, 수집 설정도 이걸 탄다)
create or replace function public.can_edit_broker_property(prop_broker_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or (
      exists (select 1 from public.broker_profiles where user_id = auth.uid() and is_approved = true)
      and (
        exists (
          select 1 from public.broker_profiles
          where user_id = auth.uid() and id = prop_broker_id
        )
        or exists (
          select 1 from public.broker_profiles bp_me
          join public.broker_profiles bp_prop on bp_prop.id = prop_broker_id
          where bp_me.user_id = auth.uid() and bp_me.is_owner = true and bp_prop.parent_broker_id = bp_me.id
        )
        -- 이사 → 사무소 전체
        or exists (
          select 1 from public.broker_profiles bp_me
          join public.broker_profiles bp_prop on bp_prop.id = prop_broker_id
          where bp_me.user_id = auth.uid()
            and bp_me.permissions->>'grade' = 'director'
            and bp_me.parent_broker_id is not null
            and (bp_prop.id = bp_me.parent_broker_id or bp_prop.parent_broker_id = bp_me.parent_broker_id)
        )
      )
    )
$$;

-- 4) 고객 지우기
drop policy if exists bcust_delete on public.broker_customers;
create policy bcust_delete on public.broker_customers for delete using (
  ((select auth.uid()) in (select broker_profiles.user_id from broker_profiles where broker_profiles.id = broker_customers.broker_id))
  or exists (
    select 1 from broker_profiles bp_me
    join broker_profiles bp_emp on bp_emp.id = broker_customers.broker_id
    where bp_me.user_id = (select auth.uid()) and bp_me.is_owner = true and bp_emp.parent_broker_id = bp_me.id
  )
  or exists (
    select 1 from broker_profiles bp_me
    join broker_profiles bp_t on bp_t.id = broker_customers.broker_id
    where bp_me.user_id = (select auth.uid())
      and bp_me.is_approved is true
      and bp_me.permissions->>'grade' = 'director'
      and (bp_t.id = bp_me.parent_broker_id or bp_t.parent_broker_id = bp_me.parent_broker_id)
  )
);

create or replace function public.soft_delete_customer(cust_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
DECLARE
  my_broker_id uuid;
BEGIN
  SELECT id INTO my_broker_id FROM broker_profiles WHERE user_id = auth.uid() LIMIT 1;
  IF my_broker_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM broker_customers c
    WHERE c.id = cust_id AND c.deleted_at IS NULL
      AND (
        c.broker_id = my_broker_id
        OR EXISTS (
          SELECT 1 FROM broker_profiles owner_bp
          JOIN broker_profiles emp_bp ON emp_bp.id = c.broker_id
          WHERE owner_bp.id = my_broker_id
            AND owner_bp.is_owner = true
            AND emp_bp.parent_broker_id = my_broker_id
        )
        OR EXISTS (
          SELECT 1 FROM broker_profiles me
          JOIN broker_profiles t ON t.id = c.broker_id
          WHERE me.id = my_broker_id
            AND me.is_approved IS TRUE
            AND me.permissions->>'grade' = 'director'
            AND (t.id = me.parent_broker_id OR t.parent_broker_id = me.parent_broker_id)
        )
      )
  ) THEN
    RAISE EXCEPTION 'unauthorized or not found';
  END IF;

  UPDATE broker_customers SET deleted_at = now() WHERE id = cust_id;
END;
$$;

create or replace function public.soft_delete_property(prop_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
DECLARE
  my_broker_id uuid;
BEGIN
  SELECT id INTO my_broker_id FROM broker_profiles WHERE user_id = auth.uid() LIMIT 1;
  IF my_broker_id IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM broker_properties p
    WHERE p.id = prop_id AND p.deleted_at IS NULL
      AND (
        p.broker_id = my_broker_id
        OR EXISTS (
          SELECT 1 FROM broker_profiles owner_bp
          JOIN broker_profiles emp_bp ON emp_bp.id = p.broker_id
          WHERE owner_bp.id = my_broker_id
            AND owner_bp.is_owner = true
            AND emp_bp.parent_broker_id = my_broker_id
        )
        OR EXISTS (
          SELECT 1 FROM broker_profiles me
          JOIN broker_profiles t ON t.id = p.broker_id
          WHERE me.id = my_broker_id
            AND me.is_approved IS TRUE
            AND me.permissions->>'grade' = 'director'
            AND (t.id = me.parent_broker_id OR t.parent_broker_id = me.parent_broker_id)
        )
      )
  ) THEN
    RAISE EXCEPTION 'unauthorized or not found';
  END IF;

  UPDATE broker_properties SET deleted_at = now() WHERE id = prop_id;
END;
$$;

-- 5) 휴지통 (되살리기·영구 삭제)
create or replace function public.can_manage_trash_row(p_broker_id uuid, p_assignee_ids uuid[])
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
      or exists (
        select 1
        from broker_profiles me
        join broker_profiles target on target.id = p_broker_id
        where me.user_id = auth.uid()
          and me.is_approved is true
          and (
                target.id = me.id
             or (me.is_owner and target.parent_broker_id = me.id)
             or (me.permissions->>'grade' = 'director' and me.parent_broker_id is not null
                 and coalesce(target.parent_broker_id, target.id) = me.parent_broker_id)
             or (me.id = any (p_assignee_ids)
                 and coalesce(target.parent_broker_id, target.id) = coalesce(me.parent_broker_id, me.id))
          )
      );
$$;

create or replace function public.purge_customer(cust_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and not exists (select 1 from broker_profiles
                     where user_id = auth.uid() and is_approved is true
                       and (is_owner or permissions->>'grade' = 'director')) then
    raise exception '권한 없음: 영구 삭제는 사무소 대표·이사만 할 수 있습니다';
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
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and not exists (select 1 from broker_profiles
                     where user_id = auth.uid() and is_approved is true
                       and (is_owner or permissions->>'grade' = 'director')) then
    raise exception '권한 없음: 영구 삭제는 사무소 대표·이사만 할 수 있습니다';
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

-- 6) 업무일지 — 이사도 사무소 전원 일지(대표 것 포함)
create or replace function public.can_access_diary(p_broker_id uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
      or exists (
        select 1
        from public.broker_profiles me
        join public.broker_profiles target on target.id = p_broker_id
        where me.user_id = auth.uid()
          and me.is_approved is true
          and (
                target.id = me.id
             or (me.is_owner is true
                 and me.parent_broker_id is null
                 and target.parent_broker_id = me.id)
             or (me.permissions->>'grade' = 'director'
                 and me.parent_broker_id is not null
                 and (target.id = me.parent_broker_id or target.parent_broker_id = me.parent_broker_id))
          )
      );
$$;

drop policy if exists diary_archive_insert on public.broker_diary_archive;
create policy diary_archive_insert on public.broker_diary_archive for insert with check (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
);
drop policy if exists diary_archive_update on public.broker_diary_archive;
create policy diary_archive_update on public.broker_diary_archive for update using (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
) with check (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
);
drop policy if exists diary_cust_archive_insert on public.broker_diary_customers_archive;
create policy diary_cust_archive_insert on public.broker_diary_customers_archive for insert with check (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
);
drop policy if exists diary_cust_archive_update on public.broker_diary_customers_archive;
create policy diary_cust_archive_update on public.broker_diary_customers_archive for update using (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
) with check (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
);

-- 7) 광고현황 메모 보기 (쓰기는 is_office_owner 를 탄다)
create or replace function public.can_see_ad_memo(p_office uuid, p_author uuid)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (
    select 1 from public.broker_profiles me
    where me.user_id = auth.uid()
      and (me.id = p_office or (me.parent_broker_id = p_office and me.is_approved is true))
      and (me.id = p_author
           or (me.id = p_office and me.is_owner is true)
           or (me.parent_broker_id = p_office and me.permissions->>'grade' = 'director'))
  );
$$;

-- 8) 자료실
create or replace function public.office_res_can_view(p_office uuid, p_uploader uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (
        bp.id = p_office
        OR (bp.parent_broker_id = p_office AND bp.is_approved = true
            AND (p_uploader = bp.id OR p_uploader = p_office OR bp.permissions->>'grade' = 'director'))
      )
  )
$$;

create or replace function public.office_res_can_manage(p_office uuid, p_uploader uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (
        bp.id = p_office
        OR (bp.parent_broker_id = p_office AND bp.is_approved = true
            AND (bp.id = p_uploader OR bp.permissions->>'grade' = 'director'))
      )
  )
$$;

-- 9) 정산 설정
drop policy if exists office_settlement_settings_owner_all on public.office_settlement_settings;
create policy office_settlement_settings_owner_all on public.office_settlement_settings for all
  using (public.is_office_owner(office_broker_id))
  with check (public.is_office_owner(office_broker_id));

-- 10) 입찰 — 대표에게 입찰이 켜져 있으면 그 사무소 이사도 본다
create or replace function public.can_view_bids()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.broker_profiles bp
    where bp.user_id = (select auth.uid()) and bp.bid_enabled and bp.is_owner is not false
  ) or exists (
    select 1 from public.broker_profiles me
    join public.broker_profiles o on o.id = me.parent_broker_id
    where me.user_id = (select auth.uid())
      and me.is_approved is true
      and me.permissions->>'grade' = 'director'
      and o.bid_enabled
  )
$$;

-- 11) 퇴사자 일지 보관본 보기
drop policy if exists diary_archive_select on public.broker_diary_archive;
create policy diary_archive_select on public.broker_diary_archive for select using (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
);
drop policy if exists diary_cust_archive_select on public.broker_diary_customers_archive;
create policy diary_cust_archive_select on public.broker_diary_customers_archive for select using (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
);

-- 12) 정산 — 대표·이사는 사무소 전체, 직원은 자기 담당 건
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select using (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from broker_profiles me where me.user_id = (select auth.uid())
             and me.id = settlements.assignee_broker_id and me.parent_broker_id = settlements.office_broker_id and me.is_approved)
);
drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements for insert with check (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from broker_profiles me where me.user_id = (select auth.uid())
             and me.parent_broker_id = settlements.office_broker_id and me.is_approved = true and me.id = settlements.assignee_broker_id)
);
drop policy if exists settlements_update on public.settlements;
create policy settlements_update on public.settlements for update using (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from broker_profiles me where me.user_id = (select auth.uid())
             and me.id = settlements.assignee_broker_id and me.parent_broker_id = settlements.office_broker_id and me.is_approved)
) with check (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from broker_profiles me where me.user_id = (select auth.uid())
             and me.id = settlements.assignee_broker_id and me.parent_broker_id = settlements.office_broker_id and me.is_approved)
);
drop policy if exists settlements_delete on public.settlements;
create policy settlements_delete on public.settlements for delete using (
  public.is_office_owner(office_broker_id)
  or exists (select 1 from broker_profiles me where me.user_id = (select auth.uid())
             and me.id = settlements.assignee_broker_id and me.parent_broker_id = settlements.office_broker_id and me.is_approved)
);

-- 13) 메신저 — 지운 메시지 원본(대표 화면에 흐리게 보이던 것)
drop policy if exists ocdm_select on public.office_chat_deleted_messages;
create policy ocdm_select on public.office_chat_deleted_messages for select using (
  exists (select 1 from office_chat_threads t where t.id = office_chat_deleted_messages.thread_id
          and public.is_office_owner(t.office_broker_id))
  and public.can_access_office_thread(thread_id)
);
