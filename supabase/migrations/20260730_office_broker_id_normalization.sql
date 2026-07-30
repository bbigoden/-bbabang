-- 멀티테넌트 보강 1단계: 매물장·고객장 office_broker_id 정규화.
--
-- 배경: 매물장·고객장의 사무소 스코프 조회만 "클라이언트가 직원 id 목록을 조립해 .in()" 하는
-- 레거시 방식이었다. (a) 페이지 로드마다 직원 목록 왕복 1회 추가, (b) 조립 누락 시 데이터 누락
-- 사고 후보, (c) RPC가 uuid[] 기반이라 인덱스 효율이 나쁨. 정산·일정·자료실·메신저와 같은
-- office_broker_id 단일 컬럼 방식으로 통일한다.
--
-- office_broker_id = 사무소 대표의 broker_profiles.id (자료실 패턴과 동일).
-- 값은 트리거가 broker_id에서 자동 산출 — 구 클라이언트·텔레그램 등록봇의 INSERT도 자동으로
-- 채워지므로 배포 순서 제약이 없다. 사무소 탈퇴는 transfer_broker_data가 broker_id를 대표로
-- UPDATE 하므로 UPDATE OF broker_id에도 걸어 재계산한다.

ALTER TABLE public.broker_properties ADD COLUMN IF NOT EXISTS office_broker_id uuid REFERENCES public.broker_profiles(id);
ALTER TABLE public.broker_customers  ADD COLUMN IF NOT EXISTS office_broker_id uuid REFERENCES public.broker_profiles(id);

CREATE OR REPLACE FUNCTION public.set_office_broker_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  SELECT coalesce(bp.parent_broker_id, bp.id) INTO NEW.office_broker_id
  FROM broker_profiles bp WHERE bp.id = NEW.broker_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bprops_set_office ON public.broker_properties;
CREATE TRIGGER trg_bprops_set_office
  BEFORE INSERT OR UPDATE OF broker_id ON public.broker_properties
  FOR EACH ROW EXECUTE FUNCTION public.set_office_broker_id();

DROP TRIGGER IF EXISTS trg_bcust_set_office ON public.broker_customers;
CREATE TRIGGER trg_bcust_set_office
  BEFORE INSERT OR UPDATE OF broker_id ON public.broker_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_office_broker_id();

-- 기존 데이터 백필 (휴지통 행 포함 전건)
UPDATE public.broker_properties t SET office_broker_id = coalesce(bp.parent_broker_id, bp.id)
FROM public.broker_profiles bp WHERE bp.id = t.broker_id AND t.office_broker_id IS NULL;

UPDATE public.broker_customers t SET office_broker_id = coalesce(bp.parent_broker_id, bp.id)
FROM public.broker_profiles bp WHERE bp.id = t.broker_id AND t.office_broker_id IS NULL;

-- 활성 행 조회가 핫패스 — 휴지통 화면은 소량이라 부분 인덱스로 충분
CREATE INDEX IF NOT EXISTS idx_broker_properties_office ON public.broker_properties (office_broker_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_broker_customers_office  ON public.broker_customers  (office_broker_id) WHERE deleted_at IS NULL;

-- ── search_office_properties: p_office 단일 스코프 지원 ─────────────────────
-- p_office가 오면 office_broker_id = p_office 로 조회(신규 경로), 없으면 기존 p_broker_ids
-- 배열 경로(어드민 개별 열람·배포 직후 구 클라이언트)를 유지한다. 파라미터를 뒤에 DEFAULT로만
-- 추가하되, 부분 named-arg 호출이 두 오버로드에 모두 매칭되는 ambiguous를 막기 위해 구 시그니처는
-- 명시적으로 DROP (20260730_search_office_properties_filters.sql과 동일한 절차).
DROP FUNCTION IF EXISTS public.search_office_properties(uuid[], text, text, text[], text, text, text, int, int, text[], numeric, numeric, numeric, numeric, numeric, numeric, int, int);

CREATE OR REPLACE FUNCTION public.search_office_properties(
  p_broker_ids uuid[] DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_deal_type text DEFAULT NULL,
  p_room_types text[] DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort_key text DEFAULT NULL,
  p_sort_dir text DEFAULT 'desc',
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0,
  p_assignees text[] DEFAULT NULL,
  p_price_min numeric DEFAULT NULL,
  p_price_max numeric DEFAULT NULL,
  p_rent_min numeric DEFAULT NULL,
  p_rent_max numeric DEFAULT NULL,
  p_pyeong_min numeric DEFAULT NULL,
  p_pyeong_max numeric DEFAULT NULL,
  p_floor_min int DEFAULT NULL,
  p_floor_max int DEFAULT NULL,
  p_office uuid DEFAULT NULL
)
RETURNS TABLE (data jsonb, total_count bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  sort_dir text;
  order_expr text;
  q_pat text;
BEGIN
  -- 정렬 방향
  sort_dir := CASE WHEN lower(coalesce(p_sort_dir,'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;

  -- 정렬 키 화이트리스트 (동적 SQL 삽입 차단). 목록 밖이면 created_at.
  -- size_pyeong/total_floors는 텍스트 컬럼이지만 숫자로 정렬해야 자연스럽다
  -- (클라이언트도 숫자 파싱 정렬이었음) → 숫자만 추출해 캐스팅.
  order_expr := CASE
    WHEN p_sort_key IN ('size_pyeong','total_floors')
      THEN format('NULLIF(split_part(regexp_replace(coalesce(p.%I,''''), ''[^0-9.]'', '''', ''g''), ''.'', 1), '''')::numeric', p_sort_key)
    WHEN p_sort_key IN (
      'seq_no','address','deal_type','room_type','price','monthly_rent','management_fee',
      'premium','area_supplied','area_type','area_unit','floor',
      'move_in_date','rooms_bathrooms','approval_date','received_date','parking','direction',
      'brief_memo','description','memo','assignee','status','created_at'
    ) THEN format('p.%I', p_sort_key)
    ELSE 'p.created_at'
  END;

  q_pat := '%' || p_q || '%';

  RETURN QUERY EXECUTE format(
    'SELECT to_jsonb(p.*) AS data, count(*) OVER() AS total_count
     FROM broker_properties p
     WHERE (($18::uuid IS NOT NULL AND p.office_broker_id = $18)
            OR ($18::uuid IS NULL AND p.broker_id = ANY($1)))
       AND p.deleted_at IS NULL
       AND ($2 IS NULL OR $2 = ANY(SELECT btrim(x) FROM unnest(string_to_array(coalesce(p.deal_type,''''), '','')) AS x))
       AND ($3 IS NULL OR p.room_type = ANY($3))
       AND ($4 IS NULL OR p.status = $4)
       AND ($9 IS NULL OR EXISTS (
             SELECT 1 FROM unnest(string_to_array(coalesce(p.assignee,''''), '','')) AS a
             WHERE btrim(a) = ANY($9)))
       AND ($10 IS NULL OR p.price >= $10)
       AND ($11 IS NULL OR p.price <= $11)
       AND ($12 IS NULL OR p.monthly_rent >= $12)
       AND ($13 IS NULL OR p.monthly_rent <= $13)
       AND ($14 IS NULL OR (regexp_match(coalesce(p.size_pyeong,''''), ''[0-9]+\.?[0-9]*''))[1]::numeric >= $14)
       AND ($15 IS NULL OR (regexp_match(coalesce(p.size_pyeong,''''), ''[0-9]+\.?[0-9]*''))[1]::numeric <= $15)
       AND ($16 IS NULL OR p.floor >= $16)
       AND ($17 IS NULL OR p.floor <= $17)
       AND ($5 IS NULL OR concat_ws('' '',
             p.seq_no::text, p.address, p.deal_type, p.room_type,
             p.size_pyeong, p.area_supplied::text, p.area_type, p.area_unit,
             p.price::text, p.monthly_rent::text, p.management_fee::text, p.premium::text,
             p.floor::text, p.total_floors, p.move_in_date, p.rooms_bathrooms,
             p.approval_date, p.received_date::text, p.parking, p.direction,
             p.brief_memo, p.description, p.memo, p.assignee, p.status,
             CASE p.status WHEN ''available'' THEN ''거래가능'' WHEN ''contracted'' THEN ''계약완료'' WHEN ''hidden'' THEN ''숨김'' END,
             array_to_string(p.options, '' ''),
             p.custom_fields::text
           ) ILIKE $6)
     ORDER BY %s %s NULLS LAST, p.id DESC
     LIMIT $7 OFFSET $8',
    order_expr, sort_dir)
  USING p_broker_ids, p_deal_type, p_room_types, p_status, p_q, q_pat, p_limit, p_offset,
        p_assignees, p_price_min, p_price_max, p_rent_min, p_rent_max,
        p_pyeong_min, p_pyeong_max, p_floor_min, p_floor_max, p_office;
END;
$$;

REVOKE ALL ON FUNCTION public.search_office_properties(uuid[], text, text, text[], text, text, text, int, int, text[], numeric, numeric, numeric, numeric, numeric, numeric, int, int, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.search_office_properties(uuid[], text, text, text[], text, text, text, int, int, text[], numeric, numeric, numeric, numeric, numeric, numeric, int, int, uuid) TO authenticated;
