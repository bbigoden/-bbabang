-- 일정 모으기(예약 수집) — 1단계: 일정 표 + 불편 신고 표
-- 첫 시험: 꽃집도 하는 직원 1명. 잘 되면 이름만 바꿔 부동산 일정(현장 안내·상담)으로.
-- 그래서 업종 전용 칸 없이 공통 칸만 둔다. (예전 office_events 는 10-30 에 지움, 0건)
-- 권한: 대표=전부, 직원=본인 것+대표 것 보기 / 고치기는 본인 것만.
-- 자료실 함수(office_res_*)는 이사=대표 권한이라 쓰지 않는다 — 사장님 지시(11-05): 이 시험에서 이사는 뺀다.

CREATE TABLE IF NOT EXISTS office_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  office_broker_id UUID NOT NULL REFERENCES broker_profiles(id) ON DELETE CASCADE,
  owner_broker_id UUID REFERENCES broker_profiles(id) ON DELETE SET NULL,  -- 이 일정 담당(직원)
  -- 언제·무엇
  starts_at TIMESTAMPTZ,                -- DM 등 아직 날짜 모르는 건 비어 있을 수 있음
  ends_at TIMESTAMPTZ,
  title TEXT NOT NULL,                  -- 내용(꽃집: 꽃다발 3만원 / 부동산: ○○동 상가 현장 안내)
  memo TEXT,
  amount INTEGER,                       -- 예상 금액(원)
  paid_amount INTEGER,                  -- 완료 때 실제 받은 금액(원)
  -- 손님
  customer_name TEXT,
  customer_phone TEXT,
  -- 어디서 들어왔나
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','naver','kakao','insta_link','insta_dm','link')),
  source_ref TEXT,                      -- 원본 번호(네이버 예약번호 등) — 같은 예약 두 번 안 들어가게
  source_text TEXT,                     -- 원문(메일·DM)
  -- 상태
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','done','canceled','no_show')),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS office_events_office_time_idx ON office_events(office_broker_id, starts_at);
CREATE INDEX IF NOT EXISTS office_events_owner_idx ON office_events(owner_broker_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS office_events_source_ref_uq
  ON office_events(office_broker_id, source, source_ref) WHERE source_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION office_events_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := NOW();
  IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
    NEW.confirmed_at := NOW();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS office_events_touch ON office_events;
CREATE TRIGGER office_events_touch BEFORE INSERT OR UPDATE ON office_events
  FOR EACH ROW EXECUTE FUNCTION office_events_touch();

-- ── 권한 함수(이사 특별대우 없음) ──
CREATE OR REPLACE FUNCTION office_event_can_view(p_office UUID, p_owner UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (bp.id = p_office
           OR (bp.parent_broker_id = p_office AND bp.is_approved = true
               AND (p_owner = bp.id OR p_owner = p_office)))
  )
$$;

CREATE OR REPLACE FUNCTION office_event_can_manage(p_office UUID, p_owner UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (bp.id = p_office
           OR (bp.parent_broker_id = p_office AND bp.is_approved = true AND bp.id = p_owner))
  )
$$;

CREATE OR REPLACE FUNCTION office_event_can_insert(p_office UUID, p_owner UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (bp.id = p_office
           OR (bp.parent_broker_id = p_office AND bp.is_approved = true AND bp.id = p_owner))
  )
$$;

REVOKE EXECUTE ON FUNCTION office_event_can_view(UUID, UUID), office_event_can_manage(UUID, UUID), office_event_can_insert(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION office_event_can_view(UUID, UUID), office_event_can_manage(UUID, UUID), office_event_can_insert(UUID, UUID) TO authenticated;

ALTER TABLE office_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_events_select ON office_events;
CREATE POLICY office_events_select ON office_events FOR SELECT TO authenticated
  USING (office_event_can_view(office_broker_id, owner_broker_id));
DROP POLICY IF EXISTS office_events_insert ON office_events;
CREATE POLICY office_events_insert ON office_events FOR INSERT TO authenticated
  WITH CHECK (office_event_can_insert(office_broker_id, owner_broker_id));
DROP POLICY IF EXISTS office_events_update ON office_events;
CREATE POLICY office_events_update ON office_events FOR UPDATE TO authenticated
  USING (office_event_can_manage(office_broker_id, owner_broker_id))
  WITH CHECK (office_event_can_manage(office_broker_id, owner_broker_id));
DROP POLICY IF EXISTS office_events_delete ON office_events;
CREATE POLICY office_events_delete ON office_events FOR DELETE TO authenticated
  USING (office_event_can_manage(office_broker_id, owner_broker_id));

-- 불편 신고 — 직원이 쓰다 막히면 한 줄. 대표가 모아 본다.
CREATE TABLE IF NOT EXISTS office_event_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  office_broker_id UUID NOT NULL REFERENCES broker_profiles(id) ON DELETE CASCADE,
  author_broker_id UUID REFERENCES broker_profiles(id) ON DELETE SET NULL,
  event_id UUID REFERENCES office_events(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS office_event_feedback_office_idx ON office_event_feedback(office_broker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS office_event_feedback_event_idx ON office_event_feedback(event_id);
CREATE INDEX IF NOT EXISTS office_event_feedback_author_idx ON office_event_feedback(author_broker_id);

ALTER TABLE office_event_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_event_feedback_select ON office_event_feedback;
CREATE POLICY office_event_feedback_select ON office_event_feedback FOR SELECT TO authenticated
  USING (office_event_can_view(office_broker_id, author_broker_id));
DROP POLICY IF EXISTS office_event_feedback_insert ON office_event_feedback;
CREATE POLICY office_event_feedback_insert ON office_event_feedback FOR INSERT TO authenticated
  WITH CHECK (office_event_can_insert(office_broker_id, author_broker_id));
DROP POLICY IF EXISTS office_event_feedback_update ON office_event_feedback;
CREATE POLICY office_event_feedback_update ON office_event_feedback FOR UPDATE TO authenticated
  USING (office_event_can_manage(office_broker_id, author_broker_id));
