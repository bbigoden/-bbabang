-- 사무소 일정(캘린더) — 구글 캘린더 대체
-- office_broker_id = 사무소 대표의 broker_profiles.id (settlements/office_resources 패턴 재사용)
-- visibility: 'office'(사무소 공유) | 'private'(작성자 본인만)
-- customer_id/property_id: 고객·매물 연동(선택)
-- remind_minutes/reminded_at: 알림(아침 요약 cron에서 사용)

CREATE TABLE IF NOT EXISTS office_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  office_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  created_by UUID REFERENCES broker_profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT FALSE,
  visibility TEXT NOT NULL DEFAULT 'office',
  color TEXT,
  location TEXT,
  customer_id UUID REFERENCES broker_customers(id) ON DELETE SET NULL,
  property_id UUID REFERENCES broker_properties(id) ON DELETE SET NULL,
  remind_minutes INTEGER,
  reminded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS office_events_office_time_idx ON office_events(office_broker_id, starts_at);
CREATE INDEX IF NOT EXISTS office_events_creator_idx ON office_events(created_by, starts_at);

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION office_events_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS office_events_updated_at ON office_events;
CREATE TRIGGER office_events_updated_at
  BEFORE UPDATE ON office_events
  FOR EACH ROW EXECUTE FUNCTION office_events_touch_updated_at();

-- ── RLS ───────────────────────────────────────────────
ALTER TABLE office_events ENABLE ROW LEVEL SECURITY;

-- 조회: 같은 사무소 멤버. 단 개인(private) 일정은 작성자 본인만.
DROP POLICY IF EXISTS "office_events_select" ON office_events;
CREATE POLICY "office_events_select" ON office_events FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND (me.id = office_events.office_broker_id OR me.parent_broker_id = office_events.office_broker_id)
      AND (office_events.visibility = 'office' OR office_events.created_by = me.id)
  )
);

-- 추가: 사무소 멤버(대표 또는 승인 직원)만, created_by는 본인.
DROP POLICY IF EXISTS "office_events_insert" ON office_events;
CREATE POLICY "office_events_insert" ON office_events FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND me.id = office_events.created_by
      AND (
        me.id = office_events.office_broker_id
        OR (me.parent_broker_id = office_events.office_broker_id AND me.is_approved = true)
      )
  )
);

-- 수정: 작성자 본인 또는 사무소 대표.
DROP POLICY IF EXISTS "office_events_update" ON office_events;
CREATE POLICY "office_events_update" ON office_events FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND (me.id = office_events.created_by OR me.id = office_events.office_broker_id)
  )
);

-- 삭제: 작성자 본인 또는 사무소 대표.
DROP POLICY IF EXISTS "office_events_delete" ON office_events;
CREATE POLICY "office_events_delete" ON office_events FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND (me.id = office_events.created_by OR me.id = office_events.office_broker_id)
  )
);
