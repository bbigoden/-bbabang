-- 매물목록 [보고서](추천 매물 공유 링크)를 코드에서 걷어낸 뒤(f239199) 남은 테이블·함수를 정리한다.
-- 2026-10-31 사장님 승인('DB도 지워줘').
--
-- 지우기 전에 데이터는 archive_20261030 스키마로 옮겨 둔다(20261030_drop_customer_estimate_tables.sql 과 같은 곳).
-- 함수 정의는 git 의 20260731_shared_reports.sql 에 있다.

CREATE TABLE IF NOT EXISTS archive_20261030.shared_reports AS TABLE public.shared_reports;

DROP FUNCTION IF EXISTS public.get_shared_report(uuid);
DROP TABLE IF EXISTS public.shared_reports;
