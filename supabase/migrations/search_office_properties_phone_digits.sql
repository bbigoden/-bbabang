-- (2차) 하이픈 없는 연락처 검색 추가. 위 설명과 동일하게 시그니처 불변.
-- 매물 검색: 공백 없는 검색어("불당동1659")도 "불당동 1659"로 저장된 주소에 매칭.
-- 원문·공백제거본 둘 중 하나라도 부분일치하면 포함. 시그니처 불변.

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
  q_flat := '%' || regexp_replace(coalesce(p_q,''), '\s', '', 'g') || '%';

  -- 하이픈 없이 친 연락처(01062331205)가 메모의 '010-6233-1205' 에 걸리도록, 전화번호처럼 생긴 검색어일 때만
  -- 본문의 숫자 사이 하이픈을 빼고도 비교한다. (일반 숫자 검색에는 영향이 없다)
  q_phone := CASE WHEN regexp_replace(coalesce(p_q,''), '[\s-]', '', 'g') ~ '^0[0-9]{8,10}$'
                  THEN '%' || regexp_replace(coalesce(p_q,''), '[\s-]', '', 'g') || '%' END;

  RETURN QUERY EXECUTE format(
    'SELECT to_jsonb(p.*) AS data, count(*) OVER() AS total_count
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
       AND ($5 IS NULL OR s.h ILIKE $6 OR regexp_replace(s.h, ''\s'', '''', ''g'') ILIKE $19
            OR ($20::text IS NOT NULL AND regexp_replace(s.h, ''(\d)-(?=\d)'', ''\1'', ''g'') ILIKE $20))
     ORDER BY %s %s NULLS LAST, p.id DESC
     LIMIT $7 OFFSET $8',
    order_expr, sort_dir)
  USING p_broker_ids, p_deal_type, p_room_types, p_status, p_q, q_pat, p_limit, p_offset,
        p_assignees, p_price_min, p_price_max, p_rent_min, p_rent_max,
        p_pyeong_min, p_pyeong_max, p_floor_min, p_floor_max, p_office, q_flat, q_phone;
END;
$$;

