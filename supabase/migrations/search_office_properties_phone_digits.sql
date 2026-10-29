-- 매물 검색: 하이픈 없이 친 연락처(01012345678)도 '010-1234-5678' 로 적힌 메모·설명에서 찾는다.
-- 2026-10-27 첫 판은 그보다 앞선 regexp_replace 본을 바탕으로 해, 그대로 넣으면 translate 개선
-- (search_office_properties_translate)을 되돌렸다. 운영 정의(translate 본)에 연락처 갈래만 얹어 다시 썼다.
-- 연락처처럼 생긴 검색어일 때만 정규식을 돈다. 시그니처 불변. 멱등. (2026-10-29 적용)

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
  q_flat text;
  ws text;
  q_phone text;
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
  -- 공백 없이 친 검색어("불당동1659")도 주소의 "불당동 1659"에 걸리도록 공백 제거본도 비교
  -- 지울 공백: 스페이스·탭·줄바꿈·CR·FF·VT·NBSP·전각 공백
  ws := ' ' || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160) || chr(12288);
  q_flat := '%' || translate(coalesce(p_q,''), ws, '') || '%';
  -- 연락처처럼 생긴 검색어(01012345678, 010 1234 5678)면 숫자 사이 하이픈을 지운 글에서도 찾는다.
  -- 그 밖의 검색어는 NULL 이라 정규식을 돌리지 않는다.
  q_phone := CASE WHEN regexp_replace(coalesce(p_q,''), '[\s-]', '', 'g') ~ '^0[0-9]{8,10}$'
                  THEN '%' || regexp_replace(coalesce(p_q,''), '[\s-]', '', 'g') || '%' END;

  RETURN QUERY EXECUTE format(
    'WITH f AS (
     SELECT p.id, count(*) OVER() AS total_count,
            row_number() OVER (ORDER BY %s %s NULLS LAST, p.id DESC) AS rn
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
       AND ($5 IS NULL OR translate(s.h, $20, '''') ILIKE $19
            OR ($21::text IS NOT NULL AND regexp_replace(s.h, ''(\d)-(?=\d)'', ''\1'', ''g'') ILIKE $21))
     ORDER BY rn
     LIMIT $7 OFFSET $8)
     SELECT to_jsonb(p.*) AS data, f.total_count
     FROM f JOIN broker_properties p ON p.id = f.id
     ORDER BY f.rn',
    order_expr, sort_dir)
  USING p_broker_ids, p_deal_type, p_room_types, p_status, p_q, q_pat, p_limit, p_offset,
        p_assignees, p_price_min, p_price_max, p_rent_min, p_rent_max,
        p_pyeong_min, p_pyeong_max, p_floor_min, p_floor_max, p_office, q_flat, ws, q_phone;
END;
$$;

