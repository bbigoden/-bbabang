-- 2026-07-22 풀스택 점검에서 발견된 노출·권한 구멍 일괄 차단
-- (원격 DB에 이미 적용됨 — 기록 보존용)

------------------------------------------------------------------------------
-- P0. 비로그인 상태로 매물 메모의 집주인 연락처가 전량 조회되던 문제
------------------------------------------------------------------------------
-- broker_properties의 SELECT 정책이 status='available'이면 anon 포함 누구에게나
-- "모든 컬럼"을 열어줬다. 화면에 안 보여도 브라우저에 노출된 anon 키로 REST를
-- 직접 치면 memo/brief_memo/custom_fields(공개 매물 1404건 중 1105건에 휴대폰
-- 번호 존재)와 assignee(직원 실명 1403건)가 통째로 덤프됐다.
--
-- Postgres는 행 정책으로 컬럼을 가릴 수 없으므로, 공개용 안전 컬럼만 담은 뷰를
-- 만들고 테이블 직접 SELECT는 소유·사무소·관리자로 좁힌다.
-- 행 가시성 규칙은 기존과 동일하게 유지해야 중개사가 자기 사무소의
-- '계약완료/숨김' 매물 상세도 계속 열 수 있다.
CREATE OR REPLACE VIEW public.public_properties AS
SELECT
  p.id, p.broker_id, p.seq_no,
  p.deal_type, p.room_type, p.address,
  p.price, p.monthly_rent, p.management_fee, p.premium,
  p.size_pyeong, p.area_type, p.area_unit, p.area_supplied,
  p.floor, p.total_floors, p.rooms_bathrooms,
  p.options, p.images, p.description,
  p.move_in_date, p.approval_date, p.parking, p.direction,
  p.status, p.created_at
FROM public.broker_properties p
WHERE p.deleted_at IS NULL
  AND (p.status = 'available' OR public.can_view_broker_property(p.broker_id));

-- 뷰는 소유자 권한으로 실행되므로 위 WHERE가 유일한 관문이다.
ALTER VIEW public.public_properties SET (security_invoker = false);
GRANT SELECT ON public.public_properties TO anon, authenticated;

DROP POLICY IF EXISTS bprop_select_active ON public.broker_properties;
CREATE POLICY bprop_select_active ON public.broker_properties
  FOR SELECT
  USING (deleted_at IS NULL AND public.can_view_broker_property(broker_id));

------------------------------------------------------------------------------
-- P1. purge_old_trash() — 로그인만 하면 전 사무소 휴지통을 영구삭제
------------------------------------------------------------------------------
-- SECURITY DEFINER인데 본문에 auth.uid() 검사가 전혀 없었다. 아무 로그인
-- 사용자가 RPC 한 번으로 30일 경과 soft-delete 행을 전사 물리삭제할 수 있었다.
-- (다른 휴지통 함수는 소유·대표 검증이 제대로 있고 이 함수만 예외였다)
CREATE OR REPLACE FUNCTION public.purge_old_trash()
RETURNS TABLE(properties_purged int, customers_purged int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p_count int;
  c_count int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION '권한 없음: 휴지통 일괄 영구삭제는 관리자만 가능합니다';
  END IF;

  WITH d AS (
    DELETE FROM broker_properties
    WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
    RETURNING 1
  ) SELECT count(*) INTO p_count FROM d;

  WITH d AS (
    DELETE FROM broker_customers
    WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'
    RETURNING 1
  ) SELECT count(*) INTO c_count FROM d;

  RETURN QUERY SELECT p_count, c_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.purge_old_trash() FROM anon;

------------------------------------------------------------------------------
-- P1. notifications INSERT — 타인에게 위조 알림(피싱 링크) 삽입 가능
------------------------------------------------------------------------------
-- WITH CHECK가 "로그인했는가"만 봤다. 푸시 경로가 이미 쓰는 can_notify_user
-- (chat_room·같은 사무소·proposal 관계)를 DB 레벨에도 강제한다.
-- 관리자 공지·중개사 승인/반려 알림은 관계 없는 대상에게도 보내야 하므로
-- 관리자 분기를 명시적으로 둔다.
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR public.can_notify_user(user_id)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  );

------------------------------------------------------------------------------
-- P1. broker_customers UPDATE — 고객을 타 사무소로 이전 가능
------------------------------------------------------------------------------
-- WITH CHECK이 없어 수정 후 행을 검증하지 않았다. 내 사무소 고객의 broker_id를
-- 타 사무소 값으로 바꿔 반출/주입할 수 있었다. bprop_update는 이미 양쪽을 건다.
DROP POLICY IF EXISTS bcust_update ON public.broker_customers;
CREATE POLICY bcust_update ON public.broker_customers
  FOR UPDATE
  USING (public.can_view_broker_data(broker_id))
  WITH CHECK (public.can_view_broker_data(broker_id));

------------------------------------------------------------------------------
-- P1. profiles UPDATE — 정지된 계정이 스스로 제재를 해제
------------------------------------------------------------------------------
-- WITH CHECK이 role='admin'만 막아서, 차단된 사용자가 자기 account_status를
-- 'active'로 되돌리거나 role을 broker로 승격할 수 있었다. 제재 판정이
-- auth-context 클라이언트 코드에만 있고 서버 강제가 전혀 없었다.
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING (
    (SELECT auth.uid()) = id
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = (SELECT auth.uid()) AND p.role = 'admin')
    OR (
      -- 본인 수정: 역할·제재 상태·관리자 메모는 손댈 수 없다
      role = (SELECT p.role FROM public.profiles p WHERE p.id = profiles.id)
      AND account_status IS NOT DISTINCT FROM (SELECT p.account_status FROM public.profiles p WHERE p.id = profiles.id)
      AND suspended_until IS NOT DISTINCT FROM (SELECT p.suspended_until FROM public.profiles p WHERE p.id = profiles.id)
      AND admin_note IS NOT DISTINCT FROM (SELECT p.admin_note FROM public.profiles p WHERE p.id = profiles.id)
    )
  );

------------------------------------------------------------------------------
-- P0. 비로그인 상태로 중개사·직원·퇴사자의 실명/이메일/휴대폰이 전량 조회
------------------------------------------------------------------------------
-- profiles_select_anon_brokers 정책이 role='broker' 활성 행을 anon에게 열어주는데
-- 컬럼 제한이 없어 /rest/v1/profiles?select=email,phone 한 번이면 전부 나왔다.
-- 공개 화면이 anon으로 실제 읽는 건 broker_profiles→profiles(name)의 이름뿐이다.
REVOKE SELECT ON public.profiles FROM anon;
GRANT SELECT (id, name) ON public.profiles TO anon;

-- broker_profiles도 전 컬럼이 anon에 열려 있었다. 특히 office_code(사무소 가입
-- 코드)가 노출돼 아무나 join_office_by_code를 시도할 수 있었고, col_settings·
-- permissions·license_number·business_reg_number·verification_info·
-- default_settlement_rate(정산 요율)까지 읽혔다.
REVOKE SELECT ON public.broker_profiles FROM anon;
GRANT SELECT (
  id, office_name, address, district,
  rating, review_count, deal_count, is_verified,
  avg_response_hours, acceptance_rate,
  parent_broker_id, is_approved, alert_regions, created_at,
  -- user_id는 PostgREST가 profiles(name) 임베딩을 풀 때 쓰는 조인 키다.
  -- 빼면 매물 상세의 중개사 카드가 통째로 비어버린다.
  user_id
) ON public.broker_profiles TO anon;

-- get_public_brokers는 SECURITY DEFINER라 컬럼 권한을 우회한다. 반환값의
-- user_name(대표 실명)은 유일한 호출처(regions)에서 쓰지도 않으면서 anon에게
-- 실명을 흘리고 있었다 → 반환 컬럼에서 제거.
DROP FUNCTION IF EXISTS public.get_public_brokers(text, text, boolean, integer, integer);
CREATE FUNCTION public.get_public_brokers(
  p_sido text, p_sigungu text, p_only_verified boolean, p_limit integer, p_offset integer
)
RETURNS TABLE(
  id uuid, office_name text, address text, district text,
  rating numeric, review_count integer, deal_count integer,
  is_verified boolean, avg_response_hours numeric, acceptance_rate integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bp.id, bp.office_name, bp.address, bp.district,
    COALESCE(bp.rating, 0)::NUMERIC AS rating,
    COALESCE(bp.review_count, 0) AS review_count,
    COALESCE(bp.deal_count, 0) AS deal_count,
    COALESCE(bp.is_verified, false) AS is_verified,
    bp.avg_response_hours,
    bp.acceptance_rate
  FROM public.broker_profiles bp
  WHERE bp.is_owner = true
    AND COALESCE(bp.is_approved, true) = true
    AND (p_only_verified = false OR bp.is_verified = true)
    AND (p_sido IS NULL OR bp.address ILIKE p_sido || '%')
    AND (p_sigungu IS NULL OR bp.address ILIKE '%' || p_sigungu || '%')
  ORDER BY bp.is_verified DESC NULLS LAST, COALESCE(bp.rating, 0) DESC, COALESCE(bp.review_count, 0) DESC
  LIMIT GREATEST(LEAST(p_limit, 100), 1)
  OFFSET GREATEST(p_offset, 0);
$$;
GRANT EXECUTE ON FUNCTION public.get_public_brokers(text, text, boolean, integer, integer) TO anon, authenticated;

------------------------------------------------------------------------------
-- 마무리: 공개 화면에서 실명 표기를 걷어낸 뒤 anon의 profiles 접근 완전 차단
------------------------------------------------------------------------------
-- search/recommendations/site-curation은 실명을 조회만 하고 쓰지 않았고,
-- property/[id]의 '대표 OOO' 표기는 제거했다(직원 노출 금지 정책).
-- 이제 anon이 profiles를 읽을 이유가 없다.
REVOKE SELECT ON public.profiles FROM anon;
DROP POLICY IF EXISTS profiles_select_anon_brokers ON public.profiles;
-- 임베딩이 사라졌으므로 조인 키였던 user_id도 회수
REVOKE SELECT (user_id) ON public.broker_profiles FROM anon;

------------------------------------------------------------------------------
-- 지역 페이지 '인증 공인중개사' 섹션이 항상 비어 있던 문제
------------------------------------------------------------------------------
-- 필터가 address ILIKE '충청남도%'인데 실제 주소는 '천안 서북구 불당동…',
-- '충남 천안시 서북구…' 식이라 시도명이 축약/생략돼 한 건도 안 걸렸다.
-- 사무소 주소는 위치일 뿐이고 담당 지역은 alert_regions에 명시돼 있다
-- (같은 페이지의 '관심 등록 중개사' 카운트도 이미 이 값을 쓴다).
CREATE OR REPLACE FUNCTION public.get_public_brokers(
  p_sido text, p_sigungu text, p_only_verified boolean, p_limit integer, p_offset integer
)
RETURNS TABLE(
  id uuid, office_name text, address text, district text,
  rating numeric, review_count integer, deal_count integer,
  is_verified boolean, avg_response_hours numeric, acceptance_rate integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bp.id, bp.office_name, bp.address, bp.district,
    COALESCE(bp.rating, 0)::NUMERIC AS rating,
    COALESCE(bp.review_count, 0) AS review_count,
    COALESCE(bp.deal_count, 0) AS deal_count,
    COALESCE(bp.is_verified, false) AS is_verified,
    bp.avg_response_hours,
    bp.acceptance_rate
  FROM public.broker_profiles bp
  WHERE bp.is_owner = true
    AND COALESCE(bp.is_approved, true) = true
    AND (p_only_verified = false OR bp.is_verified = true)
    AND (
      p_sido IS NULL
      OR bp.alert_regions @> jsonb_build_array(
           CASE WHEN p_sigungu IS NULL
                THEN jsonb_build_object('sido', p_sido)
                ELSE jsonb_build_object('sido', p_sido, 'sigungu', p_sigungu)
           END)
    )
  ORDER BY bp.is_verified DESC NULLS LAST, COALESCE(bp.rating, 0) DESC, COALESCE(bp.review_count, 0) DESC
  LIMIT GREATEST(LEAST(p_limit, 100), 1)
  OFFSET GREATEST(p_offset, 0);
$$;
GRANT EXECUTE ON FUNCTION public.get_public_brokers(text, text, boolean, integer, integer) TO anon, authenticated;

------------------------------------------------------------------------------
-- 회귀 수정: anon에게서 profiles를 통째로 회수했더니 홈 큐레이션이 401
------------------------------------------------------------------------------
-- site_curations 등 여러 정책이 USING 안에서
-- EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND role='admin')를 쓰는데,
-- 정책 표현식도 조회 role의 컬럼 권한을 따르므로 평가 자체가 거부됐다.
-- anon의 profiles 행 정책은 이미 제거했으므로, 컬럼 참조 권한을 돌려줘도
-- anon이 읽을 수 있는 '행'은 0건이다(개인정보는 닫힌 채 정책 평가만 복구).
GRANT SELECT (id, role) ON public.profiles TO anon;

------------------------------------------------------------------------------
-- 로그인만 하면 전 회원 이메일·휴대폰을 긁어갈 수 있던 문제 (B안: 연락처만 가림)
------------------------------------------------------------------------------
-- profiles의 SELECT 정책이 USING(true)라 아무나 가입만 하면 전 회원의
-- 연락처를 조회할 수 있었다(실측: 일반 고객 세션으로 12명 전원 email/phone).
--
-- 이름은 여러 화면에서 정상적으로 필요하므로 행은 막지 않고(=화면 유지)
-- 연락처만 관계에 따라 가린다. Postgres는 행 정책으로 컬럼을 못 가리므로
-- (1) 관계를 확인해 NULL로 내려주는 뷰를 제공하고
-- (2) 본체 테이블에서 민감 컬럼의 SELECT 권한을 회수한다.
CREATE OR REPLACE VIEW public.profiles_visible AS
SELECT
  p.id, p.name, p.role, p.avatar_url, p.created_at,
  p.notification_preferences, p.account_status, p.suspended_until,
  p.referral_code, p.referred_by,
  CASE WHEN p.id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role = 'admin')
         OR public.can_notify_user(p.id)
       THEN p.email END AS email,
  CASE WHEN p.id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role = 'admin')
         OR public.can_notify_user(p.id)
       THEN p.phone END AS phone,
  CASE WHEN EXISTS (SELECT 1 FROM public.profiles me WHERE me.id = auth.uid() AND me.role = 'admin')
       THEN p.admin_note END AS admin_note
FROM public.profiles p;

ALTER VIEW public.profiles_visible SET (security_invoker = false);
GRANT SELECT ON public.profiles_visible TO authenticated;

-- 앱 코드가 뷰로 전환 배포된 뒤에 본체를 잠근다(순서를 지키지 않으면 라이브가 깨진다).
REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (
  id, name, role, avatar_url, created_at,
  notification_preferences, account_status, suspended_until,
  referral_code, referred_by
) ON public.profiles TO authenticated;
