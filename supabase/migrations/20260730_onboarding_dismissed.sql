-- 신규 사무소 온보딩 체크리스트(대시보드) 숨김 상태.
-- 체크리스트는 3항목(첫 매물·직원 초대·정산 기준) 전부 완료되면 자동으로 사라지지만,
-- 1인 사무소처럼 직원 초대가 영영 해당 없는 경우를 위해 수동 숨김을 기기 무관하게 저장한다.
ALTER TABLE public.broker_profiles ADD COLUMN IF NOT EXISTS onboarding_dismissed_at timestamptz;
