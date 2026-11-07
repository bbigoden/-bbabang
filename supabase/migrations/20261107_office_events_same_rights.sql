-- 예약관리: 쓰는 직원(permissions.events)도 대표 담당 일정까지 대표와 똑같이 고치기·넣기.
-- 사장님(11-07): "예약관리는 이예리와 나만 쓰는 거잖아, 권한을 같게 해야지". 보기 범위(본인 것+대표 것)와 같게 맞춘다.
CREATE OR REPLACE FUNCTION office_event_can_manage(p_office UUID, p_owner UUID) RETURNS boolean
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
CREATE OR REPLACE FUNCTION office_event_can_insert(p_office UUID, p_owner UUID) RETURNS boolean
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
