-- 매물수집: 네이버도 기간을 '처음 받은 날'(first_seen_at)로 자른다. (2026-10-20)
--
-- 광고 노출일(exposure_start_date)로 잘랐더니 [오늘] 이 오늘 들어온 매물을 거의 못 보여줬다.
-- 주말에 등록한 광고는 월요일에 네이버에 뜨는데 노출일은 주말로 찍힌다 — 10/20 아침 새로
-- 받은 1,501건 중 노출일이 그날인 것은 26건뿐이었다. 당근은 처음부터 first_seen_at 이다.
-- 나머지는 collect_listings_rpc.sql 그대로.

CREATE INDEX IF NOT EXISTS naver_articles_first_seen ON public.naver_articles (first_seen_at DESC);

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
      -- 우리가 처음 받은 날로 자른다(당근과 같다). 광고 노출일로 자르면 주말에 등록돼
      -- 월요일에 뜬 매물이 [오늘] 에서 빠졌다. 시각 칸이라 화면이 한국 0시 순간을 넘긴다.
      v_date := 'first_seen_at'; v_date_type := 'timestamptz'; v_kind := 'real_estate_type';
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
