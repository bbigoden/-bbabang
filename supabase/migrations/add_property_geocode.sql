-- 매물 좌표 캐시 컬럼 (카카오 OVER_QUERY_LIMIT 회피)
-- 매물 등록·수정·자동채움 시 서버에서 카카오 REST geocode 후 함께 저장.

ALTER TABLE broker_properties
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_broker_properties_latlng
  ON broker_properties (lat, lng)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
