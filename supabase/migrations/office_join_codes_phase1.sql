-- ─────────────────────────────────────────────────────────────────────────────
-- 사무소 합류 코드를 broker_profiles 밖으로 옮긴다 (1단계)
-- ─────────────────────────────────────────────────────────────────────────────
-- 왜: broker_profiles.office_code(직원이 사무소에 합류할 때 쓰는 1회용 6자리 코드)는
--    로그인만 하면 누구나 읽혔다(SELECT 정책 true + authenticated 컬럼 권한). 남의 사무소
--    코드를 읽어 합류 신청을 넣거나, 신청 한 번으로 코드를 강제로 갈아치워 대표가 직원에게
--    알려준 코드를 못 쓰게 만들 수 있었다.
--    앱이 broker_profiles 를 select('*') 로 읽어서 이 칸 하나만 컬럼 권한으로 막을 수도 없다
--    (* 안에 막힌 칸이 하나라도 섞이면 조회 전체가 permission denied).
--    → 코드는 정책 없는 별도 테이블(office_join_codes)에 두고, DEFINER 함수로만 다룬다.
--      읽기: preview_office_by_code(코드 → 사무소명·주소), my_office_code(대표 본인 코드)
--      쓰기: regenerate_office_code(대표 수동 재발급), join_office_by_code(합류 + 1회용 재발급)
--
-- 적용 순서
--   1) 이 파일(1단계) 적용
--   2) 새 앱 배포 (가입 화면 미리보기·직원 화면 코드 카드가 위 rpc 를 쓴다)
--   3) office_join_codes_phase2_drop_column.sql 로 옛 칸 삭제
--
-- 1)~3) 사이 옛 칸(broker_profiles.office_code)은 이렇게 된다
--   - 값은 이 파일에서 전부 비운다(NULL). 적용 순간부터 누구도 SELECT 로 코드를 못 본다.
--   - 합류·미리보기는 office_join_codes 만 본다. 옛 칸에 무엇이 들어오든 합류 코드로 안 통한다.
--   - 옛 칸에 새로 쓰는 값은 트리거(trg_office_code_legacy_redirect)가 받아서
--       · 대표 본인이 자기 행에 쓴 6자리 코드면 office_join_codes 로 옮기고
--       · 그 밖(직원 행, 남이 쓴 값, INSERT)은 버린 뒤
--     옛 칸은 항상 NULL 로 남긴다.
--     아직 옛 앱(PWA 캐시 포함)이 열린 대표는 직원 화면에서 코드가 안 보이고 "코드 발급하기"가
--     나오는데, 그걸 누르면 옛 앱이 옛 칸에 새 코드를 UPDATE → 트리거가 새 테이블로 옮겨서
--     화면에 뜬 그 코드가 실제로 통한다. 옛 칸에는 여전히 아무것도 안 남는다.
--   - 옛 앱의 가입 화면 미리보기는 옛 칸을 직접 조회하므로 이 사이에는 "등록된 사무소 코드가
--     아닙니다"로 막힌다(코드 노출을 닫는 대가). 새 앱이 배포되면 풀린다.
--
-- 기존 코드(대표 사무소 1곳의 현재 코드)는 그대로 새 테이블로 옮겨 계속 쓸 수 있다.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. 코드 테이블 ───────────────────────────────────────────────────────────
-- 정책은 일부러 하나도 안 만든다(RLS 켜고 정책 없음 = anon/authenticated 직접 접근 불가).
-- 코드 모양(혼동 문자 I·O·0·1 뺀 32자 중 6자리)은 재발급 함수와 같은 규칙으로 못 박는다.
create table if not exists public.office_join_codes (
  owner_broker_id uuid primary key references public.broker_profiles(id) on delete cascade,
  code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$')
);

comment on table public.office_join_codes is
  '사무소 합류 코드(대표 사무소당 1개, 1회용). 정책 없음 — DEFINER 함수(preview_office_by_code, my_office_code, regenerate_office_code, join_office_by_code)로만 접근.';

alter table public.office_join_codes enable row level security;
-- Supabase 기본 권한이 새 테이블을 anon/authenticated 에 통째로 열어 준다 → 닫는다.
revoke all on table public.office_join_codes from public, anon, authenticated;


-- ── 2. 옛 칸 쓰기를 새 테이블로 돌리는 트리거 ───────────────────────────────
-- 옛 앱이 계속 쓰는 경로(대표가 자기 행 UPDATE)를 살려 두면서, 옛 칸은 늘 비워 둔다.
-- DEFINER 인 이유: 호출자(authenticated)는 office_join_codes 에 권한이 없다.
-- 2단계에서 칸을 지울 때 이 트리거와 함수도 같이 지운다.
create or replace function public.office_code_legacy_redirect()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text := upper(trim(new.office_code));
begin
  -- INSERT 시점엔 행이 아직 없어 외래키를 못 건다. 가입 화면도 이 칸을 안 넣는다 → 그냥 버린다.
  if tg_op = 'UPDATE'
     and v_code is not null
     and new.is_owner = true
     and new.user_id = auth.uid()   -- 대표 본인만. 관리자·DEFINER 함수가 남의 사무소 코드를 심지 못하게
  then
    if v_code !~ '^[A-HJ-NP-Z2-9]{6}$' then
      raise exception 'invalid_code' using errcode = '22023';
    end if;
    insert into public.office_join_codes (owner_broker_id, code)
    values (new.id, v_code)
    on conflict (owner_broker_id) do update set code = excluded.code;
  end if;

  new.office_code := null;
  return new;
end $$;

-- 트리거는 실행 권한과 상관없이 동작한다(만들 때만 검사) → API 로 직접 부르는 길만 닫는다.
revoke execute on function public.office_code_legacy_redirect() from public, anon, authenticated;

-- CREATE TRIGGER 가 broker_profiles 에 쓰기 잠금(SHARE ROW EXCLUSIVE)을 커밋까지 쥔다.
-- 그래서 아래 옮기기·비우기 사이에 옛 앱이 코드를 새로 써서 사라지는 틈이 없다.
drop trigger if exists trg_office_code_legacy_redirect on public.broker_profiles;
create trigger trg_office_code_legacy_redirect
  before insert or update of office_code on public.broker_profiles
  for each row execute function public.office_code_legacy_redirect();


-- ── 3. 기존 코드 옮기고 옛 칸 비우기 ─────────────────────────────────────────
-- 대표 행에 있던 코드만 옮긴다(합류 함수도 대표 행 코드만 받아 줬다).
-- 모양이 규칙과 다른 옛 코드는 옮기지 않는다 — 적용 전 확인 결과 그런 값은 없다.
insert into public.office_join_codes (owner_broker_id, code)
select bp.id, upper(trim(bp.office_code))
from public.broker_profiles bp
where bp.is_owner = true
  and bp.office_code is not null
  and upper(trim(bp.office_code)) ~ '^[A-HJ-NP-Z2-9]{6}$'
on conflict (owner_broker_id) do nothing;

-- 마이그레이션은 postgres 로 돌아 가드 트리거를 통과하고, 위 트리거는 NULL 이라 아무것도 안 옮긴다.
update public.broker_profiles set office_code = null where office_code is not null;


-- ── 4. 합류 함수: 코드 출처만 office_join_codes 로 바꾼다 ────────────────────
-- 인자·반환 모양·검사(unauthorized / invalid_code / already_registered)·부수효과
-- (직원 프로필 생성, 코드 1회용 재발급, role='broker')는 그대로다.
create or replace function public.join_office_by_code(p_code text, p_alert_regions jsonb default '[]'::jsonb)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_owner record;
  v_new_code text;
  v_bp_id uuid;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select bp.id, bp.office_name, bp.address, bp.district into v_owner
  from public.office_join_codes c
  join public.broker_profiles bp on bp.id = c.owner_broker_id
  where c.code = upper(trim(p_code)) and bp.is_owner = true
  limit 1;
  if v_owner.id is null then raise exception 'invalid_code'; end if;

  if exists (select 1 from public.broker_profiles where user_id = v_uid) then
    raise exception 'already_registered';
  end if;

  insert into public.broker_profiles
    (user_id, office_name, address, district, license_number, rating, review_count, deal_count,
     is_verified, is_owner, parent_broker_id, permissions, is_approved, alert_regions)
  values
    (v_uid, v_owner.office_name, v_owner.address, v_owner.district, '', 0, 0, 0,
     false, false, v_owner.id, null, false, coalesce(p_alert_regions, '[]'::jsonb))
  returning id into v_bp_id;

  -- 코드 1회용: 충돌 없는 새 6자리로 재발급
  loop
    select string_agg(substr(v_chars, (floor(random() * length(v_chars)) + 1)::int, 1), '')
      into v_new_code from generate_series(1, 6);
    exit when not exists (select 1 from public.office_join_codes where code = v_new_code);
  end loop;
  update public.office_join_codes set code = v_new_code where owner_broker_id = v_owner.id;

  update public.profiles set role = 'broker' where id = v_uid;

  return json_build_object('ok', true, 'office_name', v_owner.office_name, 'broker_id', v_bp_id);
end
$function$;

-- CREATE OR REPLACE 는 기존 권한을 유지하지만(authenticated·service_role), 다시 못 박아 둔다.
revoke all on function public.join_office_by_code(text, jsonb) from public, anon;
grant execute on function public.join_office_by_code(text, jsonb) to authenticated;


-- ── 5. 가입 화면 미리보기: 코드 → 사무소명·주소 ──────────────────────────────
-- 예전엔 가입 화면이 broker_profiles 를 코드로 직접 조회했다(= 코드 칸을 읽을 수 있어야 했다).
-- 이제 코드가 맞을 때만 사무소명·주소 두 칸을 돌려준다. 정규화는 합류 함수와 같다(upper(trim)).
create or replace function public.preview_office_by_code(p_code text)
returns table(office_name text, address text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;

  return query
    select bp.office_name, bp.address
    from public.office_join_codes c
    join public.broker_profiles bp on bp.id = c.owner_broker_id
    where c.code = upper(trim(p_code)) and bp.is_owner = true
    limit 1;
end $$;

revoke all on function public.preview_office_by_code(text) from public, anon;
grant execute on function public.preview_office_by_code(text) to authenticated;


-- ── 6. 직원 화면 코드 카드: 대표 본인의 현재 코드 ────────────────────────────
-- 대표가 아니거나 아직 발급 전이면 NULL(카드가 "코드 발급하기"를 보여 준다).
create or replace function public.my_office_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.code
  from public.office_join_codes c
  join public.broker_profiles bp on bp.id = c.owner_broker_id
  where bp.user_id = auth.uid() and bp.is_owner = true
$$;

revoke all on function public.my_office_code() from public, anon;
grant execute on function public.my_office_code() to authenticated;


-- ── 7. 직원 화면 "코드 발급하기 / 코드 수동 재발급" ──────────────────────────
-- 예전엔 브라우저가 Math.random 으로 만든 코드를 대표 행에 직접 UPDATE 했다.
-- 이제 서버가 합류 함수와 똑같은 글자표·길이·충돌 검사로 만들고, 대표 본인 사무소에만 쓴다.
create or replace function public.regenerate_office_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_new_code text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select bp.id into v_owner_id
  from public.broker_profiles bp
  where bp.user_id = v_uid and bp.is_owner = true;
  if v_owner_id is null then raise exception 'forbidden' using errcode = '42501'; end if;

  loop
    select string_agg(substr(v_chars, (floor(random() * length(v_chars)) + 1)::int, 1), '')
      into v_new_code from generate_series(1, 6);
    exit when not exists (select 1 from public.office_join_codes where code = v_new_code);
  end loop;

  insert into public.office_join_codes (owner_broker_id, code)
  values (v_owner_id, v_new_code)
  on conflict (owner_broker_id) do update set code = excluded.code;

  return v_new_code;
end $$;

revoke all on function public.regenerate_office_code() from public, anon;
grant execute on function public.regenerate_office_code() to authenticated;

notify pgrst, 'reload schema';
