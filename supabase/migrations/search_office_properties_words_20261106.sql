-- 매물목록 검색: 낱말 여러 개는 칸을 넘나들어도 모두 들어 있으면 찾는다 (2026-11-06 점검)
-- 예전엔 띄어쓰기를 지운 '불당월세' 가 한 덩어리로 있어야 걸려 "불당 월세" 가 0건이었다
-- (불당 881건, 월세 수백 건). 붙여 쓴 검색·연락처 검색은 그대로 둔다.
-- 바뀐 곳: q_words 선언·계산, WHERE 의 검색 조건에 ILIKE ALL($23), USING 끝에 q_words.
CREATE OR REPLACE FUNCTION public.search_office_properties(p_broker_ids uuid[] DEFAULT NULL::uuid[], p_q text DEFAULT NULL::text, p_deal_type text DEFAULT NULL::text, p_room_types text[] DEFAULT NULL::text[], p_status text DEFAULT NULL::text, p_sort_key text DEFAULT NULL::text, p_sort_dir text DEFAULT 'desc'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_assignees text[] DEFAULT NULL::text[], p_price_min numeric DEFAULT NULL::numeric, p_price_max numeric DEFAULT NULL::numeric, p_rent_min numeric DEFAULT NULL::numeric, p_rent_max numeric DEFAULT NULL::numeric, p_pyeong_min numeric DEFAULT NULL::numeric, p_pyeong_max numeric DEFAULT NULL::numeric, p_floor_min integer DEFAULT NULL::integer, p_floor_max integer DEFAULT NULL::integer, p_office uuid DEFAULT NULL::uuid, p_industries text[] DEFAULT NULL::text[])
 RETURNS TABLE(data jsonb, total_count bigint)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE sort_dir text; order_expr text; q_pat text; q_flat text; ws text; q_phone text; q_words text[];
BEGIN
  sort_dir := CASE WHEN lower(coalesce(p_sort_dir,'desc')) = 'asc' THEN 'ASC' ELSE 'DESC' END;
  order_expr := CASE
    WHEN p_sort_key IN ('size_pyeong','total_floors')
      THEN format('NULLIF(split_part(regexp_replace(coalesce(p.%I,''''), ''[^0-9.]'', '''', ''g''), ''.'', 1), '''')::numeric', p_sort_key)
    WHEN p_sort_key = 'industry'
      THEN 'NULLIF(coalesce(p.custom_fields->>''industry'', p.custom_fields->>''col_1793434493650''), '''')'
    WHEN p_sort_key IN ('seq_no','address','deal_type','room_type','price','monthly_rent','management_fee','premium','area_supplied','area_type','area_unit','floor','move_in_date','rooms_bathrooms','approval_date','received_date','parking','direction','brief_memo','description','memo','assignee','status','created_at') THEN format('p.%I', p_sort_key)
    ELSE 'p.created_at' END;
  q_pat := '%' || p_q || '%';
  ws := ' ' || chr(9) || chr(10) || chr(13) || chr(12) || chr(11) || chr(160) || chr(12288);
  q_flat := '%' || translate(coalesce(p_q,''), ws, '') || '%';
  -- 연락처처럼 생긴 검색어면 숫자 사이 하이픈을 지운 글에서도 찾는다. 그 밖엔 NULL 이라 정규식을 돌리지 않는다.
  q_phone := CASE WHEN regexp_replace(coalesce(p_q,''), '[\s-]', '', 'g') ~ '^0[0-9]{8,10}$'
                  THEN '%' || regexp_replace(coalesce(p_q,''), '[\s-]', '', 'g') || '%' END;
  -- 낱말이 둘 이상일 때만. 각 낱말이 (띄어쓰기를 지운) 매물 글 어딘가에 모두 있으면 걸린다.
  SELECT CASE WHEN count(*) > 1 THEN array_agg('%' || w || '%') END INTO q_words
  FROM unnest(regexp_split_to_array(btrim(translate(coalesce(p_q,''), ws, repeat(' ', length(ws)))), ' +')) AS w
  WHERE w <> '';
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
       AND ($9 IS NULL OR EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(p.assignee,''''), '','')) AS a WHERE btrim(a) = ANY($9)))
       AND ($22 IS NULL OR EXISTS (SELECT 1 FROM unnest(string_to_array(coalesce(p.custom_fields->>''industry'', p.custom_fields->>''col_1793434493650'', ''''), '','')) AS i WHERE btrim(i) = ANY($22)))
       AND ($10 IS NULL OR p.price >= $10) AND ($11 IS NULL OR p.price <= $11)
       AND ($12 IS NULL OR p.monthly_rent >= $12) AND ($13 IS NULL OR p.monthly_rent <= $13)
       AND ($14 IS NULL OR (regexp_match(coalesce(p.size_pyeong,''''), ''[0-9]+\.?[0-9]*''))[1]::numeric >= $14)
       AND ($15 IS NULL OR (regexp_match(coalesce(p.size_pyeong,''''), ''[0-9]+\.?[0-9]*''))[1]::numeric <= $15)
       AND ($16 IS NULL OR p.floor >= $16) AND ($17 IS NULL OR p.floor <= $17)
       AND ($5 IS NULL OR translate(s.h, $20, '''') ILIKE $19
            OR ($23::text[] IS NOT NULL AND translate(s.h, $20, '''') ILIKE ALL($23))
            OR ($21::text IS NOT NULL AND regexp_replace(s.h, ''(\d)-(?=\d)'', ''\1'', ''g'') ILIKE $21))
     ORDER BY rn
     LIMIT $7 OFFSET $8)
     SELECT to_jsonb(p.*) AS data, f.total_count
     FROM f JOIN broker_properties p ON p.id = f.id
     ORDER BY f.rn',
    order_expr, sort_dir)
  USING p_broker_ids, p_deal_type, p_room_types, p_status, p_q, q_pat, p_limit, p_offset,
        p_assignees, p_price_min, p_price_max, p_rent_min, p_rent_max,
        p_pyeong_min, p_pyeong_max, p_floor_min, p_floor_max, p_office, q_flat, ws, q_phone,
        p_industries, q_words;
END;
$function$;
