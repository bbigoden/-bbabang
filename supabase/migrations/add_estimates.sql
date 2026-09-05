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

-- ── 공급자 담당자 (2026-09-04 추가) ────────────────────────────
-- 대표자와 별개로, 실제 현장을 맡는 사람을 견적서에 찍는다.
ALTER TABLE estimate_companies
  ADD COLUMN IF NOT EXISTS manager_name TEXT,
  ADD COLUMN IF NOT EXISTS manager_phone TEXT;

-- ── 직인 버킷 비공개 전환 (2026-09-04) ─────────────────────────
-- 처음엔 PDF 렌더러가 URL로 읽어야 해서 public으로 뒀는데, 그러면 SELECT 정책이
-- bucket_id만 보게 되어 비로그인 사용자까지 직인 파일을 열거·다운로드할 수 있다.
-- 직인은 계약서 위조에 쓰일 수 있는 자산이라 잠그고, 서버가 필요할 때만
-- 짧은 수명의 서명 URL을 만들어 쓴다.
ALTER TABLE estimate_companies ADD COLUMN IF NOT EXISTS stamp_path TEXT;
ALTER TABLE estimate_companies DROP COLUMN IF EXISTS stamp_url;

UPDATE storage.buckets SET public = false WHERE id = 'estimate-stamps';

DROP POLICY IF EXISTS "estimate_stamps_read" ON storage.objects;
CREATE POLICY "estimate_stamps_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'estimate-stamps'
    AND EXISTS (
      SELECT 1 FROM broker_profiles bp
      WHERE bp.user_id = (SELECT auth.uid())
        AND bp.id::text = (storage.foldername(name))[1]
    )
  );

-- ── anon 권한 회수 (2026-09-04) ────────────────────────────────
-- 견적서는 로그인한 대표 본인만 쓰는 기능이라 anon이 접근할 일이 없다.
-- RLS가 이미 막지만, 정책 하나만 느슨해지면 estimate_mail_settings의
-- 네이버 앱 비밀번호까지 새어 나간다. 권한 자체를 회수해 층을 하나 더 둔다.
REVOKE ALL ON estimates              FROM anon;
REVOKE ALL ON estimate_items         FROM anon;
REVOKE ALL ON estimate_companies     FROM anon;
REVOKE ALL ON estimate_clients       FROM anon;
REVOKE ALL ON estimate_templates     FROM anon;
REVOKE ALL ON estimate_sends         FROM anon;
REVOKE ALL ON estimate_mail_settings FROM anon;
REVOKE EXECUTE ON FUNCTION next_estimate_no(UUID) FROM anon;

-- ══════════════════════════════════════════════════════════════
-- 뒤늦게 채워 넣는 기록 (2026-09-05)
--
-- 아래 네 표와 함수 두 개는 DB 에는 있는데 이 파일에 남아 있지 않았다.
-- 새 환경에서 이 파일만 돌리면 공유 링크·첨부·청구서·품목 사전이 통째로
-- 빠진 채로 서므로 여기에 옮겨 적는다. 이미 있는 곳에서는 아무 일도 하지 않는다.
-- ══════════════════════════════════════════════════════════════

-- ── 품목 사전 ──────────────────────────────────────────────────
-- 견적서를 저장할 때마다 이번에 쓴 품목을 쌓아 다음부터 자동완성으로 꺼내 쓴다.
CREATE TABLE IF NOT EXISTS estimate_item_catalog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_broker_id UUID NOT NULL REFERENCES broker_profiles(id) ON DELETE CASCADE,
  category        TEXT,
  name            TEXT NOT NULL,
  spec            TEXT,
  unit            TEXT,
  unit_price      BIGINT NOT NULL DEFAULT 0,
  cost_price      BIGINT NOT NULL DEFAULT 0,
  use_count       INTEGER NOT NULL DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 규격·단위가 비어 있는 품목이 저장할 때마다 새로 쌓이지 않도록 NULLS NOT DISTINCT.
-- (기본값이면 NULL 끼리는 서로 다른 값으로 쳐서 ON CONFLICT 가 걸리지 않는다)
CREATE UNIQUE INDEX IF NOT EXISTS estimate_item_catalog_uniq
  ON estimate_item_catalog (owner_broker_id, name, spec, unit) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS estimate_item_catalog_search
  ON estimate_item_catalog (owner_broker_id, use_count DESC, name);

ALTER TABLE estimate_item_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estimate_item_catalog_all" ON estimate_item_catalog;
CREATE POLICY "estimate_item_catalog_all" ON estimate_item_catalog FOR ALL
  USING (is_my_broker(owner_broker_id)) WITH CHECK (is_my_broker(owner_broker_id));

-- ── 공유 링크 ──────────────────────────────────────────────────
-- 카톡으로 던지는 열람용 주소. 열어 봤는지도 여기에 쌓인다.
CREATE TABLE IF NOT EXISTS estimate_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id     UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ,
  revoked         BOOLEAN NOT NULL DEFAULT FALSE,
  view_count      INTEGER NOT NULL DEFAULT 0,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS estimate_shares_estimate_idx
  ON estimate_shares (estimate_id, created_at DESC);

ALTER TABLE estimate_shares ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estimate_shares_all" ON estimate_shares;
CREATE POLICY "estimate_shares_all" ON estimate_shares FOR ALL
  USING (EXISTS (SELECT 1 FROM estimates e WHERE e.id = estimate_shares.estimate_id AND is_my_broker(e.owner_broker_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM estimates e WHERE e.id = estimate_shares.estimate_id AND is_my_broker(e.owner_broker_id)));

-- ── 첨부 ───────────────────────────────────────────────────────
-- 도면·사진 등. 저장 경로(path)는 ASCII 로만 만들고 원래 이름은 filename 에 따로
-- 둔다 — Supabase Storage 는 키에 한글이 한 글자만 섞여도 Invalid key 로 막는다.
CREATE TABLE IF NOT EXISTS estimate_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id  UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  filename     TEXT NOT NULL,
  size         BIGINT NOT NULL DEFAULT 0,
  content_type TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS estimate_attachments_estimate_idx
  ON estimate_attachments (estimate_id, created_at);

ALTER TABLE estimate_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estimate_attachments_all" ON estimate_attachments;
CREATE POLICY "estimate_attachments_all" ON estimate_attachments FOR ALL
  USING (EXISTS (SELECT 1 FROM estimates e WHERE e.id = estimate_attachments.estimate_id AND is_my_broker(e.owner_broker_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM estimates e WHERE e.id = estimate_attachments.estimate_id AND is_my_broker(e.owner_broker_id)));

-- ── 청구서 ─────────────────────────────────────────────────────
-- 수주한 견적서에서 계약금·중도금·잔금을 끊는다.
-- 견적서를 지워도 청구서는 남아야 해서(받을 돈의 기록) ON DELETE SET NULL.
CREATE TABLE IF NOT EXISTS estimate_invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_broker_id  UUID NOT NULL REFERENCES broker_profiles(id) ON DELETE CASCADE,
  estimate_id      UUID REFERENCES estimates(id) ON DELETE SET NULL,
  invoice_no       TEXT NOT NULL,
  issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  kind             TEXT NOT NULL DEFAULT 'full',
  ratio            NUMERIC,
  company_snapshot JSONB,
  client_name      TEXT,
  client_contact   TEXT,
  client_phone     TEXT,
  client_email     TEXT,
  site_address     TEXT,
  project_name     TEXT,
  supply_amount    BIGINT NOT NULL DEFAULT 0,
  vat              BIGINT NOT NULL DEFAULT 0,
  total            BIGINT NOT NULL DEFAULT 0,
  vat_mode         TEXT NOT NULL DEFAULT 'add',
  due_date         DATE,
  paid_at          DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS estimate_invoices_no_uniq
  ON estimate_invoices (owner_broker_id, invoice_no);
CREATE INDEX IF NOT EXISTS estimate_invoices_owner_idx
  ON estimate_invoices (owner_broker_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS estimate_invoices_estimate_idx
  ON estimate_invoices (estimate_id, issue_date);

ALTER TABLE estimate_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "estimate_invoices_all" ON estimate_invoices;
CREATE POLICY "estimate_invoices_all" ON estimate_invoices FOR ALL
  USING (is_my_broker(owner_broker_id)) WITH CHECK (is_my_broker(owner_broker_id));

REVOKE ALL ON estimate_item_catalog FROM anon;
REVOKE ALL ON estimate_shares       FROM anon;
REVOKE ALL ON estimate_attachments  FROM anon;
REVOKE ALL ON estimate_invoices     FROM anon;

-- ── 품목 사전 반영 함수 ────────────────────────────────────────
-- SECURITY INVOKER(기본) 라 RLS 가 그대로 걸린다. 호출자 본인의 사전에만 쌓인다.
CREATE OR REPLACE FUNCTION public.sync_estimate_catalog(p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_owner uuid;
  v_count integer := 0;
BEGIN
  SELECT id INTO v_owner FROM broker_profiles WHERE user_id = auth.uid() LIMIT 1;
  IF v_owner IS NULL THEN RETURN 0; END IF;

  INSERT INTO estimate_item_catalog
    (owner_broker_id, category, name, spec, unit, unit_price, cost_price, use_count, last_used_at)
  SELECT v_owner,
         NULLIF(TRIM(x->>'category'), ''),
         TRIM(x->>'name'),
         NULLIF(TRIM(x->>'spec'), ''),
         NULLIF(TRIM(x->>'unit'), ''),
         COALESCE((x->>'unit_price')::bigint, 0),
         COALESCE((x->>'cost_price')::bigint, 0),
         1,
         NOW()
    FROM jsonb_array_elements(p_items) AS x
   WHERE COALESCE(TRIM(x->>'name'), '') <> ''
  ON CONFLICT (owner_broker_id, name, spec, unit) DO UPDATE
    SET unit_price   = EXCLUDED.unit_price,
        cost_price   = EXCLUDED.cost_price,
        category     = COALESCE(EXCLUDED.category, estimate_item_catalog.category),
        use_count    = estimate_item_catalog.use_count + 1,
        last_used_at = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

-- ── 공개 열람 함수 ─────────────────────────────────────────────
-- 토큰만으로 부르므로 SECURITY DEFINER. 대신 내보낼 칸을 여기서 하나하나 고른다.
-- 원가(cost_price)·마진·직인 경로는 절대 나가지 않는다.
CREATE OR REPLACE FUNCTION public.get_shared_estimate(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_share estimate_shares%ROWTYPE;
  v_est   estimates%ROWTYPE;
  v_items jsonb;
BEGIN
  SELECT * INTO v_share FROM estimate_shares WHERE token = p_token;
  IF NOT FOUND OR v_share.revoked THEN RETURN NULL; END IF;
  IF v_share.expires_at IS NOT NULL AND v_share.expires_at < NOW() THEN RETURN NULL; END IF;

  SELECT * INTO v_est FROM estimates WHERE id = v_share.estimate_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  UPDATE estimate_shares
     SET view_count = view_count + 1,
         first_viewed_at = COALESCE(first_viewed_at, NOW()),
         last_viewed_at = NOW()
   WHERE id = v_share.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'sort_order', i.sort_order, 'is_header', i.is_header,
           'category', i.category, 'name', i.name, 'spec', i.spec,
           'unit', i.unit, 'qty', i.qty, 'unit_price', i.unit_price,
           'amount', i.amount, 'remark', i.remark
         ) ORDER BY i.sort_order), '[]'::jsonb)
    INTO v_items
    FROM estimate_items i WHERE i.estimate_id = v_est.id;

  RETURN jsonb_build_object(
    'estimate_no', v_est.estimate_no,
    'issue_date', v_est.issue_date,
    'valid_days', v_est.valid_days,
    'client_name', v_est.client_name,
    'client_contact', v_est.client_contact,
    'site_address', v_est.site_address,
    'project_name', v_est.project_name,
    'period', v_est.period,
    'payment_terms', v_est.payment_terms,
    'notes', v_est.notes,
    'overhead_rate', v_est.overhead_rate,
    'discount', v_est.discount,
    'vat_mode', v_est.vat_mode,
    'subtotal', v_est.subtotal,
    'overhead_amount', v_est.overhead_amount,
    'supply_amount', v_est.supply_amount,
    'vat', v_est.vat,
    'total', v_est.total,
    'company', v_est.company_snapshot - 'stamp_path' - 'default_notes',
    'items', v_items
  );
END;
$fn$;

-- ── 내역 통째 교체 (2026-09-05) ────────────────────────────────
-- 지우기와 넣기를 따로 보내면 넣기가 실패했을 때 내역이 통째로 사라진다.
-- 한 트랜잭션으로 묶어 둘 다 되거나 둘 다 안 되게 한다.
CREATE OR REPLACE FUNCTION public.replace_estimate_items(p_estimate_id uuid, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_count integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM estimates WHERE id = p_estimate_id) THEN
    RAISE EXCEPTION '견적서를 찾을 수 없습니다';
  END IF;

  DELETE FROM estimate_items WHERE estimate_id = p_estimate_id;

  INSERT INTO estimate_items
    (estimate_id, sort_order, is_header, category, name, spec, unit,
     qty, unit_price, cost_price, amount, remark)
  SELECT p_estimate_id,
         COALESCE((x->>'sort_order')::int, 0),
         COALESCE((x->>'is_header')::boolean, false),
         x->>'category', x->>'name', x->>'spec', x->>'unit',
         COALESCE((x->>'qty')::numeric, 0),
         COALESCE((x->>'unit_price')::bigint, 0),
         COALESCE((x->>'cost_price')::bigint, 0),
         COALESCE((x->>'amount')::bigint, 0),
         x->>'remark'
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) AS x;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.replace_estimate_items(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_estimate_catalog(jsonb)        FROM anon;

-- ── 청구서 번호 (뒤늦게 채워 넣음, 2026-09-05) ─────────────────
-- C2026-0905-01 꼴. 같은 날 두 장을 동시에 뗄 때 같은 번호가 나올 수 있지만
-- estimate_invoices_no_uniq 가 뒤엣것을 막는다(하루 한두 건이라 이 정도로 둔다).
CREATE OR REPLACE FUNCTION public.next_invoice_no(p_owner uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT 'C' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MMDD') || '-' ||
         LPAD((
           COALESCE(MAX(SUBSTRING(invoice_no FROM '\d+$')::INTEGER), 0) + 1
         )::TEXT, 2, '0')
    FROM estimate_invoices
   WHERE owner_broker_id = p_owner
     AND invoice_no LIKE 'C' || TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul', 'YYYY-MMDD') || '-%';
$fn$;

REVOKE EXECUTE ON FUNCTION public.next_invoice_no(uuid) FROM anon;

-- ── 발행일 기본값을 한국 날짜로 (2026-09-05) ───────────────────
-- DB 시간대가 UTC 라 CURRENT_DATE 는 한국시간 아침 9시 전이면 어제를 준다.
-- 견적번호는 Asia/Seoul 기준으로 매기고 있어서, 아침에 만든 견적서는
-- 번호가 2026-0905-01 인데 발행일은 2026-09-04 로 찍혔다. 청구서도 같다.
ALTER TABLE estimates
  ALTER COLUMN issue_date SET DEFAULT (NOW() AT TIME ZONE 'Asia/Seoul')::date;
ALTER TABLE estimate_invoices
  ALTER COLUMN issue_date SET DEFAULT (NOW() AT TIME ZONE 'Asia/Seoul')::date;
