-- 호출 제한 함수는 서버 전용 키(service_role)로만 부른다.
-- 버킷 이름·횟수·창을 인자로 받으므로 로그인 사용자·비로그인에게 열어 두면 남의 버킷
-- (`ip:<남의 IP>:consent-signup` 등)을 채워 그 사람을 막을 수 있었다.
-- 앱(src/lib/rate-limit.ts)을 service_role 로 바꿔 배포한 뒤 적용했다(2026-10-15).
revoke execute on function public.rate_limit_check(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_check(text, integer, integer) to service_role;
