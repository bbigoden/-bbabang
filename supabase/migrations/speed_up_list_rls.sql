-- 고객목록·매물목록이 느리던 원인을 없앤다 (2026-09-04)
--
-- 증상
--   고객목록에서 50건만 요청해도 800ms. 정렬하려면 전 행의 정책을 평가해야 하므로
--   화면에 몇 건을 띄우든 느렸다. 데이터는 고객 820행·매물 1833행뿐이라 양의 문제가 아니었다.
--
-- 원인
--   bcust_select_active / bprop_select_active 가 can_view_broker_data(broker_id) 를
--   행마다 호출했다. broker_id 가 행마다 달라 InitPlan 으로 묶이지 않는다.
--   그 함수 안에는 EXISTS 서브쿼리가 5~6개 있어, 837행이면 4~5천 번 돌았다.
--   고객 쪽이 매물보다 3배 느렸던 것은 can_view_broker_data 가
--   can_view_broker_property 를 다시 부르는 한 단계 중첩 때문이다.
--
-- 해법
--   "볼 수 있는 broker_id 집합"을 쿼리당 한 번 계산하고, 행은 그 집합에 속하는지만 본다.
--   판정 규칙은 can_view_broker_property 와 똑같이 옮겼다 — 바뀌는 건 평가 횟수뿐이다.
--
-- 결과 (대표 계정, 배포본 실측)
--   고객목록 50건   808ms → 33ms
--   고객목록 전건   900ms → 66ms
--   매물목록 50건   210ms → 37ms
--   매물목록 전건   275ms → 104ms
--   보이는 행 수·역할별 권한은 그대로 (anon 0 / 고객 0 / 대표 820 / 관리자 820)
--
-- 기존 함수(can_view_broker_data·can_view_broker_property)는 그대로 둔다.
-- 다른 12개 정책이 쓰고 있고, 그쪽은 행이 적어 느리지 않다.

CREATE OR REPLACE FUNCTION my_visible_broker_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(array_agg(DISTINCT bp.id), ARRAY[]::uuid[])
  FROM broker_profiles bp
  WHERE EXISTS (
          SELECT 1 FROM broker_profiles me
          WHERE me.user_id = auth.uid() AND me.is_approved = true
        )
    AND (
      -- 본인 것
      bp.user_id = auth.uid()
      -- 대표 → 소속 직원
      OR EXISTS (
        SELECT 1 FROM broker_profiles me
        WHERE me.user_id = auth.uid() AND me.is_owner = true
          AND bp.parent_broker_id = me.id
      )
      -- 같은 사무소 동료끼리 (열람 권한이 꺼져 있지 않을 때)
      OR EXISTS (
        SELECT 1 FROM broker_profiles me
        WHERE me.user_id = auth.uid()
          AND me.parent_broker_id IS NOT NULL
          AND me.parent_broker_id = bp.parent_broker_id
          AND (me.permissions->>'can_see_others') IS DISTINCT FROM 'false'
      )
      -- 직원 → 자기 사무소 대표
      OR EXISTS (
        SELECT 1 FROM broker_profiles me
        WHERE me.user_id = auth.uid()
          AND me.parent_broker_id = bp.id
          AND (me.permissions->>'can_see_others') IS DISTINCT FROM 'false'
      )
    )
$$;

CREATE OR REPLACE FUNCTION is_admin_user()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin');
$$;

REVOKE EXECUTE ON FUNCTION my_visible_broker_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION is_admin_user() FROM anon;

-- (SELECT ...) 로 감싸는 것이 핵심이다. 함수를 그냥 부르면 행마다 평가된다.
-- 서브쿼리가 바깥 행을 참조하지 않으므로 플래너가 한 번만 실행하고 해시로 들고 있는다.
--
-- 되돌릴 때:
--   bcust_select_active → ((deleted_at IS NULL) AND can_view_broker_data(broker_id))
--   bprop_select_active → ((deleted_at IS NULL) AND can_view_broker_property(broker_id))

DROP POLICY IF EXISTS "bcust_select_active" ON broker_customers;
CREATE POLICY "bcust_select_active" ON broker_customers FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (SELECT is_admin_user())
      OR broker_id = ANY (SELECT unnest(my_visible_broker_ids()))
    )
  );

DROP POLICY IF EXISTS "bprop_select_active" ON broker_properties;
CREATE POLICY "bprop_select_active" ON broker_properties FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      (SELECT is_admin_user())
      OR broker_id = ANY (SELECT unnest(my_visible_broker_ids()))
    )
  );
