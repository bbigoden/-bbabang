-- 자동 인증(배지) 도입에 따른 is_verified 보호.
--
-- 배경: broker_profiles UPDATE RLS는 "본인 행"을 허용하는데 컬럼 제한이 없어,
-- 중개사가 REST로 자기 is_verified=true를 직접 켤 수 있었다 (지금까지는 배지가
-- 수동 부여라 실익이 없었지만, 자동 승인 도입 후엔 실제 구멍이 됨).
--
-- 정책: is_verified 변경은 관리자(profiles.role='admin') 또는 service_role
-- (/api/brokers/auto-verify 서버 라우트)만 가능. 그 외 시도는 에러 대신
-- 조용히 원값 유지 — 설정 화면들이 행 전체를 저장하는 패턴이라 에러를 내면
-- 무고한 저장까지 깨진다.
CREATE OR REPLACE FUNCTION public.guard_broker_is_verified()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.is_verified IS DISTINCT FROM OLD.is_verified
     AND auth.role() = 'authenticated'
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  THEN
    NEW.is_verified := OLD.is_verified;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_broker_is_verified ON public.broker_profiles;
CREATE TRIGGER trg_guard_broker_is_verified
  BEFORE UPDATE ON public.broker_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_broker_is_verified();
