-- 견적서 (건설·인테리어) — 사무소 대표 개인 전용
--
-- 부소장의 임대 고객(customers)과는 완전히 분리된 별도 데이터.
-- 대표가 보유한 다른 회사 명의로 공사·인테리어 견적을 발행하고 메일로 보내는 용도.
-- 모든 테이블은 owner_broker_id = 본인 broker_profiles.id 기준으로만 접근 가능
-- (정산처럼 사무소 공유가 아니라, 만든 본인만 보는 구조).

-- ── 1. 발행 명의 회사 (여러 개 등록 → 견적서마다 선택) ─────────
CREATE TABLE IF NOT EXISTS estimate_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,                                 -- 상호
  biz_no TEXT,                                        -- 사업자등록번호
  ceo TEXT,                                           -- 대표자
  address TEXT,                                       -- 사업장 소재지
  biz_type TEXT,                                      -- 업태
  biz_item TEXT,                                      -- 종목
  phone TEXT,
  fax TEXT,
  email TEXT,                                         -- 견적서에 표기할 회사 메일
  bank_account TEXT,                                  -- 입금계좌 (은행/번호/예금주)
  stamp_url TEXT,                                     -- 직인 이미지 URL
  default_notes TEXT,                                 -- 이 회사 기본 특기사항
  is_default BOOLEAN NOT NULL DEFAULT FALSE,          -- 새 견적 시 기본 선택
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estimate_companies_owner_idx
  ON estimate_companies(owner_broker_id, sort_order, created_at);

-- ── 2. 거래처 (견적 전용 — 부소장 고객목록과 무관) ─────────────
CREATE TABLE IF NOT EXISTS estimate_clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,                                 -- 상호 또는 고객명
  contact_name TEXT,                                  -- 담당자
  phone TEXT,
  email TEXT,
  address TEXT,                                       -- 현장 주소
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estimate_clients_owner_idx
  ON estimate_clients(owner_broker_id, name);

-- ── 3. 견적서 본문 ─────────────────────────────────────────────
-- 회사·거래처 정보는 스냅샷으로도 저장한다. 나중에 회사 주소가 바뀌어도
-- 이미 보낸 견적서 PDF는 발행 당시 내용 그대로 재출력되어야 하기 때문.
CREATE TABLE IF NOT EXISTS estimates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  company_id UUID REFERENCES estimate_companies(id) ON DELETE SET NULL,
  client_id UUID REFERENCES estimate_clients(id) ON DELETE SET NULL,

  estimate_no TEXT NOT NULL,                          -- 2026-0904-01
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,

  company_snapshot JSONB,                             -- 발행 당시 회사 정보
  client_name TEXT,
  client_contact TEXT,
  client_phone TEXT,
  client_email TEXT,
  site_address TEXT,                                  -- 현장 주소

  project_name TEXT,                                  -- 공사명
  period TEXT,                                        -- 공사기간
  valid_days INTEGER NOT NULL DEFAULT 30,             -- 견적 유효기간(일)
  payment_terms TEXT,                                 -- 결제조건
  notes TEXT,                                         -- 특기사항

  overhead_rate NUMERIC(5,4) NOT NULL DEFAULT 0,      -- 경비(공과잡비) 비율 0.05 = 5%
  discount BIGINT NOT NULL DEFAULT 0,                 -- 할인액
  vat_mode TEXT NOT NULL DEFAULT 'add',               -- add: 부가세 별도 / none: 부가세 없음

  -- 앱에서 계산해 저장 (PDF·목록에서 재계산 없이 바로 씀)
  subtotal BIGINT NOT NULL DEFAULT 0,                 -- 내역 합계
  overhead_amount BIGINT NOT NULL DEFAULT 0,          -- 경비
  supply_amount BIGINT NOT NULL DEFAULT 0,            -- 공급가액
  vat BIGINT NOT NULL DEFAULT 0,
  total BIGINT NOT NULL DEFAULT 0,                    -- 합계

  status TEXT NOT NULL DEFAULT 'draft',               -- draft/sent/won/lost
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estimates_owner_idx
  ON estimates(owner_broker_id, issue_date DESC, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS estimates_no_uniq
  ON estimates(owner_broker_id, estimate_no);

-- ── 4. 견적 내역 줄 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimate_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID REFERENCES estimates(id) ON DELETE CASCADE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_header BOOLEAN NOT NULL DEFAULT FALSE,           -- 공종 구분줄 (금액 없이 제목만)
  category TEXT,                                      -- 공종 (목공사·전기공사…)
  name TEXT,                                          -- 품명
  spec TEXT,                                          -- 규격
  unit TEXT,                                          -- 단위 (㎡·EA·식…)
  qty NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price BIGINT NOT NULL DEFAULT 0,
  amount BIGINT NOT NULL DEFAULT 0,
  remark TEXT
);

CREATE INDEX IF NOT EXISTS estimate_items_estimate_idx
  ON estimate_items(estimate_id, sort_order);

-- ── 5. 공사 프리셋 (원룸 올수리 / 상가 인테리어 …) ─────────────
CREATE TABLE IF NOT EXISTS estimate_templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_broker_id UUID REFERENCES broker_profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,           -- estimate_items 형태의 배열
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estimate_templates_owner_idx
  ON estimate_templates(owner_broker_id, sort_order);

-- ── 6. 메일 발송 이력 ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS estimate_sends (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID REFERENCES estimates(id) ON DELETE CASCADE NOT NULL,
  to_email TEXT NOT NULL,
  cc TEXT,
  subject TEXT,
  body TEXT,
  ok BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS estimate_sends_estimate_idx
  ON estimate_sends(estimate_id, sent_at DESC);

-- ── 7. 메일(SMTP) 설정 — 사용자당 1행 ──────────────────────────
-- 네이버 앱 비밀번호가 들어간다. RLS로 본인 행만 접근 가능하고,
-- 발송은 서버 라우트가 사용자 세션으로 읽어 쓴다 (service role 불필요).
CREATE TABLE IF NOT EXISTS estimate_mail_settings (
  owner_broker_id UUID PRIMARY KEY REFERENCES broker_profiles(id) ON DELETE CASCADE,
  smtp_user TEXT,                                     -- 네이버 메일 주소
  smtp_pass TEXT,                                     -- 앱 비밀번호
  from_name TEXT,                                     -- 발신자 표시 이름
  cc TEXT,
  bcc TEXT,
  subject_template TEXT,
  body_template TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 견적번호 자동 채번 (2026-0904-01) ──────────────────────────
CREATE OR REPLACE FUNCTION next_estimate_no(p_owner UUID)
RETURNS TEXT AS $$
  SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MMDD') || '-' ||
         LPAD((
           COALESCE(MAX(SUBSTRING(estimate_no FROM '\d+$')::INTEGER), 0) + 1
         )::TEXT, 2, '0')
  FROM estimates
  WHERE owner_broker_id = p_owner
    AND estimate_no LIKE TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MMDD') || '-%';
$$ LANGUAGE SQL STABLE;

-- ── updated_at 자동 갱신 ───────────────────────────────────────
CREATE OR REPLACE FUNCTION estimates_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS estimate_companies_updated_at ON estimate_companies;
CREATE TRIGGER estimate_companies_updated_at BEFORE UPDATE ON estimate_companies
  FOR EACH ROW EXECUTE FUNCTION estimates_touch_updated_at();

DROP TRIGGER IF EXISTS estimate_clients_updated_at ON estimate_clients;
CREATE TRIGGER estimate_clients_updated_at BEFORE UPDATE ON estimate_clients
  FOR EACH ROW EXECUTE FUNCTION estimates_touch_updated_at();

DROP TRIGGER IF EXISTS estimates_updated_at ON estimates;
CREATE TRIGGER estimates_updated_at BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION estimates_touch_updated_at();

DROP TRIGGER IF EXISTS estimate_templates_updated_at ON estimate_templates;
CREATE TRIGGER estimate_templates_updated_at BEFORE UPDATE ON estimate_templates
  FOR EACH ROW EXECUTE FUNCTION estimates_touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────
-- 공통 규칙: owner_broker_id 가 곧 로그인한 본인의 broker_profiles.id 일 때만 허용.
CREATE OR REPLACE FUNCTION is_my_broker(p_broker UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.id = p_broker AND bp.user_id = auth.uid()
  );
$$ LANGUAGE SQL STABLE;

ALTER TABLE estimate_companies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_clients       ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_sends         ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_mail_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estimate_companies_all" ON estimate_companies;
CREATE POLICY "estimate_companies_all" ON estimate_companies FOR ALL
  USING (is_my_broker(owner_broker_id)) WITH CHECK (is_my_broker(owner_broker_id));

DROP POLICY IF EXISTS "estimate_clients_all" ON estimate_clients;
CREATE POLICY "estimate_clients_all" ON estimate_clients FOR ALL
  USING (is_my_broker(owner_broker_id)) WITH CHECK (is_my_broker(owner_broker_id));

DROP POLICY IF EXISTS "estimates_all" ON estimates;
CREATE POLICY "estimates_all" ON estimates FOR ALL
  USING (is_my_broker(owner_broker_id)) WITH CHECK (is_my_broker(owner_broker_id));

DROP POLICY IF EXISTS "estimate_templates_all" ON estimate_templates;
CREATE POLICY "estimate_templates_all" ON estimate_templates FOR ALL
  USING (is_my_broker(owner_broker_id)) WITH CHECK (is_my_broker(owner_broker_id));

DROP POLICY IF EXISTS "estimate_mail_settings_all" ON estimate_mail_settings;
CREATE POLICY "estimate_mail_settings_all" ON estimate_mail_settings FOR ALL
  USING (is_my_broker(owner_broker_id)) WITH CHECK (is_my_broker(owner_broker_id));

-- 자식 테이블은 상위 견적서의 소유자를 따라간다
DROP POLICY IF EXISTS "estimate_items_all" ON estimate_items;
CREATE POLICY "estimate_items_all" ON estimate_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM estimates e
    WHERE e.id = estimate_items.estimate_id AND is_my_broker(e.owner_broker_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM estimates e
    WHERE e.id = estimate_items.estimate_id AND is_my_broker(e.owner_broker_id)
  ));

DROP POLICY IF EXISTS "estimate_sends_all" ON estimate_sends;
CREATE POLICY "estimate_sends_all" ON estimate_sends FOR ALL
  USING (EXISTS (
    SELECT 1 FROM estimates e
    WHERE e.id = estimate_sends.estimate_id AND is_my_broker(e.owner_broker_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM estimates e
    WHERE e.id = estimate_sends.estimate_id AND is_my_broker(e.owner_broker_id)
  ));

-- ── search_path 고정 (2026-09-04 추가) ─────────────────────────
-- is_my_broker는 RLS 정책에서 호출되므로, search_path가 열려 있으면
-- 동명 테이블을 심어 정책을 우회할 여지가 생긴다.
ALTER FUNCTION is_my_broker(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION next_estimate_no(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION estimates_touch_updated_at() SET search_path = public, pg_temp;
