-- 매물장 서버 페이지네이션/검색 RPC.
-- 기존엔 클라이언트가 사무소 전 매물(1700건+, 1.5MB)을 받아 필터·검색·정렬·페이지를
-- 브라우저에서 처리했다. 이 RPC가 그 로직을 DB로 옮겨 페이지당 20~100건만 내려준다.
--
-- SECURITY INVOKER: RLS가 그대로 적용된다 — 호출자가 못 보는 행은 아무리
-- broker_ids를 넣어도 안 나온다 (관리자는 admin SELECT 정책으로 전체 열람).
--
-- 검색(p_q)은 기존 클라이언트 동작과 동일하게 "모든 의미 있는 필드의 부분 문자열
-- 매칭"이다: 텍스트·숫자·날짜·옵션 배열·커스텀 필드 + 상태 한글 라벨(거래가능 등).
CREATE OR REPLACE FUNCTION public.search_office_properties(
  p_broker_ids uuid[],
  p_q text DEFAULT NULL,
  p_deal_type text DEFAULT NULL,
  p_room_types text[] DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_sort_key text DEFAULT NULL,
  p_sort_dir text DEFAULT 'desc',
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
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
  USING p_broker_ids, p_deal_type, p_room_types, p_status, p_q, q_pat, p_limit, p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.search_office_properties(uuid[], text, text, text[], text, text, text, int, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.search_office_properties(uuid[], text, text, text[], text, text, text, int, int) TO authenticated;
