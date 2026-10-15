-- 정산비(settlement_rate)·직원 기본 정산비(default_settlement_rate)를 DB 에서도 0~1 로 묶는다.
--
-- 왜: 0~1 클램프가 정산 화면 입력칸(RateCell)에만 있었다. 직원은 RLS 상 자기 정산 행을
-- UPDATE 할 수 있어 supabase-js 로 settlement_rate = 9.999 (numeric(4,3) 최대)를 바로 넣을 수 있고,
-- 그러면 담당자수수료가 공급가의 약 10배로 잡혀 대표 요약·통계·CSV 가 통째로 틀어진다.
-- 계산(src/lib/settlement.ts clampRate)에서도 자르지만, 저장값 자체를 막아야 다른 화면·내보내기도 안전하다.
--
-- 적용 전 확인(2026-10-15, 읽기 전용): 범위 밖 settlements 0건, broker_profiles 0건, settlement_rate NULL 0건.
-- 분배 행의 정산비(1 − partner_split)도 0~1 이다(partner_split 에는 이미 0~1 CHECK 가 있다).
-- 적용 시점에 범위 밖 행이 생겨 있으면 ADD CONSTRAINT 가 실패한다 — 그 행을 먼저 확인할 것.

ALTER TABLE public.settlements
  DROP CONSTRAINT IF EXISTS settlements_rate_range;
ALTER TABLE public.settlements
  ADD CONSTRAINT settlements_rate_range
  CHECK (settlement_rate >= 0 AND settlement_rate <= 1);

ALTER TABLE public.broker_profiles
  DROP CONSTRAINT IF EXISTS broker_profiles_default_settlement_rate_range;
ALTER TABLE public.broker_profiles
  ADD CONSTRAINT broker_profiles_default_settlement_rate_range
  CHECK (default_settlement_rate IS NULL OR (default_settlement_rate >= 0 AND default_settlement_rate <= 1));
