-- 이사도 대표와 똑같이(2026-11-07 사장님 "이사는 모두 대표와 같게"):
--   직원 승인·거절·등급·내보내기, 합류 코드, 사무소 정보 수정.
-- 그리고 5층(office_room_snapshot) 사람 순서를 가입일시(created_at)로.
--
-- 이사 판정은 기존 is_office_director(사무소id) — 승인된 grade='director' 직원.

-- 내가 대표 권한으로 맡은 사무소 id. 대표면 내 id, 이사면 대표 id, 아니면 null
create or replace function public.my_managed_office()
returns uuid
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  select case
    when me.is_owner is true and me.parent_broker_id is null then me.id
    when me.parent_broker_id is not null and me.is_approved is true and me.permissions->>'grade' = 'director' then me.parent_broker_id
  end
  from public.broker_profiles me
  where me.user_id = auth.uid()
  limit 1
$$;
grant execute on function public.my_managed_office() to authenticated;

-- 1) broker_profiles 고치기 — 이사도 사무소 직원 행과 대표 행(사무소 정보)을 고친다
drop policy if exists broker_profiles_update on public.broker_profiles;
create policy broker_profiles_update on public.broker_profiles for update using (
  (select auth.uid()) = user_id
  or exists (select 1 from public.broker_profiles owner
             where owner.user_id = (select auth.uid()) and owner.is_owner = true
               and owner.id = broker_profiles.parent_broker_id)
  or public.is_office_director(broker_profiles.parent_broker_id)
  or public.is_office_director(broker_profiles.id)
  or exists (select 1 from public.profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin')
);

-- 2) 승인·등급 바꾸기 지킴이 — 대표 또는 그 사무소 이사
create or replace function public.guard_broker_profile_privileged()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_admin_user() then return new; end if;

  if tg_op = 'INSERT' then
    if new.parent_broker_id is not null then
      raise exception '권한 없음: 사무소 합류는 사무소 코드로만 할 수 있습니다' using errcode = '42501';
    end if;
    new.permissions := '{}'::jsonb;
    new.is_verified := false;
    return new;
  end if;

  if new.user_id is distinct from old.user_id or new.is_owner is distinct from old.is_owner then
    raise exception '권한 없음: user_id·is_owner 는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if new.parent_broker_id is distinct from old.parent_broker_id and new.parent_broker_id is not null then
    raise exception '권한 없음: 소속 사무소는 바꿀 수 없습니다' using errcode = '42501';
  end if;
  if (new.is_approved is distinct from old.is_approved or new.permissions is distinct from old.permissions)
     and not (old.parent_broker_id is not null and (
           exists (select 1 from public.broker_profiles o
                   where o.id = old.parent_broker_id and o.user_id = v_uid and o.is_owner = true)
           or public.is_office_director(old.parent_broker_id)))
     and not (new.parent_broker_id is null and coalesce(new.is_approved, false) = false and new.permissions is null)
  then
    raise exception '권한 없음: 승인·권한은 사무소 대표·이사만 바꿀 수 있습니다' using errcode = '42501';
  end if;
  return new;
end $function$;

-- 3) 가입 신청 거절
create or replace function public.reject_employee_application(emp_broker_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_office uuid := public.my_managed_office();
begin
  if v_office is null then
    raise exception 'unauthorized: 사무소 대표·이사만 할 수 있습니다';
  end if;
  if not exists (
    select 1 from broker_profiles
    where id = emp_broker_id and parent_broker_id = v_office and is_approved = false
  ) then
    raise exception 'unauthorized: no pending application in your office';
  end if;
  delete from broker_profiles where id = emp_broker_id and is_approved = false;
end;
$function$;

-- 4) 직원 내보내기 — 이사가 자기 자신을 내보내지는 못한다
create or replace function public.remove_employee_from_office(emp_broker_id uuid)
returns void
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_office uuid := public.my_managed_office();
begin
  if v_office is null then
    raise exception 'unauthorized: 사무소 대표·이사만 할 수 있습니다';
  end if;
  if exists (select 1 from broker_profiles where id = emp_broker_id and user_id = auth.uid()) then
    raise exception 'unauthorized: 자기 자신은 내보낼 수 없습니다';
  end if;
  if not exists (
    select 1 from broker_profiles where id = emp_broker_id and parent_broker_id = v_office
  ) then
    raise exception 'unauthorized: employee not in your office';
  end if;
  update broker_profiles
  set parent_broker_id = null, is_approved = false, permissions = null
  where id = emp_broker_id;
end;
$function$;

-- 5) 합류 코드 보기·재발급
create or replace function public.my_office_code()
returns text
language sql stable security definer
set search_path to 'public'
as $function$
  select c.code from public.office_join_codes c
  where c.owner_broker_id = public.my_managed_office()
$function$;

create or replace function public.regenerate_office_code()
returns text
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_office uuid := public.my_managed_office();
  v_new_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if v_office is null then raise exception 'forbidden' using errcode = '42501'; end if;
  loop
    select string_agg(substr(v_chars, (floor(random() * length(v_chars)) + 1)::int, 1), '')
      into v_new_code from generate_series(1, 6);
    exit when not exists (select 1 from public.office_join_codes where code = v_new_code);
  end loop;
  insert into public.office_join_codes (owner_broker_id, code)
  values (v_office, v_new_code)
  on conflict (owner_broker_id) do update set code = excluded.code;
  return v_new_code;
end $function$;

-- 6) 내보낼 때 기록 넘기기(transfer_broker_data) — 이사도 부를 수 있게. 긴 함수라 그 한 줄만 바꾼다
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.transfer_broker_data(uuid,uuid)'::regprocedure);
  n := replace(d,
    'if caller_broker_id <> from_broker_id and caller_broker_id <> from_parent then',
    'if caller_broker_id <> from_broker_id and caller_broker_id <> from_parent and not public.is_office_director(from_parent) then');
  if n = d then raise exception 'transfer_broker_data: 바꿀 줄을 못 찾음'; end if;
  execute n;
end $$;

-- 7) 5층 사람 순서 = 가입일시
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.office_room_snapshot(uuid,boolean)'::regprocedure);
  n := replace(d,
    'jsonb_build_object(''name'', pv.name) end)), ''[]'')',
    'jsonb_build_object(''name'', pv.name) end) order by b.created_at), ''[]'')');
  if n = d then raise exception 'office_room_snapshot: 바꿀 곳을 못 찾음'; end if;
  execute n;
end $$;
