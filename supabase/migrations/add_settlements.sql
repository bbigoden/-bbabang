-- 사무소 정산 (직원·사무소 통합 한 테이블)
-- - 1계약 = 1행, 공동중개는 같은 contract_no로 N행
-- - 직원 입력 컬럼만 저장하고, 공급가/VAT/담당자수수료/원천/실수령/지점수익은 앱에서 계산
-- - office_broker_id = 사무소 대표의 broker_profiles.id (자료실 패턴 재사용)

CREATE TABLE IF NOT EXISTS settlements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  office_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  assignee_broker_id UUID REFERENCES broker_profiles(id) ON DELETE SET NULL,
  contract_no INTEGER NOT NULL,                       -- 사무소별 계약 번호 (공동중개 시 같은 번호로 두 행)
  contract_date DATE,                                 -- 계약일
  contract_address TEXT,                              -- 계약주소
  seller TEXT,                                        -- 매도인(임대)
  buyer TEXT,                                         -- 매수인(임차)
  assignee_name TEXT,                                 -- 담당자 표시명 (직원 삭제 후에도 남게)
  settlement_rate NUMERIC(4,3) NOT NULL DEFAULT 0.5,  -- 정산비 (0.5 / 0.55 / 0.6 / 0.7 ...)
  seller_fee BIGINT NOT NULL DEFAULT 0,               -- 매도 수수료 (VAT 포함, 원 단위)
  buyer_fee BIGINT NOT NULL DEFAULT 0,                -- 매수 수수료 (VAT 포함, 원 단위)
  payment_date TEXT,                                  -- 수수료입금일 (분할입금 "250411/250430" 도 허용)
  is_settled BOOLEAN NOT NULL DEFAULT FALSE,          -- 정산 완료 여부 (엑셀의 'O')
  settled_at DATE,                                    -- 정산일 (날짜)
  withhold_exempt BOOLEAN NOT NULL DEFAULT FALSE,     -- 원천징수 면제 (대표 등)
  memo TEXT,
  created_by UUID REFERENCES broker_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS settlements_office_idx
  ON settlements(office_broker_id, contract_date DESC, contract_no DESC);
CREATE INDEX IF NOT EXISTS settlements_assignee_idx
  ON settlements(assignee_broker_id, contract_date DESC);

-- 직원별 기본 정산비 + 원천 면제 옵션
ALTER TABLE broker_profiles
  ADD COLUMN IF NOT EXISTS default_settlement_rate NUMERIC(4,3) DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS withhold_exempt BOOLEAN DEFAULT FALSE;

-- 사무소 내 다음 계약 번호 받기
CREATE OR REPLACE FUNCTION next_settlement_no(p_office UUID)
RETURNS INTEGER AS $$
  SELECT COALESCE(MAX(contract_no), 0) + 1
  FROM settlements
  WHERE office_broker_id = p_office;
$$ LANGUAGE SQL STABLE;

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION settlements_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS settlements_updated_at ON settlements;
CREATE TRIGGER settlements_updated_at
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION settlements_touch_updated_at();

-- ── RLS ───────────────────────────────────────────────
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- 조회: 본인 행 + 같은 사무소 대표(소속 직원 전부)
DROP POLICY IF EXISTS "settlements_select" ON settlements;
CREATE POLICY "settlements_select" ON settlements FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND (
        me.id = settlements.assignee_broker_id
        OR me.id = settlements.office_broker_id
      )
  )
);

-- 추가: 같은 사무소 소속만 가능. 직원은 본인 행만, 대표는 누구 행이든.
DROP POLICY IF EXISTS "settlements_insert" ON settlements;
CREATE POLICY "settlements_insert" ON settlements FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND (
        me.id = settlements.office_broker_id
        OR (me.parent_broker_id = settlements.office_broker_id AND me.is_approved = true
            AND me.id = settlements.assignee_broker_id)
      )
  )
);

-- 수정: 본인 행 + 사무소 대표
DROP POLICY IF EXISTS "settlements_update" ON settlements;
CREATE POLICY "settlements_update" ON settlements FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND (
        me.id = settlements.assignee_broker_id
        OR me.id = settlements.office_broker_id
      )
  )
);

-- 삭제: 사무소 대표만
DROP POLICY IF EXISTS "settlements_delete" ON settlements;
CREATE POLICY "settlements_delete" ON settlements FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM broker_profiles me
    WHERE me.user_id = auth.uid()
      AND me.id = settlements.office_broker_id
  )
);
