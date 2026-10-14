-- 매물수집 화면: 고른 기간의 매물과 본 기록을 **한 번에** 돌려준다.
--
-- 전에는 화면이 1000행씩 차례로 받았다(PostgREST 가 한 번에 1000행만 준다). 기본 3일이
-- 요청 4번, 상가를 뺀 30일은 14번이라 폰에서 왕복만 몇 초였다. 값 하나(json)로 돌려주면
-- 그 제한에 안 걸려 한 번이면 되고, 행을 객체 대신 배열로 보내 크기도 절반 아래로 준다.
-- 거르기·세우기·건수는 지금처럼 화면이 한다 — 동작은 그대로다.
--
-- 본 기록:
-- - 이 매물들의 기록만 article_no 로 붙인다. 전에는 '첫날 30일 앞부터' 로 짐작해 받아,
--   그보다 앞서 본 매물은 안 본 것으로 나왔다.
-- - '나' 는 auth.uid() 로 센다. 화면이 세면 새로고침 직후 사용자 정보가 차기 전이라 0 이
--   되고, 그 상태로 누르면 내 횟수가 1 로 덮어써졌다.
-- - SECURITY INVOKER 라 views 의 RLS(can_view_broker_property)를 그대로 탄다 — 남의 기록을
--   못 보게 막아 둔 직원은 여기서도 못 본다.
--
-- 칸 목록은 화면(SOURCES.columns)이 넘긴다. 칸 이름은 %I 로 감싸 끼우므로 SQL 이 섞일 수
-- 없고, 없는 칸이면 오류가 난다. 표·날짜칸·종류칸은 곳(source)마다 여기서 정한다 —
-- page.tsx 의 SOURCES 와 맞춰 둘 것.

CREATE OR REPLACE FUNCTION public.collect_listings(
  p_source text,
  p_columns text[],
  p_from text,
  p_to text DEFAULT NULL,
  p_kinds text[] DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_table text;
  v_views text;
  v_date text;
  v_date_type text;
  v_kind text;
  v_cols text;
  v_result json;
BEGIN
  CASE p_source
    WHEN 'naver' THEN
      v_table := 'naver_articles'; v_views := 'naver_article_views';
      -- 날짜만 담는 칸. 화면이 '2026-09-05' 를 그대로 넘긴다.
      v_date := 'exposure_start_date'; v_date_type := 'date'; v_kind := 'real_estate_type';
    WHEN 'daangn' THEN
      v_table := 'daangn_articles'; v_views := 'daangn_article_views';
      -- 시각 칸. 화면이 그 날 한국 0시를 가리키는 순간(ISO, 시간대 포함)을 넘긴다 —
      -- 날짜 글자를 넘겨 timestamptz 로 읽으면 세계표준시 0시라 아홉 시간 어긋난다.
      v_date := 'first_seen_at'; v_date_type := 'timestamptz'; v_kind := 'sales_type';
    ELSE
      RAISE EXCEPTION 'unknown source: %', p_source;
  END CASE;

  IF p_columns IS NULL OR cardinality(p_columns) = 0 THEN
    RAISE EXCEPTION 'p_columns is required';
  END IF;
  SELECT string_agg(format('a.%I', c), ', ' ORDER BY i) INTO v_cols
  FROM unnest(p_columns) WITH ORDINALITY AS u(c, i);

  EXECUTE format(
    'WITH a AS (
       SELECT * FROM %1$I
       WHERE %2$I >= $1::%3$s
         AND ($2::text IS NULL OR %2$I < $2::%3$s)
         AND ($3::text[] IS NULL OR %4$I = ANY($3))
     )
     SELECT json_build_object(
       ''rows'', coalesce((
         SELECT json_agg(json_build_array(%5$s) ORDER BY a.%2$I DESC, a.article_no DESC) FROM a
       ), ''[]''::json),
       ''views'', coalesce((
         SELECT json_agg(json_build_array(x.article_no, x.mine, x.office))
         FROM (
           SELECT v.article_no,
                  coalesce(sum(coalesce(v.view_count, 1)) FILTER (WHERE v.user_id = auth.uid()), 0) AS mine,
                  sum(coalesce(v.view_count, 1)) AS office
           FROM %6$I v
           WHERE v.article_no IN (SELECT article_no FROM a)
           GROUP BY v.article_no
         ) x
       ), ''[]''::json)
     )',
    v_table, v_date, v_date_type, v_kind, v_cols, v_views)
  INTO v_result
  USING p_from, p_to, p_kinds;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.collect_listings(text, text[], text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collect_listings(text, text[], text, text, text[]) TO authenticated;
