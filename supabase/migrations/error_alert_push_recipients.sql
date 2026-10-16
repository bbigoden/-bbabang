-- 에러 자동 알림(/api/cron/error-alert)을 메일에서 웹 푸시로 바꾸면서 받는 사람을 정한다.
--
-- 메일(Resend)은 RESEND_API_KEY 가 끝내 등록되지 않아 2026-06 부터 쌓인 error_logs 251건 중
-- 한 건도 나가지 않았다(alerted_at 전부 NULL). 이제 크론은 아래 두 집합의 합에게 푸시를 보낸다.
--   ① profiles.role = 'admin' 전원
--   ② internal_config 'error_alert_user_ids' 에 쉼표로 적은 사용자 id
-- 관리자 계정(3110f77e…)은 폰에 푸시 구독이 하나도 없어 ①만으로는 아무도 못 받는다.
-- 그래서 실제로 폰에 구독이 4대 있는 대표 계정(041861af…)을 ②에 넣는다.
--
-- internal_config 는 RLS 정책이 없어 service_role(크론)·definer 함수만 읽고 쓴다 —
-- 앱 사용자가 수신자를 바꾸거나 엿볼 수 없다.
-- 사람을 더하려면 value 를 'id1,id2' 처럼 쉼표로 이어 쓴다(공백 무시, uuid 아닌 값은 건너뜀).
insert into public.internal_config (key, value)
values ('error_alert_user_ids', '041861af-1f79-4723-a098-aa8035e7749a')
on conflict (key) do update set value = excluded.value;
