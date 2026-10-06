-- 견적서 한 틀로 발주서·간이영수증도 찍는다. 서류 종류만 구분하고 나머지 구조는 그대로 쓴다.
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'estimate'
  CHECK (doc_type IN ('estimate', 'purchase_order', 'receipt'));
