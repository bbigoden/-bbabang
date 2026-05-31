import { test, type Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 빠방 시각 검증 17단계
 *
 * 권한(public/user/broker/admin) × 페이지 × 뷰포트(mobile/desktop) × 테마(light[/dark]) 순회.
 * 각 변형마다:
 *   - 풀페이지 스크린샷 저장
 *   - 콘솔 에러·페이지 에러·네트워크 4xx/5xx 수집
 *   - axe-core a11y 검사 (violations 수)
 *   - 텍스트 잘림(overflow ellipsis) 감지
 *
 * 결과: test-results/visual/{screenshots,report.json}
 */

const BASE_URL = process.env.BBANG_BASE_URL ?? 'https://bbabang.vercel.app'
const FULL_MODE = process.env.FULL === '1'

const ACCOUNTS: Record<string, { email: string; password: string }> = {
  admin: { email: 'bigodennn@gmail.com', password: 'rladyd14s!' },
  broker: { email: 't2@gmail.com', password: 'rladyd14s!' },
  user: { email: 't1@gmail.com', password: 'rladyd14s!' },
}

// 권한별 정적 URL 목록 (동적 [id]는 제외 — 시드 데이터 의존)
const PAGES: Record<'public' | 'user' | 'broker' | 'admin', string[]> = {
  public: [
    '/',
    '/brokers',
    '/search',
    '/explore',
    '/explore/requests',
    '/regions',
    '/reviews',
    '/terms',
    '/privacy',
    '/support',
    '/auth/login',
    '/auth/signup',
    '/auth/reset-password',
  ],
  user: [
    '/dashboard/user',
    '/favorites',
    '/history',
    '/notifications',
    '/recommendations',
    '/saved-searches',
    '/request/new',
    '/settings',
    '/settings/account',
    '/settings/notifications',
    '/settings/appearance',
    '/profile',
  ],
  broker: [
    '/dashboard/broker',
    '/broker/properties',
    '/broker/properties/new',
    '/broker/customers',
    '/broker/chats',
    '/broker/diary',
    '/broker/team',
    '/broker/settlement',
    '/broker/trash',
    '/broker/resources',
    '/broker/settings',
    '/settings/office',
  ],
  admin: [
    '/admin',
    '/admin/users',
    '/admin/brokers',
    '/admin/properties',
    '/admin/reports',
    '/admin/errors',
    '/admin/announcements',
    '/admin/health',
    '/admin/stats',
    '/admin/shorts',
    '/admin/audit',
    '/admin/curation',
  ],
}

const VIEWPORTS: Record<'mobile' | 'desktop', { width: number; height: number }> = {
  mobile: { width: 390, height: 844 },   // iPhone 14 Pro
  desktop: { width: 1280, height: 800 },
}

const THEMES = FULL_MODE ? (['light', 'dark'] as const) : (['light'] as const)

const SCREENSHOT_DIR = path.join('test-results', 'visual', 'screenshots')
const REPORT_PATH = path.join('test-results', 'visual', 'report.json')

interface Finding {
  role: string
  path: string
  viewport: string
  theme: string
  url: string
  consoleErrors: string[]
  pageErrors: string[]
  networkFailures: { url: string; status: number }[]
  a11y: { violations: number; serious: number; ruleIds: string[] } | { error: string } | null
  textTruncation: { count: number; samples: string[] }
  loadTimeMs: number
  screenshot: string
}

const findings: Finding[] = []

function sanitizePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9가-힣]/g, '_').replace(/^_+|_+$/g, '') || 'root'
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    try {
      localStorage.setItem('theme', t)
      const root = document.documentElement
      if (t === 'dark') root.classList.add('dark')
      else root.classList.remove('dark')
    } catch {}
  }, theme)
}

async function loginAs(page: Page, role: 'user' | 'broker' | 'admin') {
  const { email, password } = ACCOUNTS[role]
  await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' })

  // 비번 보이기 토글 등이 있을 수 있으니 input[type] 대신 name/placeholder fallback
  const emailInput = page.locator('input[type="email"], input[name="email"]').first()
  await emailInput.fill(email)

  const pwInput = page.locator('input[type="password"], input[name="password"]').first()
  await pwInput.fill(password)

  await page.locator('button[type="submit"]').first().click()

  // 대시보드/admin 진입 대기. AAL2(2FA) 등 분기 있으면 timeout
  await page.waitForURL(/\/(dashboard|admin)\b/, { timeout: 20_000 }).catch(() => {
    // 로그인 실패 또는 다른 경로 — 그대로 진행 (스크린샷에 상황 잡힘)
  })
  // 추가 안정화
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
}

async function injectAxe(page: Page): Promise<boolean> {
  try {
    const axePath = require.resolve('axe-core/axe.min.js')
    await page.addScriptTag({ path: axePath })
    return true
  } catch {
    return false
  }
}

async function runAxe(page: Page): Promise<Finding['a11y']> {
  try {
    const ok = await injectAxe(page)
    if (!ok) return { error: 'axe-core not installed' }
    type AxeResult = { violations: Array<{ id: string; impact?: string }> }
    const results = await page.evaluate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async () => (await (window as any).axe.run({ resultTypes: ['violations'] })) as AxeResult,
    )
    const violations = results.violations
    return {
      violations: violations.length,
      serious: violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').length,
      ruleIds: violations.map((v) => v.id).slice(0, 10),
    }
  } catch (e) {
    return { error: String(e).slice(0, 200) }
  }
}

async function detectTextTruncation(page: Page): Promise<Finding['textTruncation']> {
  try {
    return await page.evaluate(() => {
      const samples: string[] = []
      let count = 0
      const els = document.querySelectorAll('*')
      els.forEach((el) => {
        const cs = getComputedStyle(el)
        const hasEllipsis = cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden'
        if (!hasEllipsis) return
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) {
          count++
          if (samples.length < 5) {
            const txt = (el.textContent ?? '').trim().slice(0, 60)
            if (txt) samples.push(txt)
          }
        }
      })
      return { count, samples }
    })
  } catch {
    return { count: 0, samples: [] }
  }
}

async function capturePage(
  page: Page,
  role: string,
  pagePath: string,
  viewport: keyof typeof VIEWPORTS,
  theme: 'light' | 'dark',
) {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const networkFailures: { url: string; status: number }[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
  })
  page.on('pageerror', (err) => pageErrors.push(err.message.slice(0, 300)))
  page.on('response', (resp) => {
    const s = resp.status()
    if (s >= 400) networkFailures.push({ url: resp.url(), status: s })
  })

  const t0 = Date.now()
  const fullUrl = `${BASE_URL}${pagePath}`
  await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {})
  await setTheme(page, theme)
  // 테마 변경 후 짧은 안정화
  await page.waitForTimeout(500)
  const loadTimeMs = Date.now() - t0

  // 스크린샷
  const safe = sanitizePath(pagePath)
  const fileName = `${role}__${safe}__${viewport}__${theme}.png`
  const fullPath = path.join(SCREENSHOT_DIR, fileName)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  await page.screenshot({ path: fullPath, fullPage: true }).catch(() => {})

  // 검사
  const a11y = await runAxe(page)
  const textTruncation = await detectTextTruncation(page)

  findings.push({
    role,
    path: pagePath,
    viewport,
    theme,
    url: page.url(),
    consoleErrors,
    pageErrors,
    networkFailures: networkFailures.slice(0, 20),
    a11y,
    textTruncation,
    loadTimeMs,
    screenshot: path.relative('test-results/visual', fullPath).replace(/\\/g, '/'),
  })
}

// 권한별 그룹 — 각 권한은 한 번 로그인 후 모든 페이지 순회
for (const role of ['public', 'user', 'broker', 'admin'] as const) {
  test.describe(`role: ${role}`, () => {
    test.describe.configure({ mode: 'serial' })

    const pages = PAGES[role]
    for (const pagePath of pages) {
      for (const viewport of Object.keys(VIEWPORTS) as Array<keyof typeof VIEWPORTS>) {
        for (const theme of THEMES) {
          test(`${pagePath} [${viewport}/${theme}]`, async ({ browser }) => {
            const context = await browser.newContext({
              viewport: VIEWPORTS[viewport],
              colorScheme: theme === 'dark' ? 'dark' : 'light',
            })
            const page = await context.newPage()
            try {
              if (role !== 'public') {
                await loginAs(page, role as 'user' | 'broker' | 'admin')
              }
              await capturePage(page, role, pagePath, viewport, theme)
            } finally {
              await context.close()
            }
          })
        }
      }
    }
  })
}

test.afterAll(async () => {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    fullMode: FULL_MODE,
    totalCaptures: findings.length,
    findingsWithConsoleErrors: findings.filter((f) => f.consoleErrors.length > 0).length,
    findingsWithPageErrors: findings.filter((f) => f.pageErrors.length > 0).length,
    findingsWithNetworkFailures: findings.filter((f) => f.networkFailures.length > 0).length,
    findingsWithA11yViolations: findings.filter((f) => {
      const a = f.a11y
      return a && 'violations' in a && a.violations > 0
    }).length,
    findingsWithTextTruncation: findings.filter((f) => f.textTruncation.count > 0).length,
    findings,
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2), 'utf8')
  console.log(`\n시각 검증 완료 — ${findings.length}개 캡처, 리포트: ${REPORT_PATH}`)
})
