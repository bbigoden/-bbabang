import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — 빠방 시각 검증 17단계 전용
 *
 * 실행:
 *   npm run inspect:visual           - 기본 (light 모드, 2 viewport, 핵심 페이지)
 *   FULL=1 npm run inspect:visual    - 전체 (light+dark, 2 viewport, 모든 페이지)
 *
 * 결과:
 *   test-results/visual/screenshots/   — PNG 파일 (역할/페이지/뷰포트/테마별)
 *   test-results/visual/report.json    — 콘솔 에러, a11y 위반, 텍스트 잘림 등
 *   test-results/visual-report/        — HTML 리포트 (npx playwright show-report)
 */
export default defineConfig({
  testDir: './tests/visual',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1, // 직렬 — 라이브 사이트 부담 + 로그인 세션 안전
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/visual-report', open: 'never' }],
  ],
  use: {
    baseURL: process.env.BBANG_BASE_URL ?? 'https://bbabang.vercel.app',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    ignoreHTTPSErrors: false,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
