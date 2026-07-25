-- 사무소 손익 분배 설정 (대표 전용)
-- 정산 페이지에서 월 사무실 수익 − 기본경비 = 순손익을 동업자와 비율대로 분배해 보여주기 위한 설정.
-- 기본값: 경비 400만 원, 5:5 분배. 사무소(대표 broker_profiles.id)당 1행.

CREATE TABLE IF NOT EXISTS office_settlement_settings (
  office_broker_id UUID PRIMARY KEY REFERENCES broker_profiles(id) ON DELETE CASCADE,
  monthly_expense BIGINT NOT NULL DEFAULT 4000000,        -- 월 기본경비 (원)
  partner_split NUMERIC(4,3) NOT NULL DEFAULT 0.5         -- 내(대표) 몫 비율 (0~1)
    CHECK (partner_split >= 0 AND partner_split <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE office_settlement_settings ENABLE ROW LEVEL SECURITY;

-- 대표 본인 사무소 설정만 읽기/쓰기 (직원·타 사무소 접근 불가)
DROP POLICY IF EXISTS "office_settlement_settings_owner_all" ON office_settlement_settings;
CREATE POLICY "office_settlement_settings_owner_all" ON office_settlement_settings
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM broker_profiles me
      WHERE me.user_id = auth.uid()
        AND me.id = office_settlement_settings.office_broker_id
        AND me.is_owner = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM broker_profiles me
      WHERE me.user_id = auth.uid()
        AND me.id = office_settlement_settings.office_broker_id
        AND me.is_owner = true
    )
  );

GRANT SELECT, INSERT, UPDATE ON office_settlement_settings TO authenticated;
REVOKE ALL ON office_settlement_settings FROM anon;
