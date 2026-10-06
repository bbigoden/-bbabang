-- 견적서 한 틀로 발주서·간이영수증도 찍는다. 서류 종류만 구분하고 나머지 구조는 그대로 쓴다.
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'estimate'
  CHECK (doc_type IN ('estimate', 'purchase_order', 'receipt'));

-- 공개 열람(get_shared_estimate)에도 서류 종류를 내려준다 — 발주서를 "견적서"로 보여주지 않는다.

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
           'material_price', i.material_price, 'labor_price', i.labor_price,
           'amount', i.amount, 'remark', i.remark
         ) ORDER BY i.sort_order), '[]'::jsonb)
    INTO v_items
    FROM estimate_items i WHERE i.estimate_id = v_est.id;

  RETURN jsonb_build_object(
    'estimate_no', v_est.estimate_no,
    'doc_type', v_est.doc_type,
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
