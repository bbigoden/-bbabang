-- 지도 뷰 RPC: 현재 필터에 걸리는 매물 "전부"를 JSON 배열 하나로 돌려준다.
-- 전에는 지도도 search_office_properties(p_limit 10000)를 불렀는데, 행 집합(SETOF)이라
-- PostgREST max-rows(1000)에 조용히 잘려 사무소 매물 1,978건 중 최신 1,000건만 핀이 찍혔다.
-- 값 하나(json)로 내보내면 행 수 상한에 안 걸린다. 칸도 지도·우측 패널이 읽는 것만
-- 담는다(전 칸 to_jsonb 2.2MB → 0.78MB, 실측 27ms). 거르는 조건·정렬은 목록 RPC와 같다 —
-- 패널의 [목록에서 열기]가 배열 순번으로 목록 페이지를 계산하기 때문.
-- 메모(memo) 등 패널에 안 나오는 칸은 일부러 뺐다.

CREATE OR REPLACE FUNCTION public.map_office_properties(
  p_broker_ids uuid[] DEFAULT NULL,
  p_q text DEFAULT NULL,
  p_deal_type text DEFAULT NULL,
  p_room_types text[] DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort_key text DEFAULT NULL,
  p_sort_dir text DEFAULT 'desc',
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
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  sort_dir text;
  order_expr text;
  q_pat text;
  q_flat text;
  ws text;
  result json;
BEGIN
  -- 정렬 키·방향·검색어 처리는 search_office_properties 와 똑같이 (검색은 translate 판)
  sort_dir := CASE WHEN lower(coalesce(p_sort_dir,'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;

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
  ws := ' ' || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160) || chr(12288);
  q_flat := '%' || translate(coalesce(p_q,''), ws, '') || '%';

  -- 페이지로 자르지 않으니 id 만 먼저 고르는 CTE 가 필요 없다 — 한 번 훑으며 바로 모은다.
  -- 순서는 목록 RPC 의 row_number() 정렬(정렬식 NULLS LAST, p.id DESC)과 같다.
  EXECUTE format(
    'SELECT coalesce(json_agg(json_build_object(
             ''id'', p.id, ''seq_no'', p.seq_no, ''address'', p.address,
             ''deal_type'', p.deal_type, ''room_type'', p.room_type, ''status'', p.status,
             ''price'', p.price, ''monthly_rent'', p.monthly_rent,
             ''size_pyeong'', p.size_pyeong, ''floor'', p.floor, ''total_floors'', p.total_floors,
             ''brief_memo'', p.brief_memo, ''images'', p.images,
             ''lat'', p.lat, ''lng'', p.lng
           ) ORDER BY %s %s NULLS LAST, p.id DESC), ''[]''::json)
     FROM broker_properties p
     CROSS JOIN LATERAL (SELECT concat_ws('' '',
             p.seq_no::text, p.address, p.deal_type, p.room_type,
             p.size_pyeong, p.area_supplied::text, p.area_type, p.area_unit,
             p.price::text, p.monthly_rent::text, p.management_fee::text, p.premium::text,
             p.floor::text, p.total_floors, p.move_in_date, p.rooms_bathrooms,
             p.approval_date, p.received_date::text, p.parking, p.direction,
             p.brief_memo, p.description, p.memo, p.assignee, p.status,
             CASE p.status WHEN ''available'' THEN ''거래가능'' WHEN ''contracted'' THEN ''계약완료'' WHEN ''hidden'' THEN ''숨김'' END,
             array_to_string(p.options, '' ''),
             p.custom_fields::text
           ) AS h) s
     WHERE (($16::uuid IS NOT NULL AND p.office_broker_id = $16)
            OR ($16::uuid IS NULL AND p.broker_id = ANY($1)))
       AND p.deleted_at IS NULL
       AND ($2 IS NULL OR $2 = ANY(SELECT btrim(x) FROM unnest(string_to_array(coalesce(p.deal_type,''''), '','')) AS x))
       AND ($3 IS NULL OR p.room_type = ANY($3))
       AND ($4 IS NULL OR p.status = $4)
       AND ($7 IS NULL OR EXISTS (
             SELECT 1 FROM unnest(string_to_array(coalesce(p.assignee,''''), '','')) AS a
             WHERE btrim(a) = ANY($7)))
       AND ($8 IS NULL OR p.price >= $8)
       AND ($9 IS NULL OR p.price <= $9)
       AND ($10 IS NULL OR p.monthly_rent >= $10)
       AND ($11 IS NULL OR p.monthly_rent <= $11)
       AND ($12 IS NULL OR (regexp_match(coalesce(p.size_pyeong,''''), ''[0-9]+\.?[0-9]*''))[1]::numeric >= $12)
       AND ($13 IS NULL OR (regexp_match(coalesce(p.size_pyeong,''''), ''[0-9]+\.?[0-9]*''))[1]::numeric <= $13)
       AND ($14 IS NULL OR p.floor >= $14)
       AND ($15 IS NULL OR p.floor <= $15)
       AND ($5 IS NULL OR translate(s.h, $18, '''') ILIKE $17)',
    order_expr, sort_dir)
  INTO result
  USING p_broker_ids, p_deal_type, p_room_types, p_status, p_q, q_pat,
        p_assignees, p_price_min, p_price_max, p_rent_min, p_rent_max,
        p_pyeong_min, p_pyeong_max, p_floor_min, p_floor_max, p_office, q_flat, ws;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.map_office_properties(uuid[], text, text, text[], text, text, text, text[], numeric, numeric, numeric, numeric, numeric, numeric, int, int, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.map_office_properties(uuid[], text, text, text[], text, text, text, text[], numeric, numeric, numeric, numeric, numeric, numeric, int, int, uuid) TO authenticated;
