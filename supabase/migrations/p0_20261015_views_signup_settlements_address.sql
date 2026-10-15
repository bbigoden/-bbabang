-- 22단계 점검(2026-10-15) P0 4건. 모두 적용 완료, rollback 트랜잭션에서 사칭으로 시험했다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 공개 뷰가 쓰기 가능했다 — 비로그인이 RLS 를 건너뛰고 회원 역할을 바꾸거나 매물을 지울 수 있었다
--    profiles_visible·public_properties 는 security_invoker=false(뷰 주인 권한)인 단순 뷰라
--    자동으로 갱신 가능했고, anon·authenticated 에 INSERT/UPDATE/DELETE 권한이 남아 있었다.
--    앱은 두 뷰를 읽기만 한다.
-- ─────────────────────────────────────────────────────────────────────────────
revoke insert, update, delete, truncate, references, trigger on public.profiles_visible from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.public_properties from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 가입 트리거가 메타데이터의 role 을 그대로 저장해 누구나 관리자(admin)로 가입할 수 있었다
--    가입 폼이 넘기는 값은 user·broker 뿐이다. 그 밖의 값은 user 로 저장한다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'auth'
as $function$
declare
  v_ref_code text;
  v_referrer_id uuid;
begin
  v_ref_code := new.raw_user_meta_data->>'referral_code_used';
  if v_ref_code is not null and v_ref_code <> '' then
    select id into v_referrer_id from public.profiles where referral_code = upper(v_ref_code) limit 1;
  end if;

  insert into public.profiles (id, email, name, phone, role, referral_code, referred_by)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    new.raw_user_meta_data->>'phone',
    case when new.raw_user_meta_data->>'role' in ('user', 'broker')
         then new.raw_user_meta_data->>'role' else 'user' end,
    public.generate_referral_code(),
    v_referrer_id
  )
  on conflict (id) do nothing;

  if v_referrer_id is not null then
    insert into public.notifications (user_id, type, title, body, link)
    values (
      v_referrer_id,
      'referral_signup',
      '추천 가입! 🎉',
      coalesce(new.raw_user_meta_data->>'name', '신규 회원') || '님이 회원님의 추천 코드로 가입했어요',
      '/settings/account'
    );
  end if;

  return new;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) 퇴사자가 옛 사무소 정산 행을 읽고·고치고·지울 수 있었다
--    담당자(assignee)는 지금 그 사무소의 승인 직원일 때만. 대표(office)는 그대로.
--    대표 75건·직원 4/3건 그대로, 퇴사자 23/12건 → 0 을 확인했다.
-- ─────────────────────────────────────────────────────────────────────────────
alter policy settlements_select on public.settlements
  using (exists (select 1 from public.broker_profiles me
                 where me.user_id = (select auth.uid())
                   and (me.id = settlements.office_broker_id
                        or (me.id = settlements.assignee_broker_id
                            and me.parent_broker_id = settlements.office_broker_id
                            and me.is_approved))));
alter policy settlements_update on public.settlements
  using (exists (select 1 from public.broker_profiles me
                 where me.user_id = (select auth.uid())
                   and (me.id = settlements.office_broker_id
                        or (me.id = settlements.assignee_broker_id
                            and me.parent_broker_id = settlements.office_broker_id
                            and me.is_approved))))
  with check (exists (select 1 from public.broker_profiles me
                 where me.user_id = (select auth.uid())
                   and (me.id = settlements.office_broker_id
                        or (me.id = settlements.assignee_broker_id
                            and me.parent_broker_id = settlements.office_broker_id
                            and me.is_approved))));
alter policy settlements_delete on public.settlements
  using (exists (select 1 from public.broker_profiles me
                 where me.user_id = (select auth.uid())
                   and (me.id = settlements.office_broker_id
                        or (me.id = settlements.assignee_broker_id
                            and me.parent_broker_id = settlements.office_broker_id
                            and me.is_approved))));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) 공개 매물 뷰가 원래 주소(지번·호수)를 비로그인에게 그대로 내줬다 — 화면 마스킹이 소용없었다
--    화면(utils.ts formatAddress → maskAddressByType)과 같은 규칙으로 DB 에서 가린다.
--    가상 주소 15건으로 JS 와 결과가 같고, 실데이터 1,980건에서 두 번 가려도 같으며(화면이 한 번
--    더 가린다) 'N호' 가 남은 행이 0 인 것을 확인했다. 본인 매물 원문은 상세 화면이 원래 표에서 읽는다.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mask_address_public(p_address text, p_room_type text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  a text;
  toks text[];
  t text;
  out_toks text[] := '{}';
  stop int := 0;
  i int;
begin
  if p_address is null or btrim(p_address) = '' then return ''; end if;
  -- formatAddress: '... 307-1502' → '... 307동 1502호'
  a := regexp_replace(p_address, '\s(\d{1,3})-(\d{3,4})(\s*)$', ' \1동 \2호\3');
  toks := regexp_split_to_array(btrim(a), '\s+');
  -- maskAddressByType: 상세 노출 유형은 'N호' 만 지운다
  if btrim(coalesce(p_room_type, '')) = any (array['원룸','투룸','쓰리룸 이상','단독','단독/다가구','다가구','아파트','오피스텔','빌라/연립','빌라','연립','상가','사무실','건물 전체','건물전체']) then
    foreach t in array toks loop
      if t ~ '^\d+호$' then continue; end if;
      t := regexp_replace(regexp_replace(t, ',?\d+호$', ''), ',$', '');
      if length(t) > 0 then out_toks := out_toks || t; end if;
    end loop;
    return array_to_string(out_toks, ' ');
  end if;
  -- maskAddress: 읍·면·동·리·가 까지 (숫자로 시작하는 토큰은 건물 동번호라 제외)
  for i in 1 .. coalesce(array_length(toks, 1), 0) loop
    if toks[i] ~ '[읍면동리가]$' and toks[i] !~ '^\d' then stop := i; end if;
  end loop;
  if stop = 0 then return toks[1]; end if;
  return array_to_string(toks[1:stop], ' ');
end $$;

create or replace view public.public_properties with (security_invoker = false) as
 select id,
    broker_id,
    seq_no,
    deal_type,
    room_type,
    public.mask_address_public(address, room_type) as address,
    price,
    monthly_rent,
    management_fee,
    premium,
    size_pyeong,
    area_type,
    area_unit,
    area_supplied,
    floor,
    total_floors,
    rooms_bathrooms,
    options,
    images,
    description,
    move_in_date,
    approval_date,
    parking,
    direction,
    status,
    created_at
   from broker_properties p
  where ((deleted_at is null) and ((status = 'available'::text) or can_view_broker_property(broker_id)));
revoke insert, update, delete, truncate, references, trigger on public.public_properties from public, anon, authenticated;
grant select on public.public_properties to anon, authenticated;
