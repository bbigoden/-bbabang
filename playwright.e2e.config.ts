import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright config — 핵심 업무 흐름 E2E 전용
 *
 * 실행:
 *   npm run inspect:e2e
 *   (= npx playwright test --config=playwright.e2e.config.ts --reporter=list)
 *
 * 라이브 사이트(https://bbabang.vercel.app)에서 실제 계정으로
 * 요청 등록 → 제안 → 확인 → 채팅 왕복을 수행하고, 만든 데이터는
 * afterAll에서 전부 삭제한다. (tests/e2e/core-flow.spec.ts 참고)
 *
 * 시각 검증 러너(playwright.config.ts / tests/visual)와는 별도 config —
 * inspect:visual 쪽 실행 범위에 영향을 주지 않기 위함.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // 직렬 — 시나리오가 상태를 공유(요청 id → 제안 id → 채팅)
  retries: 0,
  reporter: [['list']],
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
