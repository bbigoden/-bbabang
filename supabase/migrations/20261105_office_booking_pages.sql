-- 예약 링크 페이지 설정 — 손님이 로그인 없이 여는 /b/<slug> 의 상품·영업시간·쉬는 날.
-- 직원 한 명당 한 장(owner_broker_id). 첫 시험은 이예리 꽃집, 값은 임시(직원이 화면에서 고친다).
-- 손님 쪽 읽기·신청은 서버(/api/booking/<slug>, service_role)만 한다 — anon 정책 없음.
-- 권한은 일정과 같은 office_event_can_* (대표 + permissions.events 직원).

CREATE TABLE IF NOT EXISTS office_booking_pages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  office_broker_id UUID NOT NULL REFERENCES broker_profiles(id) ON DELETE CASCADE,
  owner_broker_id UUID NOT NULL REFERENCES broker_profiles(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  title TEXT NOT NULL,
  intro TEXT,
  products JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ "name": "꽃다발", "price": 30000 }]
  open_time TIME NOT NULL DEFAULT '10:00',
  close_time TIME NOT NULL DEFAULT '19:00',
  slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 10 AND 240),
  closed_weekdays INTEGER[] NOT NULL DEFAULT '{}',  -- 0=일 … 6=토
  lead_hours INTEGER NOT NULL DEFAULT 2 CHECK (lead_hours BETWEEN 0 AND 168),  -- 지금부터 몇 시간 뒤부터 받나
  max_days INTEGER NOT NULL DEFAULT 60 CHECK (max_days BETWEEN 1 AND 365),     -- 며칠 뒤까지 받나
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_broker_id)
);
CREATE INDEX IF NOT EXISTS office_booking_pages_office_idx ON office_booking_pages(office_broker_id);

CREATE OR REPLACE FUNCTION office_booking_pages_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS office_booking_pages_touch ON office_booking_pages;
CREATE TRIGGER office_booking_pages_touch BEFORE UPDATE ON office_booking_pages
  FOR EACH ROW EXECUTE FUNCTION office_booking_pages_touch();

ALTER TABLE office_booking_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_booking_pages_select ON office_booking_pages;
CREATE POLICY office_booking_pages_select ON office_booking_pages FOR SELECT TO authenticated
  USING (office_event_can_view(office_broker_id, owner_broker_id));
DROP POLICY IF EXISTS office_booking_pages_insert ON office_booking_pages;
CREATE POLICY office_booking_pages_insert ON office_booking_pages FOR INSERT TO authenticated
  WITH CHECK (office_event_can_insert(office_broker_id, owner_broker_id));
DROP POLICY IF EXISTS office_booking_pages_update ON office_booking_pages;
CREATE POLICY office_booking_pages_update ON office_booking_pages FOR UPDATE TO authenticated
  USING (office_event_can_manage(office_broker_id, owner_broker_id))
  WITH CHECK (office_event_can_manage(office_broker_id, owner_broker_id));

-- 이예리 꽃집 임시값
INSERT INTO office_booking_pages (office_broker_id, owner_broker_id, slug, title, intro, products, open_time, close_time, slot_minutes, closed_weekdays, lead_hours)
VALUES (
  '7edde640-a6ea-4657-ab52-0403e9fdd39e', 'c7e58900-e6bb-4f88-b3bf-d1879f8a6050',
  'flower-yeri', '꽃집 예약', '원하는 날짜와 시간을 골라 주세요. 확인 후 연락드릴게요.',
  '[{"name":"꽃다발","price":30000},{"name":"꽃다발(큰 것)","price":50000},{"name":"꽃바구니","price":50000},{"name":"화분","price":null},{"name":"상담 후 결정","price":null}]'::jsonb,
  '10:00', '19:00', 30, '{}', 2
) ON CONFLICT (owner_broker_id) DO NOTHING;
