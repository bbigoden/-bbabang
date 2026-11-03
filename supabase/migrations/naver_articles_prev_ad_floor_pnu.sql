-- 매물수집 재등록 짝짓기: 연면적·지번을 기준에 더한다 (2026-11-03)
--
-- 공장/창고는 대지만 같고 연면적이 다른 매물(건물 일부 임대)이 같은 매물로 짝지어졌다
-- — 최근 7일 47건 중 21건. 송덕리 198-26(연면적 222평)이 198(450평)의 '가격변동' 으로 보였다.
-- 지번(pnu)은 수집 뒤에 PC 가 따로 채우므로, 채워질 때(UPDATE OF pnu) 다시 판정한다.
-- 한쪽이라도 지번이 없으면 지번은 보지 않는다.

CREATE OR REPLACE FUNCTION naver_articles_find_prev()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE p record;
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
    AND o.first_seen_at < coalesce(NEW.first_seen_at, now()) - interval '1 hour'
  ORDER BY o.first_seen_at DESC
  LIMIT 1;
  IF FOUND THEN
    NEW.prev_article_no := p.article_no;
    NEW.prev_price_deal := p.price_deal;
    NEW.prev_price_deposit := p.price_deposit;
    NEW.prev_price_rent := p.price_rent;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS naver_articles_find_prev ON naver_articles;
CREATE TRIGGER naver_articles_find_prev BEFORE INSERT OR UPDATE OF pnu ON naver_articles
  FOR EACH ROW EXECUTE FUNCTION naver_articles_find_prev();

-- 짝이 있던 것만 새 기준으로 다시 판정한다(기준이 좁아졌으므로 짝이 없던 것은 그대로다).
UPDATE naver_articles n SET prev_article_no = p.article_no, prev_price_deal = p.price_deal,
  prev_price_deposit = p.price_deposit, prev_price_rent = p.price_rent
FROM naver_articles x
LEFT JOIN LATERAL (
  SELECT o.article_no, o.price_deal, o.price_deposit, o.price_rent FROM naver_articles o
  WHERE o.brokerage_name = x.brokerage_name AND o.real_estate_type = x.real_estate_type
    AND o.trade_type IS NOT DISTINCT FROM x.trade_type AND o.sector IS NOT DISTINCT FROM x.sector
    AND o.division IS NOT DISTINCT FROM x.division AND o.floor_info IS NOT DISTINCT FROM x.floor_info
    AND coalesce(o.area_exclusive, o.area_land) IS NOT DISTINCT FROM coalesce(x.area_exclusive, x.area_land)
    AND o.area_floor IS NOT DISTINCT FROM x.area_floor
    AND (o.pnu IS NULL OR x.pnu IS NULL OR o.pnu = x.pnu)
    AND o.article_no <> x.article_no AND o.first_seen_at < x.first_seen_at - interval '1 hour'
  ORDER BY o.first_seen_at DESC LIMIT 1
) p ON true
WHERE n.article_no = x.article_no AND x.prev_article_no IS NOT NULL;
