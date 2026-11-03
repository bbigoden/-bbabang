-- 매물수집 재등록 짝짓기: 함께 떠 있던 광고는 짝으로 보지 않는다 (2026-11-03)
--
-- 재등록은 옛 광고가 내려가고 새 번호로 다시 올라온 것이다. 옛 광고가 새 광고가 뜬 뒤에도
-- 보였다면 둘은 동시에 떠 있던 것이고, 같은 중개사가 같은 조건의 다른 호실을 올린 것일
-- 가능성이 크다(분양상가 등). 7일 4,904건 중 27건이 그랬다.
--
-- 받을 때(INSERT)는 옛 광고가 이번 회차에서 아직 안 갱신됐을 수 있어 판정이 늦다. 그래서
-- 옛 광고가 다시 보일 때(UPDATE OF last_seen_at) 그 광고를 짝으로 잡은 새 광고에서 짝을 푼다.

CREATE INDEX IF NOT EXISTS naver_articles_prev_no ON naver_articles (prev_article_no) WHERE prev_article_no IS NOT NULL;

CREATE OR REPLACE FUNCTION naver_articles_find_prev()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE p record; seen timestamptz := coalesce(NEW.first_seen_at, now());
BEGIN
  NEW.prev_article_no := NULL; NEW.prev_price_deal := NULL; NEW.prev_price_deposit := NULL; NEW.prev_price_rent := NULL;
  IF NEW.brokerage_name IS NULL THEN RETURN NEW; END IF;
  SELECT o.article_no, o.price_deal, o.price_deposit, o.price_rent INTO p
  FROM naver_articles o
  WHERE o.brokerage_name = NEW.brokerage_name
    AND o.real_estate_type = NEW.real_estate_type
    AND o.trade_type IS NOT DISTINCT FROM NEW.trade_type
    AND o.sector IS NOT DISTINCT FROM NEW.sector
    AND o.division IS NOT DISTINCT FROM NEW.division
    AND o.floor_info IS NOT DISTINCT FROM NEW.floor_info
    AND coalesce(o.area_exclusive, o.area_land) IS NOT DISTINCT FROM coalesce(NEW.area_exclusive, NEW.area_land)
    AND o.area_floor IS NOT DISTINCT FROM NEW.area_floor
    AND (o.pnu IS NULL OR NEW.pnu IS NULL OR o.pnu = NEW.pnu)
    AND o.article_no <> NEW.article_no
    AND o.first_seen_at < seen - interval '1 hour'
    AND o.last_seen_at < seen - interval '2 hours'      -- 새 광고가 뜬 뒤에도 보인 것은 다른 매물
  ORDER BY (o.pnu = NEW.pnu) DESC NULLS LAST, o.first_seen_at DESC
  LIMIT 1;
  IF FOUND THEN
    NEW.prev_article_no := p.article_no;
    NEW.prev_price_deal := p.price_deal;
    NEW.prev_price_deposit := p.price_deposit;
    NEW.prev_price_rent := p.price_rent;
  END IF;
  RETURN NEW;
END $$;

-- 옛 광고가 다시 보였다 → 이 광고를 짝으로 잡은, 그보다 먼저 뜬 새 광고는 함께 떠 있던 것.
CREATE OR REPLACE FUNCTION naver_articles_unpair_live()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  UPDATE naver_articles SET prev_article_no = NULL, prev_price_deal = NULL, prev_price_deposit = NULL, prev_price_rent = NULL
  WHERE prev_article_no = NEW.article_no AND first_seen_at <= NEW.last_seen_at + interval '2 hours';
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS naver_articles_unpair_live ON naver_articles;
CREATE TRIGGER naver_articles_unpair_live AFTER UPDATE OF last_seen_at ON naver_articles
  FOR EACH ROW WHEN (NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at)
  EXECUTE FUNCTION naver_articles_unpair_live();

-- 이미 받아 둔 것: 함께 떠 있던 짝만 새 기준으로 다시 찾는다.
UPDATE naver_articles n SET prev_article_no = q.article_no, prev_price_deal = q.price_deal,
  prev_price_deposit = q.price_deposit, prev_price_rent = q.price_rent
FROM naver_articles x
JOIN naver_articles p0 ON p0.article_no = x.prev_article_no AND p0.last_seen_at >= x.first_seen_at - interval '2 hours'
LEFT JOIN LATERAL (
  SELECT o.article_no, o.price_deal, o.price_deposit, o.price_rent FROM naver_articles o
  WHERE o.brokerage_name = x.brokerage_name AND o.real_estate_type = x.real_estate_type
    AND o.trade_type IS NOT DISTINCT FROM x.trade_type AND o.sector IS NOT DISTINCT FROM x.sector
    AND o.division IS NOT DISTINCT FROM x.division AND o.floor_info IS NOT DISTINCT FROM x.floor_info
    AND coalesce(o.area_exclusive, o.area_land) IS NOT DISTINCT FROM coalesce(x.area_exclusive, x.area_land)
    AND o.area_floor IS NOT DISTINCT FROM x.area_floor
    AND (o.pnu IS NULL OR x.pnu IS NULL OR o.pnu = x.pnu)
    AND o.article_no <> x.article_no AND o.first_seen_at < x.first_seen_at - interval '1 hour'
    AND o.last_seen_at < x.first_seen_at - interval '2 hours'
  ORDER BY (o.pnu = x.pnu) DESC NULLS LAST, o.first_seen_at DESC LIMIT 1
) q ON true
WHERE n.article_no = x.article_no;
