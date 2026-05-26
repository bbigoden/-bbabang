# 빠방 (Bbabang)

부동산 역경매 플랫폼. 고객이 원하는 매물 조건을 등록하면 인증된 중개사들이 직접 매물을 제안.

## 라이브
- 운영: https://bbabang.vercel.app

## 기술 스택
- Next.js 16.2.6 (App Router + Turbopack)
- React 19
- Supabase (Postgres 17, RLS, Auth, Storage, Realtime, Edge Functions)
- Tailwind CSS v4
- TypeScript, Vitest, Playwright, Storybook

## 환경변수
`.env.local.example` 참조. 필수 키:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (서버 전용)
- `NEXT_PUBLIC_KAKAO_MAP_KEY`, `KAKAO_REST_KEY`
- `SEUM_API_KEY`, `PUBLICDATA_API_KEY`
- `RESEND_API_KEY`, `EMAIL_FROM`, `ALERT_EMAIL_TO`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- `CRON_SECRET`

## 명령어
- `npm run dev` — 개발 서버
- `npm run build` — 운영 빌드
- `npm test` — 단위·컴포넌트 테스트
- `npm run test:all` — 전체 테스트
- `npm run storybook` — Storybook

## 배포
- git push → Vercel 자동 배포
- Vercel cron 2개: error-alert (매일 09:00), expire-requests (매일 00:00)

## 구조
- `src/app/` — Next.js App Router 페이지·API
- `src/components/` — 공용 UI 컴포넌트
- `src/lib/` — 유틸·인증·외부 API 래퍼
- `supabase/migrations/` — 로컬 DB 마이그레이션
- `.storybook/` — Storybook 설정
