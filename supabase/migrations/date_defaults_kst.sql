-- 날짜 기본값을 전부 한국(Asia/Seoul) 기준으로 (2026-09-05)
--
-- DB 시간대가 UTC 라 CURRENT_DATE 는 한국시간 0~9시 사이에 어제를 준다.
-- 사장님은 아침 일찍 일하므로 매일 아침 나던 일이다.
--   - 업무일지를 아침에 쓰면 어제 칸에 적혔다
--   - 고객을 아침에 등록하면 접수일이 하루 당겨졌다
--
-- 견적서(estimates·estimate_invoices)는 add_estimates.sql 에서 같이 맞췄다.
-- 화면 쪽은 src/lib/date-kst.ts 를 쓴다.

ALTER TABLE broker_diary
  ALTER COLUMN date SET DEFAULT (NOW() AT TIME ZONE 'Asia/Seoul')::date;

ALTER TABLE broker_customers
  ALTER COLUMN received_date SET DEFAULT (NOW() AT TIME ZONE 'Asia/Seoul')::date;
