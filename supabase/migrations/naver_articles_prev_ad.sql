-- 네이버 매물수집: 재광고·가격변동 표시 (2026-11-02)
--
-- 네이버 '새 매물' 의 60% 가까이가 같은 중개사가 같은 조건으로 다시 올린 광고다
-- (10/27~11/02 실측 6,380건 중 3,741건). 번호가 새로 붙어 화면이 '신규' 로 띄웠다.
-- 가격만 바꿔 다시 올린 것도 하루 40건쯤 섞여 있는데, 이건 오히려 볼 만한 것이다.
--
-- 같은 매물로 보는 기준: 종류·거래·구·동·면적(전용, 없으면 대지)·층·중개사가 모두 같다.
-- 가격은 기준에 넣지 않는다 — 다르면 가격변동이다.
-- 한 시간 안에 같이 들어온 것은 서로 이전 광고로 보지 않는다. 같은 회차에 같이 받은
-- 것은 재광고가 아니라 같은 층 같은 크기의 다른 호실일 가능성이 크다.

ALTER TABLE naver_articles
  ADD COLUMN IF NOT EXISTS prev_article_no text,
  ADD COLUMN IF NOT EXISTS prev_price_deal integer,
  ADD COLUMN IF NOT EXISTS prev_price_deposit integer,
  ADD COLUMN IF NOT EXISTS prev_price_rent integer;

CREATE INDEX IF NOT EXISTS naver_articles_same_ad
  ON naver_articles (brokerage_name, real_estate_type, trade_type, sector, first_seen_at DESC);

-- 들어올 때 이전 광고를 찾아 붙인다. 수집 프로그램(PC)은 손대지 않는다 — 프로그램은
-- 이 칸을 안 보내므로 upsert 의 갱신 쪽에서 덮어쓰이지 않는다.
CREATE OR REPLACE FUNCTION naver_articles_find_prev()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE p record;
BEGIN
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
    AND o.article_no <> NEW.article_no
    AND o.first_seen_at < now() - interval '1 hour'
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
CREATE TRIGGER naver_articles_find_prev BEFORE INSERT ON naver_articles
  FOR EACH ROW EXECUTE FUNCTION naver_articles_find_prev();

-- 이미 받아 둔 것 되메우기.
UPDATE naver_articles n SET
  prev_article_no = p.article_no,
  prev_price_deal = p.price_deal,
  prev_price_deposit = p.price_deposit,
  prev_price_rent = p.price_rent
FROM naver_articles x
CROSS JOIN LATERAL (
  SELECT o.article_no, o.price_deal, o.price_deposit, o.price_rent
  FROM naver_articles o
  WHERE o.brokerage_name = x.brokerage_name
    AND o.real_estate_type = x.real_estate_type
    AND o.trade_type IS NOT DISTINCT FROM x.trade_type
    AND o.sector IS NOT DISTINCT FROM x.sector
    AND o.division IS NOT DISTINCT FROM x.division
    AND o.floor_info IS NOT DISTINCT FROM x.floor_info
    AND coalesce(o.area_exclusive, o.area_land) IS NOT DISTINCT FROM coalesce(x.area_exclusive, x.area_land)
    AND o.article_no <> x.article_no
    AND o.first_seen_at < x.first_seen_at - interval '1 hour'
  ORDER BY o.first_seen_at DESC
  LIMIT 1
) p
WHERE n.article_no = x.article_no AND x.brokerage_name IS NOT NULL;
