-- 멀티테넌트 보강 3단계: 담당자 계정 연결 (assignee_ids uuid[]).
--
-- assignee는 "김용유, 김가주" 같은 콤마 이름 텍스트가 화면·등록봇의 입력 형식이라 유지하되,
-- 저장 시점에 트리거가 사무소 안에서 이름→broker_profiles.id 를 해석해 assignee_ids에 병기한다.
-- 목적: 개명·퇴사 후에도 담당 이력이 계정 단위로 남는 기반. (사무소 간 동명이인은
-- office_broker_id 격리로 이미 차단되어 있으므로, 여기서는 이력 안정성이 목표.)
--
-- 해석 규칙 (사무소 스코프):
--   1순위 현 멤버(대표+직원)의 profiles.name 정확 일치
--   2순위 퇴사자 보관 기록(broker_diary_archive 계열)의 author_name → author_broker_id
--   미해석 이름(가입 이력 없는 퇴사자 등)은 텍스트로만 남음 — 정상이며 에러 아님.

ALTER TABLE public.broker_properties ADD COLUMN IF NOT EXISTS assignee_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.broker_customers  ADD COLUMN IF NOT EXISTS assignee_ids uuid[] NOT NULL DEFAULT '{}';

-- profiles는 RLS로 본인 외 열람이 막혀 있으므로 DEFINER로 이름 해석 (반환은 id뿐, 이름 노출 없음)
CREATE OR REPLACE FUNCTION public.resolve_assignee_ids(p_office uuid, p_assignee text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(array_agg(DISTINCT r.id), '{}')
  FROM (
    SELECT btrim(n) AS nm
    FROM unnest(string_to_array(coalesce(p_assignee, ''), ',')) AS n
    WHERE btrim(n) <> ''
  ) names
  CROSS JOIN LATERAL (
    -- 이름당 1명: 현 멤버 우선, 없으면 보관 기록. (같은 사무소 동명이인은 임의 1명 — 콤마 텍스트가
    -- 원본이므로 표시는 영향 없고, 그런 사무소는 이름 자체가 이미 모호한 상태다.)
    SELECT x.id FROM (
      SELECT bp.id, 1 AS prio
      FROM broker_profiles bp
      JOIN profiles p ON p.id = bp.user_id
      WHERE (bp.id = p_office OR bp.parent_broker_id = p_office)
        AND p.name = names.nm
      UNION ALL
      SELECT a.author_broker_id, 2
      FROM (
        SELECT author_broker_id, author_name FROM broker_diary_archive WHERE office_broker_id = p_office
        UNION
        SELECT author_broker_id, author_name FROM broker_diary_customers_archive WHERE office_broker_id = p_office
      ) a
      WHERE a.author_name = names.nm AND a.author_broker_id IS NOT NULL
    ) x
    ORDER BY x.prio
    LIMIT 1
  ) r
$$;

CREATE OR REPLACE FUNCTION public.set_assignee_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  -- office_broker_id는 별도 BEFORE 트리거가 채우는데 실행 순서(이름 알파벳순)에 기대지 않도록
  -- broker_id에서 직접 재계산해 자기완결로 해석한다.
  NEW.assignee_ids := public.resolve_assignee_ids(
    coalesce(NEW.office_broker_id,
             (SELECT coalesce(bp.parent_broker_id, bp.id) FROM broker_profiles bp WHERE bp.id = NEW.broker_id)),
    NEW.assignee);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bprops_set_assignee_ids ON public.broker_properties;
CREATE TRIGGER trg_bprops_set_assignee_ids
  BEFORE INSERT OR UPDATE OF assignee ON public.broker_properties
  FOR EACH ROW EXECUTE FUNCTION public.set_assignee_ids();

DROP TRIGGER IF EXISTS trg_bcust_set_assignee_ids ON public.broker_customers;
CREATE TRIGGER trg_bcust_set_assignee_ids
  BEFORE INSERT OR UPDATE OF assignee ON public.broker_customers
  FOR EACH ROW EXECUTE FUNCTION public.set_assignee_ids();

-- 백필 (담당자 있는 행 전건)
UPDATE public.broker_properties
SET assignee_ids = public.resolve_assignee_ids(office_broker_id, assignee)
WHERE coalesce(assignee, '') <> '';

UPDATE public.broker_customers
SET assignee_ids = public.resolve_assignee_ids(office_broker_id, assignee)
WHERE coalesce(assignee, '') <> '';

-- (점검 2단계 추가) 트리거 전용 함수 클라이언트 호출 차단 — anon 이름 프로브 방지
REVOKE EXECUTE ON FUNCTION public.resolve_assignee_ids(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_assignee_ids() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_office_broker_id() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.guard_broker_is_verified() FROM anon, authenticated, public;
