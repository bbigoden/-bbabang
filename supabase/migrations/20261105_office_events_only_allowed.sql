-- 일정은 대표 + permissions.events=true 인 직원만(사장님 11-05: "대표와 이예리만").
-- 다른 직원·이사는 아예 안 보인다. 나중에 부동산으로 넓힐 때는 직원마다 events 를 켜면 된다.
-- 운영 적용·시험 완료(11-05): 예리 넣기·고치기·신고 OK / 이사·일반 직원 보기 0·넣기 막힘 / 대표 전부 보임.
CREATE OR REPLACE FUNCTION office_event_can_view(p_office UUID, p_owner UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (bp.id = p_office
           OR (bp.parent_broker_id = p_office AND bp.is_approved = true
               AND bp.permissions->>'events' = 'true'
               AND (p_owner = bp.id OR p_owner = p_office)))
  )
$$;

CREATE OR REPLACE FUNCTION office_event_can_manage(p_office UUID, p_owner UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (bp.id = p_office
           OR (bp.parent_broker_id = p_office AND bp.is_approved = true
               AND bp.permissions->>'events' = 'true' AND bp.id = p_owner))
  )
$$;

CREATE OR REPLACE FUNCTION office_event_can_insert(p_office UUID, p_owner UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (bp.id = p_office
           OR (bp.parent_broker_id = p_office AND bp.is_approved = true
               AND bp.permissions->>'events' = 'true' AND bp.id = p_owner))
  )
$$;

-- 이예리
UPDATE broker_profiles
SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"events": true}'::jsonb
WHERE id = 'c7e58900-e6bb-4f88-b3bf-d1879f8a6050';

-- 대표(김용유)도 같은 표시 — 메뉴는 이 표시가 있는 계정에만 보인다(다른 사무소 대표에게 안 보이게). 11-05 사장님 승인·적용.
UPDATE broker_profiles
SET permissions = COALESCE(permissions, '{}'::jsonb) || '{"events": true}'::jsonb
WHERE id = '7edde640-a6ea-4657-ab52-0403e9fdd39e';
