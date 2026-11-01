-- 자료실: 대표는 모든 권한(사장님 지시 2026-11-01).
-- 대표=사무소 자료 전부 보기·고치기·옮기기·지우기 / 직원=본인 것+대표 것 보기, 고치기·지우기는 본인 것만.
-- office_res_can_manage 하나만 바꾸면 표(폴더·파일)와 저장소 정책이 모두 따라온다.
CREATE OR REPLACE FUNCTION office_res_can_manage(p_office UUID, p_uploader UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM broker_profiles bp
    WHERE bp.user_id = auth.uid()
      AND (
        bp.id = p_office
        OR (bp.parent_broker_id = p_office AND bp.is_approved = true AND bp.id = p_uploader)
      )
  )
$$;
