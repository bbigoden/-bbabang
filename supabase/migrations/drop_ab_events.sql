-- 2026-07-26 점검 후속: A/B 이벤트 기록부 제거
-- trackAb() 유틸과 /api/ab/track 라우트가 코드에서 삭제되어
-- ab_events 테이블(미사용 인덱스 2개 포함)은 더 이상 쓰는 곳이 없음.
-- CASCADE로 인덱스·RLS 정책 함께 제거됨.
-- 원격 적용 완료: 20260725231842_drop_ab_events (MCP apply_migration)

drop table if exists public.ab_events cascade;
