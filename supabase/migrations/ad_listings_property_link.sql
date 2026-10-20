-- 광고 대장(ad_listings) 한 줄을 부소장 매물(broker_properties) 하나에 잇는다.
--
-- 지금까지 둘 사이엔 고리가 없었다. 뱅크에서 긁어온 광고가 우리 장부의 어느 매물인지
-- 몰라서, 매물을 계약 처리해도 광고 쪽은 따로 손봐야 했다.
--
-- 뱅크 [재등록] 은 번호(bank_no·naver_no)를 새로 받아 **새 줄**을 만든다. 그래서 고리는
-- 한 번 맞춰 두는 것으로 끝나지 않는다 — 새 줄이 들어올 때마다 다시 맞춘다(아래 트리거).
--
-- 맞추는 순서 —
--   1. 재등록 물려받기. 같은 사무소·같은 소재지·같은 가격 글의 다른 줄 가운데 **답이 정해진
--      줄**만 본다 — 사람이 정한 것(manual)이 하나라도 있으면 그것(이은 것이든 끊은 것이든),
--      없으면 자동으로 이어져 있는 가장 최근 줄의 매물을 자동으로 물려받는다. 재등록은 같은
--      광고를 번호만 바꿔 다시 낸 것이라 주소로 다시 맞추는 것보다 앞 줄의 답이 정확하다 —
--      특히 사람이 고친 답은 주소 규칙으로 되살릴 수 없다(재등록할 때마다 사람이 다시 끊어야
--      했다). 단 계약으로 닫힌 줄(contracted_at)의 자동 연결은 물려받지 않는다 — 같은 호실을
--      같은 값에 다시 내놓은 새 의뢰에 지난 계약 매물이 따라붙는다.
--   2. 없으면 주소로 맞춘다. 전부 맞아야 잇는다 —
--      · 같은 사무소 (광고 broker 의 사무소 = 매물 office_broker_id), 휴지통 아닌 매물
--      · 같은 동/리 + 지번(본번-부번), 같은 호수 묶음
--      · 층·동(건물)이 양쪽 다 적혀 있으면 같아야 한다. 지하인지도(층·호가 양쪽에 있을 때)
--      · 같은 가격 (보증금 + 월세, 월세 없으면 0)
--      · 거래 종류가 어긋나지 않는다 (매물 쪽이 비어 있으면 통과)
--      · 그런 매물이 **딱 하나**. 여럿이면 잇지 않는다
--      · 층·동·지하로 다른 후보를 떨어뜨려 하나가 남았으면, 남은 것도 그 칸이 적혀 있고
--        맞아야 한다(비어서 '안 틀렸을 뿐' 인 매물은 이기지 못한다)
--      · 한 지번에 건물이 여럿인데(같은 사무소의 다른 매물이 다른 동을 적고 있다) 광고는 동을
--        적고 남은 매물은 동을 안 적었으면 잇지 않는다 — 어느 동 매물인지 모른다
-- 하나라도 어긋나면 잇지 않는다. 잘못 이으면 남의 매물 광고를 내리게 되고, 안 이으면
-- 사람이 한 번 더 볼 뿐이다 — 안 잇는 쪽이 싸다.
--
-- 여럿 중 '진행중(available)' 이 하나면 그것을 고르던 규칙은 뺐다. 같은 물건을 두 번 등록해
-- 하나를 계약 처리하면 광고가 진행중 쪽에 붙어, 정작 '계약완료 매물인데 광고중' 경고가
-- 안 뜬다 — 이 고리를 만드는 이유를 스스로 가린다.
--
-- 층은 주소 글에서만 읽는다. 매물의 floor 칸은 쓰지 않는다 — 입력 화면 기본값이 그대로 남은
-- 매물이 많아 믿을 수 없다(5층 전체 매물인데 floor = 1). 미리 돌려 보니 380건 중 1건, 같은
-- 건물·같은 값의 '3층 전체' 광고가 '5층 전체' 매물에 붙었다 — 그 때문에 층을 본다.
--
-- 사람이 손으로 정한 것(property_link = 'manual')은 절대 덮지 않는다 — 이은 것도, 끊은 것도.
-- 끊은 것까지 지키는 이유: 자동이 틀리게 이은 걸 사람이 끊어도 다음 수집 때 트리거가
-- 똑같이 다시 잇는다. 자동으로 되돌리는 길은 아래 RPC 의 'auto' 뿐이다.
--
-- 트랜잭션 안에서 돌려도, 밖에서 한 줄씩 돌려도 되게 SET LOCAL 이 아니라 SET 을 쓴다
-- (SET LOCAL 은 트랜잭션 밖에서는 경고만 내고 아무 일도 안 한다). 끝에서 되돌린다.
-- 몇 번을 다시 돌려도 같은 결과가 되게 짰다.
set lock_timeout = '5s';

alter table public.ad_listings
  add column if not exists property_id uuid null
    references public.broker_properties(id) on delete set null,
  add column if not exists property_link text null
    check (property_link in ('auto', 'manual'));

comment on column public.ad_listings.property_id is
  '이 광고가 가리키는 부소장 매물. 재등록으로 새 줄이 생겨도 같은 매물을 가리킨다.';
comment on column public.ad_listings.property_link is
  'auto = 저절로 이음(재등록 앞 줄을 물려받았거나 주소·층·호수·가격이 딱 맞음). manual = 사람이 정함 — property_id 가 '
  '있으면 사람이 이은 것, 없으면 사람이 끊은 것(자동이 다시 잇지 않는다). property_id 없이 auto 만 남은 것은 매물이 '
  '영구 삭제된 흔적이다(사람이 이은 매물이 영구 삭제되면 manual 표시도 같이 지운다).';

-- 매물 화면에서 "이 매물의 광고" 를 찾고, 매물을 지울 때 SET NULL 할 줄을 찾는다
create index if not exists ad_listings_property_id_idx
  on public.ad_listings (property_id);

-- 재등록 물려받기가 "같은 사무소·같은 소재지" 줄을 찾는 길. 사무소는 broker 로 좁힌 뒤
-- (사무소의 broker 는 몇 명뿐이다) 지역·소재지로 바로 간다 — 없으면 수집 때마다 아직 못 이은
-- 줄 하나하나가 대장 전체를 훑는다(지금 700줄 × 270번).
create index if not exists ad_listings_broker_region_detail_idx
  on public.ad_listings (broker_id, region, btrim(address_detail));

-- 주소로 맞출 때 사무소 매물 2천 건을 값으로 먼저 거르는 길. 기존 사무소 색인만으로는 값이
-- 다른 1,989건을 매번 읽고 버렸다.
create index if not exists broker_properties_office_price_idx
  on public.broker_properties (office_broker_id, price)
  where deleted_at is null;


-- ── 주소 → (동, 지번, 호수 묶음, 층 묶음, 건물 동 묶음, 지하 여부) ─────────────
--
-- 광고는 region('천안시 서북구 불당동') + address_detail('1762 제1동 1층 102호') 로,
-- 매물은 address 한 칸('충청남도 천안시 서북구 불당동 1762 102호')으로 적혀 있다.
-- 두 쪽을 같은 모양으로 줄여서 비교한다.
--
-- 동: 지번 바로 앞의 '…동/리/가'. 숫자는 뺀다(성정1동 → 성정동) — 행정동·법정동이
--     섞여 적힌다. 도·시·구는 비교하지 않으므로 충청남도/충남 표기 차이는 상관없다.
-- 지번: 본번-부번. 뒤에 숫자·한글이 바로 붙으면 지번이 아니다('1동' 의 1, '1층' 의 1).
--     '번지' 만 예외로 붙어도 된다.
--     읍·면 매물은 광고 region 이 '아산시 탕정면' 에서 끝나고 리가 address_detail 로
--     넘어가지만('매곡리 1396 …'), 이어 붙이면 똑같이 잡힌다.
--     도로명 주소·단지명만 적힌 매물은 잡히지 않는다(전부 null) — 그러면 잇지 않는다.
-- 아래 넷은 모두 **지번 뒤** 글에서만 읽는다(앞의 '불당동' 이 건물 동으로 읽히지 않게).
-- 등기부 줄임말을 먼저 푼다: '제지2층' → '제지하2층', '제비211호' → '제B211호'. 그대로 두면
--     지하 2층 B211호가 지상 2층 211호로 읽혀 **다른 호실**에 붙는다. 앞에 빈칸·'제' 가 있을
--     때만 — '1390번지 2층' 의 '지 2층' 은 지하가 아니다.
-- 호수: 층·동·차·평·번지·㎡·m·단지 가 붙은 숫자와 '지하' 를 지우고 남은 1~4자리 숫자들.
--     순서·중복은 무시한다('705호, 706호' = '706,705').
--     호수가 없으면 빈 배열 — 빈 것끼리는 같다(한 층 전체·건물 전체 매물).
-- 층: 'N층'. 지하는 음수('지하1층'·'B1층' → -1). 없으면 빈 배열.
-- 건물 동: '제1동'·'101동'·'A동'·'가동', 그리고 호수 앞에 바로 붙은 영문('A103호' 의 A).
--     대문자로 맞춘다('c동' = 'C동'). 'A동 103호' 와 'A103호' 는 같은 집이라 둘 다 {A} 로 읽는다.
--     숫자·영문은 앞에 숫자·영문이 붙어 있지 않을 때만('B1동' 의 1 이 아니게).
--     가나다 동은 앞에 한글이 붙어 있지 않을 때만 — '상가동'·'판매시설가동' 의 '가' 를
--     건물 이름으로 읽으면 한쪽만 '상가동' 이라고 적은 같은 매물이 갈린다.
--     호수 앞의 B 는 건물이 아니라 지하다('B211호') — 아래 지하 규칙과 같은 글자를 두 뜻으로
--     읽으면 'B211호' 매물과 '제3동 지하2층 B211호' 광고가 동 {B} ≠ {3,B} 로 갈린다.
-- 지하: '지하' 또는 'B' 뒤에 숫자('B132호'·'B1층'). 'B동' 은 건물이라 아니다.
--
-- 층·건물 동은 양쪽 다 적혀 있을 때만 비교한다(한쪽이 비면 통과). 광고는 등기부를 베껴
-- '제1동 1층 102호' 처럼 길게, 매물은 '102호' 처럼 짧게 적는 일이 흔해서다.
--
-- 반환 칸이 늘었다(OUT 매개변수). CREATE OR REPLACE 는 반환 모양을 못 바꾸므로 먼저 지운다 —
-- 이 함수를 부르는 것은 아래 plpgsql 함수들뿐이라 의존성 걸린 것이 없다.
drop function if exists public.ad_address_key(text);
create function public.ad_address_key(
  p_address text,
  out dong_key text,
  out jibun text,
  out ho_set int[],
  out floor_set int[],
  out bldg_set text[],
  out has_basement boolean)
language sql
immutable
set search_path = ''
as $$
  select
    regexp_replace(m[1], '[0-9]', '', 'g'),
    m[3],
    case when m is not null then array(
      select distinct n::int
      from regexp_matches(
             replace(
               regexp_replace(t, '[가-힣A-Za-z]*[0-9]+\s*(층|동|차|평|번지|㎡|m|단지)', '', 'g'),
               '지하', ''),
             '[0-9]+', 'g') as r(a),
           lateral (select a[1] as n) d
      where length(n) <= 4
      order by 1)
    end,
    case when m is not null then array(
      select distinct case when f[1] is null then f[2]::int else -f[2]::int end
      from regexp_matches(t, '(지하|[Bb])?\s*([0-9]+)\s*층', 'g') as r(f)
      where length(f[2]) <= 3
      order by 1)
    end,
    case when m is not null then array(
      select distinct upper(coalesce(b[1], b[2], b[3]))
      from regexp_matches(t,
             '(?<![0-9A-Za-z])([0-9]+|[A-Za-z])\s*동|(?<![가-힣])(?:제|주)?([가나다라마바사])\s*동|(?<![0-9A-Za-z])([AC-Zac-z])\s*[0-9]+\s*호',
             'g') as r(b)
      order by 1)
    end,
    case when m is not null then t ~ '지하|(?<![A-Za-z])[Bb]\s*[0-9]' end
  from (select regexp_match(
          p_address,
          '([가-힣]+[0-9]*(동|리|가))\s*([0-9]+(-[0-9]+)?)(?=번지|[^0-9가-힣]|$)(.*)$') as m) x
  cross join lateral (select regexp_replace(
                               regexp_replace(m[5], '(^|\s|제)지\s*([0-9]+\s*층)', '\1지하\2', 'g'),
                               '(^|\s|제)비\s*([0-9]+)', '\1B\2', 'g') as t) y
$$;

comment on function public.ad_address_key(text) is
  '주소 글 → (동, 지번, 호수 묶음, 층 묶음, 건물 동 묶음, 지하 여부). 광고 대장과 부소장 매물을 잇는 데만 쓴다.';


-- ── 가격 글 → (보증금, 월세) 만원 ───────────────────────────────────────────
--
-- 뱅크 가격은 '3,000/200'(월세), '34,000'(매매·전세) 꼴이고, 손으로 적힌 것은
-- '4.35억', '1억 2,000', '1억2천' 처럼 오기도 한다. 단위는 만원이다.
-- '/' 가 없으면 월세 0 — 매물 쪽도 월세가 비면 0 으로 보고 비교한다.
-- 못 읽는 글('협의' 등)은 null — 그러면 잇지 않는다. 오류는 내지 않는다(트리거에서 돈다).
-- 숫자가 하나도 없으면('만' 만 남은 것, 빈 칸) 0 이 아니라 null 이다 — 0 으로 읽으면
-- 가격을 비워 둔(0) 매물과 맞아 버린다.
create or replace function public.ad_price_manwon(p_text text)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case
    when m is null or (m[2] is null and m[5] is null and m[7] is null) then null
    else round(coalesce(m[2]::numeric, 0) * 10000
             + coalesce(m[5]::numeric, 0) * 1000
             + coalesce(m[7]::numeric, 0))::bigint
  end
  from (select regexp_match(s, '^(([0-9]{1,6}(\.[0-9]+)?)억)?(([0-9]{1,6}(\.[0-9]+)?)천)?([0-9]{1,12})?만?$') as m
        from (select regexp_replace(coalesce(p_text, ''), '[,\s원]', '', 'g') as s) y) x
$$;

create or replace function public.ad_price_split(
  p_price_text text,
  out deposit bigint,
  out rent bigint)
language sql
immutable
set search_path = ''
as $$
  select public.ad_price_manwon(split_part(p_price_text, '/', 1)),
         case when strpos(p_price_text, '/') > 0
              then public.ad_price_manwon(split_part(p_price_text, '/', 2))
              else 0 end
$$;

comment on function public.ad_price_split(text) is
  '가격 글 → (보증금, 월세) 만원. 월세가 없으면 0, 못 읽으면 null.';

-- 화면에서 쓸 일이 없다. 아래 연결 함수(소유자 권한)만 부른다.
revoke execute on function public.ad_address_key(text) from public, anon, authenticated;
revoke execute on function public.ad_price_manwon(text) from public, anon, authenticated;
revoke execute on function public.ad_price_split(text) from public, anon, authenticated;


-- ── 광고 한 줄을 매물에 잇는다 ──────────────────────────────────────────────
--
-- 이미 이어져 있으면(자동이든 손이든) 손대지 않고 그 매물을 돌려준다. 사람이 끊어 둔
-- 것(manual 인데 매물 없음)도 손대지 않는다. 못 이으면 null.
-- 소유자 권한으로 도는 이유: 트리거가 부르므로 부르는 사람이 누구든(PC 프로그램·직원)
-- 같은 사무소 매물 전체를 봐야 같은 답이 나온다. 사무소 밖은 보지 않는다.
--
-- 광고의 사무소 = 광고 broker 의 parent_broker_id(직원이면 사장님), 없으면 자기 자신.
-- 매물의 office_broker_id 를 채우는 트리거(set_office_broker_id)와 같은 규칙이다.
-- 지금 대장은 전부 사장님 broker_id 로 들어오지만, 직원 계정으로 들어와도 같은 사무소
-- 매물을 봐야 한다.
--
-- plan_cache_mode: 물려받기 조회의 `v_listing.region is null or …` 는 값을 넣고 계획해야
-- 상수로 접혀 (broker_id, region, btrim(address_detail)) 색인을 끝까지 탄다. 범용 계획으로
-- 바뀌면 broker_id 만 색인으로 가고 나머지는 걸러 읽는다. 계획 비용은 정규식 비용에 비하면
-- 없는 셈이라 늘 값으로 계획한다.
create or replace function public.link_ad_listing_property(p_listing uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
as $$
declare
  v_listing public.ad_listings%rowtype;
  v_office uuid;
  v_prev record;
  v_key record;
  v_price record;
  v_all uuid[];
  v_sure boolean;
  v_pick_bldg_n int;
  v_pick uuid;
begin
  select * into v_listing from public.ad_listings where id = p_listing;
  if not found or v_listing.property_id is not null or v_listing.property_link = 'manual' then
    return v_listing.property_id;
  end if;

  select coalesce(b.parent_broker_id, b.id) into v_office
  from public.broker_profiles b where b.id = v_listing.broker_id;

  -- 1. 재등록 물려받기 — 같은 사무소·같은 소재지·같은 가격 글의 다른 줄 중 **답이 정해진** 것.
  --    가격까지 같아야 하는 이유: 같은 호실을 값만 바꿔 새로 낸 광고는 다른 매물(새로 받은
  --    의뢰)일 수 있다. 그때는 아래 주소 규칙에 맡긴다.
  --    답이 정해진 줄 = 사람이 정한 줄(manual, 끊은 것 포함), 또는 자동으로 이어졌고 그 매물이
  --    휴지통에 없고 계약으로 닫히지 않은 줄. 아직 못 이은 줄은 답이 아니다 — 그 줄만 보고
  --    말면 그 뒤의 사람 답(더 오래된 줄에 있을 수 있다)을 영영 못 본다.
  --    사람 답을 먼저, 그다음 최근 순 — 어느 줄에 있든 사람 답이 자동보다 앞선다.
  --    region 은 '=' 로 비교한다(색인). 양쪽 다 비었을 때만 null 끼리도 같다고 본다.
  select o.property_id, o.property_link into v_prev
  from public.ad_listings o
  join public.broker_profiles ob on ob.id = o.broker_id
  left join public.broker_properties p on p.id = o.property_id
  where o.id <> v_listing.id
    and coalesce(ob.parent_broker_id, ob.id) = v_office
    and (o.region = v_listing.region or (v_listing.region is null and o.region is null))
    and btrim(o.address_detail) = btrim(v_listing.address_detail)
    and o.price_text is not distinct from v_listing.price_text
    and (o.property_link = 'manual'
         or (o.property_id is not null and p.deleted_at is null and o.contracted_at is null))
  order by (o.property_link = 'manual') desc, o.created_at desc, o.id desc
  limit 1;

  if found then
    -- 사람이 정한 것은 끊은 것(property_id 없음)까지 그대로 — 그래야 재등록 뒤에도 다시
    -- 안 붙는다. 자동으로 이어진 것은 자동으로 물려받는다(사람이 정한 것과 섞이지 않게).
    -- 조건을 다시 건다 — 그 사이 사람이 손으로 잇거나 끊었으면 그게 이긴다.
    update public.ad_listings
       set property_id = v_prev.property_id,
           property_link = case when v_prev.property_link = 'manual' then 'manual' else 'auto' end
     where id = p_listing and property_id is null and property_link is distinct from 'manual'
    returning property_id into v_pick;
    return v_pick;
  end if;

  -- 2. 주소로 맞추기
  select * into v_key from public.ad_address_key(concat_ws(' ', v_listing.region, v_listing.address_detail));
  select * into v_price from public.ad_price_split(v_listing.price_text);
  if v_key.jibun is null or v_price.deposit is null or v_price.rent is null then
    return null;
  end if;

  -- 가격(정수 비교)과 지번 글자(주소에 그 지번이 들어 있나)로 먼저 추린 뒤에만 주소를
  -- 푼다. 둘 다 맞아야 할 조건이라 빠지는 후보는 없다. 정규식은 비싸고, 트리거는 수집
  -- 때마다 아직 못 이은 줄 전부에 대해 돈다 — 사무소 매물 2천 건을 매번 다 풀면
  -- PC 프로그램의 저장(한 번에 700줄)이 API 시간 제한에 걸릴 수 있다.
  --
  -- 거래 종류: 매물은 '매매, 월세' 처럼 여럿을 적으므로 들어 있기만 하면 된다. 광고나
  -- 매물 쪽이 비었으면 따지지 않는다(비교할 것이 없다).
  with rough as materialized (
    select bp.id, bp.address
    from public.broker_properties bp
    where bp.office_broker_id = v_office
      and bp.deleted_at is null
      and bp.price = v_price.deposit
      and coalesce(bp.monthly_rent, 0) = v_price.rent
      and strpos(bp.address, v_key.jibun) > 0
      and (v_listing.deal_type is null
           or coalesce(bp.deal_type, '') = ''
           or strpos(bp.deal_type, v_listing.deal_type) > 0)
  ),
  -- 층·건물 동은 양쪽 다 적혀 있을 때만 비교한다(known) — 한쪽이 비면 비교할 것이 없다.
  -- 지하: 'B132호' 와 '132호' 는 호수 묶음이 같다(둘 다 132). 층이나 호수를 양쪽이 다 말할
  -- 때 한쪽만 지하면 다른 칸이다. 둘 다 아무것도 안 말하면(건물 전체) 따지지 않는다.
  judged as (
    select c.id, k.bldg_set,
           f.known as floor_known, f.known and k.floor_set <> v_key.floor_set as floor_bad,
           b.known as bldg_known,  b.known and k.bldg_set <> v_key.bldg_set as bldg_bad,
           s.known as base_known,  s.known and k.has_basement <> v_key.has_basement as base_bad
    from rough c
    cross join lateral public.ad_address_key(c.address) k
    cross join lateral (select cardinality(k.floor_set) > 0 and cardinality(v_key.floor_set) > 0 as known) f
    cross join lateral (select cardinality(k.bldg_set) > 0 and cardinality(v_key.bldg_set) > 0 as known) b
    cross join lateral (select (cardinality(k.floor_set) > 0 or cardinality(k.ho_set) > 0)
                           and (cardinality(v_key.floor_set) > 0 or cardinality(v_key.ho_set) > 0) as known) s
    where k.dong_key = v_key.dong_key
      and k.jibun = v_key.jibun
      and k.ho_set = v_key.ho_set
  ),
  cut as (
    select j.*,
           not (j.floor_bad or j.bldg_bad or j.base_bad) as pass,
           bool_or(j.floor_bad) over () as floor_cut,
           bool_or(j.bldg_bad) over () as bldg_cut,
           bool_or(j.base_bad) over () as base_cut
    from judged j
  )
  -- 층·동·지하로 다른 후보를 떨어뜨려 하나가 남았다면, 남은 것도 **그 칸에서 맞다고**
  -- 말해야 한다. 그 칸이 비어 있어 '안 틀렸을 뿐' 인 매물이 이기면 안 된다 —
  -- 미리 돌려 보니 '1544 제15동 D114호' 광고가, 'D동 114호' 매물이 동 때문에 빠지자
  -- 동이 안 적힌 '1544 / 114호' 매물(같은 값의 A114호 광고 둘이 이미 가리키는 것)로 갔다.
  -- 남은 하나의 동 개수도 같이 꺼낸다(아래 '건물 여럿' 검사에 쓴다). 하나뿐일 때만 쓰므로
  -- max 가 곧 그 매물의 값이다.
  select array_agg(c.id) filter (where c.pass),
         bool_and((c.floor_known or not c.floor_cut)
              and (c.bldg_known or not c.bldg_cut)
              and (c.base_known or not c.base_cut)) filter (where c.pass),
         max(cardinality(c.bldg_set)) filter (where c.pass)
    into v_all, v_sure, v_pick_bldg_n
  from cut c;

  -- 딱 하나일 때만. 여럿이면 어느 것인지 사람이 고른다(위 머리말 참고).
  if cardinality(v_all) is distinct from 1 or not v_sure then
    return null;
  end if;

  -- 한 지번에 건물이 여럿일 때: 광고는 동을 적었는데 남은 매물은 동을 안 적었고, 같은 사무소의
  -- 다른 매물(값은 상관없이)이 같은 지번에 **다른** 동을 적고 있으면 잇지 않는다. 그 지번에
  -- 동이 갈리는 걸 장부가 알고 있는데 동 없는 매물이 어느 동인지는 모른다 — 미리 돌려 보니
  -- '모시리 296' (동 없음) 매물 하나가 'A동 창고' 광고와 'B동 창고' 광고를 둘 다 받았다.
  -- 그 매물이 계약되면 두 동의 광고에 다 '계약완료 매물인데 광고중' 이 뜬다.
  if cardinality(v_key.bldg_set) > 0 and v_pick_bldg_n = 0 and exists (
       select 1
       from public.broker_properties o
       cross join lateral public.ad_address_key(o.address) ok
       where o.office_broker_id = v_office
         and o.deleted_at is null
         and o.id <> v_all[1]
         and strpos(o.address, v_key.jibun) > 0
         and ok.dong_key = v_key.dong_key
         and ok.jibun = v_key.jibun
         and cardinality(ok.bldg_set) > 0
         and ok.bldg_set <> v_key.bldg_set) then
    return null;
  end if;

  -- 조건을 다시 건다 — 그 사이 사람이 손으로 잇거나 끊었으면 그게 이긴다
  update public.ad_listings
     set property_id = v_all[1], property_link = 'auto'
   where id = p_listing and property_id is null and property_link is distinct from 'manual'
  returning property_id into v_pick;
  return v_pick;
end;
$$;

comment on function public.link_ad_listing_property(uuid) is
  '광고 대장 한 줄을 같은 사무소의 부소장 매물에 잇는다 — 재등록 전 줄의 연결을 먼저 물려받고, '
  '없으면 주소·층·동·호수·가격·거래종류가 딱 맞는 매물이 하나일 때만. 이미 이어진 것·사람이 정한 것은 덮지 않는다.';

-- 트리거·아래 RPC·한 번 채우기만 부른다
revoke execute on function public.link_ad_listing_property(uuid) from public, anon, authenticated;


-- ── 새 줄·바뀐 줄마다 다시 맞춘다 ──────────────────────────────────────────
--
-- PC 프로그램은 [가져오기] 때마다 대장 전체를 upsert 한다. 그때마다 아직 못 이은
-- 줄은 다시 맞춰 본다 — 광고보다 매물을 늦게 등록해도 다음 수집 때 이어진다.
-- 재등록으로 생긴 새 줄도 여기서 이어진다(앞 줄의 연결을 물려받는다).
--
-- 연결은 덤이다. 여기서 무슨 일이 나도 대장 저장(upsert)은 그대로 통과시킨다.
-- 소유자 권한인 이유: 연결 함수의 실행 권한을 일반 계정에서 닫았기 때문이다.
create or replace function public.ad_listings_link_property_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform public.link_ad_listing_property(new.id);
  exception when others then
    raise warning 'ad_listings % 매물 연결 건너뜀: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.ad_listings_link_property_trg() from public, anon, authenticated;

-- 연결 함수가 쓰는 칸은 property_id·property_link 뿐이라 이 트리거를 다시 부르지 않는다.
-- 이미 이어진 줄, 사람이 끊어 둔 줄(manual)은 WHEN 에서 걸러 함수까지 가지도 않는다.
drop trigger if exists ad_listings_link_property on public.ad_listings;
create trigger ad_listings_link_property
  after insert or update of region, address_detail, price_text on public.ad_listings
  for each row
  when (new.property_id is null and new.property_link is distinct from 'manual')
  execute function public.ad_listings_link_property_trg();


-- ── 다른 사무소 매물에는 잇지 못한다 ────────────────────────────────────────
--
-- 광고 대장의 수정 권한(RLS)은 줄 단위라, 화면이 property_id 에 아무 uuid 나 넣는 것까지는
-- 막지 못한다. 남의 사무소 매물에 이어지면 그 매물의 번호·주소·상태가 우리 화면에 새고,
-- 그 매물이 계약되면 우리 광고에 경고가 뜬다. 여기서 막는다.
-- 소유자 권한인 이유: 직원은 매물을 다 못 볼 수 있다(RLS) — 그러면 같은 사무소 매물도
-- '없음' 으로 보여 막힌다.
--
-- PC 프로그램의 upsert 는 property_id 를 보내지 않는다 — 새 줄은 null 이라 WHEN 에서
-- 걸러지고, 기존 줄 갱신은 SET 에 property_id·broker_id 가 없어 UPDATE OF 에 안 걸린다.
-- 매물이 없는 uuid 는 여기서 따지지 않는다 — 외래키가 알맞은 오류로 막는다.
-- broker_id 가 바뀔 때도 본다 — 이어진 광고를 다른 사무소 broker 로 옮기면 고리가 사무소를
-- 넘는다(관리자는 RLS 로 할 수 있다).
create or replace function public.ad_listings_same_office_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prop_office uuid;
  v_ad_office uuid;
begin
  select p.office_broker_id into v_prop_office
  from public.broker_properties p where p.id = new.property_id;
  if not found then
    return new;
  end if;

  select coalesce(b.parent_broker_id, b.id) into v_ad_office
  from public.broker_profiles b where b.id = new.broker_id;

  if v_prop_office is distinct from v_ad_office then
    raise exception '다른 사무소의 매물에는 광고를 이을 수 없습니다'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.ad_listings_same_office_guard() from public, anon, authenticated;

drop trigger if exists ad_listings_property_same_office on public.ad_listings;
create trigger ad_listings_property_same_office
  before insert or update of property_id, broker_id on public.ad_listings
  for each row
  when (new.property_id is not null)
  execute function public.ad_listings_same_office_guard();


-- ── 사람이 이은 매물이 영구 삭제되면 그 손 표시도 푼다 ───────────────────────
--
-- 외래키가 property_id 를 null 로 만들면 manual 만 남아 '사람이 끊은 것' 과 똑같아진다.
-- 그러면 그 광고는 다시는 자동으로 이어지지 않는다 — 사람은 끊은 적이 없는데.
-- 지우기 전에 manual 을 지워 둔다(외래키는 그 뒤에 property_id 를 비운다).
-- 자동(auto)은 그대로 둔다 — property_id 가 비면 트리거가 다시 맞추는 대상이 된다.
-- 소유자 권한인 이유: 매물을 지운 사람이 그 광고 줄을 고칠 권한(RLS)이 없을 수 있다
-- (자기 매물을 지우는 직원, 휴지통 비우기 예약 작업).
create or replace function public.broker_properties_release_manual_ads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ad_listings
     set property_link = null
   where property_id = old.id and property_link = 'manual';
  return old;
end;
$$;

revoke execute on function public.broker_properties_release_manual_ads() from public, anon, authenticated;

drop trigger if exists broker_properties_release_manual_ads on public.broker_properties;
create trigger broker_properties_release_manual_ads
  before delete on public.broker_properties
  for each row
  execute function public.broker_properties_release_manual_ads();


-- ── 화면에서 손으로 잇기·끊기·자동으로 되돌리기 ────────────────────────────
--
-- 사람은 매물을 번호(#1188)로 부른다. 번호는 사무소 안에서 매기므로 광고의 사무소에서 찾는다.
-- p_mode —
--   'set'  : p_seq_no 의 매물에 잇는다(manual). p_seq_no 가 null 이면 끊는다(manual + 매물 없음 —
--            자동이 다시 잇지 않는다).
--   'auto' : 사람 표시를 지우고(property_id·property_link 모두 null) 자동 규칙을 바로 다시 돌린다.
--            잘못 누른 [연결 끊기] 를 되돌리는 길 — 끊은 것(manual)은 재등록 줄에도 물려지므로
--            되돌릴 길이 없으면 그 광고 계보는 영영 자동으로 안 이어진다. 같은 줄기(사무소·소재지·
--            가격)에서 **같은 사람 답**을 가진 줄도 함께 지운다 — 하나만 지우면 바로 다시 물려받는다.
--            p_seq_no 는 보지 않는다.
-- 휴지통 매물에는 잇지 않는다 — 화면이 그 매물을 보여 줄 수 없다(RLS).
--
-- 권한은 광고 대장 수정(RLS ad_listings_update)과 같은 can_manage_office_ads 로 본다.
-- 없는 광고와 권한 없는 광고는 같은 오류(42501)로 답한다 — 다른 사무소가 uuid 가 있는지
-- 없는지를 이 함수로 알아낼 수 없게.
-- 소유자 권한으로 도는 이유: 직원은 사무소 매물을 다 못 볼 수 있어(RLS), 번호로 찾는
-- 일 자체가 직원 화면에서 갈린다.
--
-- 매개변수가 늘어 모양이 바뀌었다. 두 개짜리를 두면 PostgREST 가 {p_listing, p_seq_no} 호출을
-- 둘 중 어느 것인지 못 골라(300) 실패하므로 먼저 지운다.
drop function if exists public.set_ad_listing_property(uuid, integer);
create or replace function public.set_ad_listing_property(
  p_listing uuid,
  p_seq_no integer,
  p_mode text default 'set')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_broker uuid;
  v_office uuid;
  v_found uuid[];
  v_me public.ad_listings%rowtype;
  v_same uuid[];
  v_id uuid;
  v_result uuid;
begin
  if p_mode is distinct from 'set' and p_mode is distinct from 'auto' then
    raise exception 'p_mode 는 set 또는 auto 여야 합니다: %', p_mode
      using errcode = '22023';
  end if;

  select l.broker_id, coalesce(b.parent_broker_id, b.id) into v_broker, v_office
  from public.ad_listings l
  join public.broker_profiles b on b.id = l.broker_id
  where l.id = p_listing;

  if not found or not coalesce(public.can_manage_office_ads(v_broker), false) then
    raise exception '이 광고의 매물 연결을 바꿀 권한이 없습니다.'
      using errcode = '42501';
  end if;

  if p_mode = 'auto' then
    -- 이 줄만 지우면 되돌리기가 안 된다. 재등록된 광고는 같은 소재지·가격의 다른 줄에서
    -- 사람 답(끊은 것 포함)을 물려받는데, 그 줄들에도 같은 답이 복사돼 있어 하나를 지우면
    -- 바로 다시 물려받는다 — 둘 다 영영 manual 로 남는다. 그래서 **같은 사람 답을 가진
    -- 같은 줄기(사무소·region·소재지·가격)의 manual 줄을 모두** 지우고 오래된 것부터 다시
    -- 찾는다. 다른 매물로 손수 이어 둔 형제는 건드리지 않는다 — 그건 다른 답이다.
    -- property_id 가 null 이 되는 갱신은 같은 사무소 검사(WHEN property_id is not null)에도,
    -- 연결 트리거(region·address_detail·price_text 가 바뀔 때)에도 안 걸린다. 그래서 바로 부른다.
    select * into v_me from public.ad_listings where id = p_listing;
    select array_agg(o.id order by o.created_at, o.id) into v_same
    from public.ad_listings o
    join public.broker_profiles ob on ob.id = o.broker_id
    where o.id <> p_listing
      and o.property_link = 'manual'
      and o.property_id is not distinct from v_me.property_id
      and coalesce(ob.parent_broker_id, ob.id) = v_office
      and (o.region = v_me.region or (v_me.region is null and o.region is null))
      and btrim(o.address_detail) = btrim(v_me.address_detail)
      and o.price_text is not distinct from v_me.price_text;
    v_same := coalesce(v_same, '{}'::uuid[]) || p_listing;
    update public.ad_listings
       set property_id = null, property_link = null
     where id = any(v_same);
    foreach v_id in array v_same loop
      v_result := public.link_ad_listing_property(v_id);
    end loop;
    -- 마지막이 p_listing — 그 결과를 돌려준다.
    return v_result;
  end if;

  if p_seq_no is null then
    update public.ad_listings
       set property_id = null, property_link = 'manual'
     where id = p_listing;
    return null;
  end if;

  select array_agg(p.id) into v_found
  from public.broker_properties p
  where p.office_broker_id = v_office
    and p.seq_no = p_seq_no
    and p.deleted_at is null;

  if v_found is null then
    raise exception '매물 #% 이(가) 없습니다. 번호를 확인해 주세요 (휴지통에 든 매물은 이을 수 없습니다).', p_seq_no;
  end if;
  -- 번호는 사무소마다 하나씩 매기지만 DB 가 막지는 않는다 — 겹치면 고르지 않는다
  if cardinality(v_found) > 1 then
    raise exception '매물 #% 이(가) 여러 개입니다. 매물 화면에서 번호를 확인해 주세요.', p_seq_no;
  end if;

  update public.ad_listings
     set property_id = v_found[1], property_link = 'manual'
   where id = p_listing;
  return v_found[1];
end;
$$;

comment on function public.set_ad_listing_property(uuid, integer, text) is
  '광고 한 줄을 매물 번호로 손수 잇는다(manual). 번호가 null 이면 끊는다 — 자동이 다시 잇지 않는다. '
  'p_mode = ''auto'' 면 사람 표시를 지우고 자동 규칙을 다시 돌린다.';

revoke execute on function public.set_ad_listing_property(uuid, integer, text) from public, anon;
grant execute on function public.set_ad_listing_property(uuid, integer, text) to authenticated;


-- ── 지금 있는 줄을 한 번 채운다 ────────────────────────────────────────────
--
-- 오래된 줄부터 — 재등록 물려받기가 앞 줄의 답을 보므로 앞 줄이 먼저 정해져 있는 편이 낫다.
-- 다시 돌려도 이미 이어진 줄·사람이 정한 줄은 함수가 건너뛴다.
do $$
declare
  r record;
begin
  for r in
    select l.id from public.ad_listings l
    where l.property_id is null and l.property_link is distinct from 'manual'
    order by l.created_at, l.id
  loop
    perform public.link_ad_listing_property(r.id);
  end loop;
end;
$$;

reset lock_timeout;

-- PostgREST 가 새 칸(property_id)·새 RPC 모양을 바로 알게 한다 — 안 하면 캐시가 갈릴 때까지
-- 화면의 매물 끼워넣기(embed)가 PGRST200 으로 떨어진다.
notify pgrst, 'reload schema';
