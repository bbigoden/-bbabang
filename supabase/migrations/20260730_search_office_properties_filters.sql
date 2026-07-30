-- 매물장 필터 확장: 담당자·가격(보증금/매매)·월세·평수·층수 범위 조건 추가.
-- 기존 파라미터는 그대로 두고 뒤에 DEFAULT NULL 파라미터만 추가 → 배포된 구 클라이언트의
-- named-arg 호출도 계속 동작한다. 시그니처가 달라지므로 구 함수는 명시적으로 DROP
-- (남겨두면 부분 named-arg 호출이 두 오버로드에 모두 매칭돼 ambiguous 에러).
--
-- 조건 의미:
--   p_assignees   담당자 이름 배열 — assignee가 "김용유, 김가주"처럼 콤마 다중 저장이라
--                 분리 후 트림 매칭 (하나라도 겹치면 포함)
--   p_price_min/max   price(보증금·매매가, 만원) 범위. NULL 필드는 범위 지정 시 제외됨
--   p_rent_min/max    monthly_rent(월세, 만원) 범위
--   p_pyeong_min/max  size_pyeong(텍스트)에서 첫 숫자를 뽑아 numeric 비교 (정렬과 동일 관례)
--   p_floor_min/max   floor(int) 범위
DROP FUNCTION IF EXISTS public.search_office_properties(uuid[], text, text, text[], text, text, text, int, int);

CREATE OR REPLACE FUNCTION public.search_office_properties(
  p_broker_ids uuid[],
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
  p_floor_max int DEFAULT NULL
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
     WHERE p.broker_id = ANY($1)
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
        p_pyeong_min, p_pyeong_max, p_floor_min, p_floor_max;
END;
$$;

REVOKE ALL ON FUNCTION public.search_office_properties(uuid[], text, text, text[], text, text, text, int, int, text[], numeric, numeric, numeric, numeric, numeric, numeric, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.search_office_properties(uuid[], text, text, text[], text, text, text, int, int, text[], numeric, numeric, numeric, numeric, numeric, numeric, int, int) TO authenticated;
