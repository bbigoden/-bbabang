-- 견적서 한 틀로 발주서·간이영수증도 찍는다. 서류 종류만 구분하고 나머지 구조는 그대로 쓴다.
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'estimate'
  CHECK (doc_type IN ('estimate', 'purchase_order', 'receipt'));

-- 공개 열람(get_shared_estimate)에도 서류 종류를 내려준다 — 발주서를 "견적서"로 보여주지 않는다.
-- 함수 본문은 add_estimates.sql 의 최종본에 'doc_type' 한 줄만 더한 것이다.
