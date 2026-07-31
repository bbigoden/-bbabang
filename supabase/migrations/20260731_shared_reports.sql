-- 추천 매물 보고서 (고객 공유 링크).
-- 매물장에서 매물을 골라 링크를 만들고, 고객은 로그인 없이 /r/[id]로 열람.
-- 공개 범위 원칙: 내부 정보(memo·brief_memo·description — 임대인 연락처가 섞임)와
-- 정확한 번지는 절대 반환하지 않는다. 주소는 동/리 단위까지만.

CREATE TABLE IF NOT EXISTS public.shared_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- id 자체가 공유 토큰 (추측 불가)
  office_broker_id uuid NOT NULL REFERENCES public.broker_profiles(id),
  created_by uuid NOT NULL REFERENCES public.broker_profiles(id),
  title text NOT NULL DEFAULT '추천 매물',
  property_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days',
  viewed_at timestamptz,          -- 최초 열람 시각 (읽음 확인)
  view_count int NOT NULL DEFAULT 0
);

ALTER TABLE public.shared_reports ENABLE ROW LEVEL SECURITY;

-- 사무소 멤버만 생성·조회 (anon은 행 접근 불가 — 공개 열람은 아래 DEFINER RPC로만)
CREATE POLICY shared_reports_select ON public.shared_reports
  FOR SELECT USING (public.is_office_member(office_broker_id));
CREATE POLICY shared_reports_insert ON public.shared_reports
  FOR INSERT WITH CHECK (
    public.is_office_member(office_broker_id)
    AND EXISTS (SELECT 1 FROM broker_profiles me WHERE me.user_id = (SELECT auth.uid()) AND me.id = created_by)
  );
CREATE POLICY shared_reports_delete ON public.shared_reports
  FOR DELETE USING (public.is_office_member(office_broker_id));

CREATE INDEX IF NOT EXISTS idx_shared_reports_office ON public.shared_reports (office_broker_id, created_at DESC);

-- 공개 열람 RPC — anon 실행 가능. 만료 확인 + 열람 기록 + 공개 필드만 선별 반환.
CREATE OR REPLACE FUNCTION public.get_shared_report(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  r record;
  office_name_v text;
  props jsonb;
BEGIN
  SELECT * INTO r FROM shared_reports WHERE id = p_id AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- 열람 기록 (최초 시각 + 횟수)
  UPDATE shared_reports
  SET viewed_at = coalesce(viewed_at, now()), view_count = view_count + 1
  WHERE id = p_id;

  SELECT bp.office_name INTO office_name_v FROM broker_profiles bp WHERE bp.id = r.office_broker_id;

  -- property_ids 배열 순서 유지, 휴지통 제외, 공개 필드만.
  -- 주소는 숫자(번지) 앞까지만 — "천안시 서북구 성정동 625-1" → "천안시 서북구 성정동"
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.ord), '[]'::jsonb) INTO props
  FROM (
    SELECT ord, jsonb_build_object(
      'seq_no', p.seq_no,
      'deal_type', p.deal_type,
      'room_type', p.room_type,
      'region', nullif(btrim(regexp_replace(coalesce(p.address,''), '[0-9].*$', '')), ''),
      'price', p.price,
      'monthly_rent', p.monthly_rent,
      'management_fee', p.management_fee,
      'premium', p.premium,
      'size_pyeong', p.size_pyeong,
      'area_supplied', p.area_supplied,
      'area_type', p.area_type,
      'area_unit', p.area_unit,
      'floor', p.floor,
      'total_floors', p.total_floors,
      'options', p.options,
      'images', p.images,
      'move_in_date', p.move_in_date,
      'rooms_bathrooms', p.rooms_bathrooms,
      'direction', p.direction,
      'parking', p.parking,
      'approval_date', p.approval_date,
      'status', p.status
    ) AS item
    FROM unnest(r.property_ids) WITH ORDINALITY AS t(pid, ord)
    JOIN broker_properties p ON p.id = t.pid
    WHERE p.deleted_at IS NULL AND p.office_broker_id = r.office_broker_id
  ) x;

  RETURN jsonb_build_object(
    'title', r.title,
    'office_name', office_name_v,
    'created_at', r.created_at,
    'properties', props
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_shared_report(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_shared_report(uuid) TO anon, authenticated;
