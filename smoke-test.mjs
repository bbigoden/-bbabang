/**
 * 스모크 테스트 (Smoke Test)
 * 배포 직후 핵심 기능이 살아있는지 30초 안에 확인
 * 실행: node smoke-test.mjs
 */

import { chromium } from 'playwright'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const envPaths = [join(__dir, '.env.local'), join(__dir, '..', '..', '..', '.env.local')]
try {
  const envFile = envPaths.find(p => { try { readFileSync(p); return true } catch { return false } })
  const env = readFileSync(envFile ?? envPaths[0], 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* env 없으면 기존 환경변수 사용 */ }

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://bbabang.vercel.app'

let pass = 0, fail = 0
const failures = []

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
}

async function test(label, fn) {
  try {
    await fn()
    console.log(`  ✅ ${label}`)
    pass++
  } catch (e) {
    console.log(`  ❌ ${label} — ${e.message}`)
    fail++
    failures.push(label)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? '단언 실패')
}

console.log(`\n스모크 테스트 대상: ${BASE}`)
const start = Date.now()

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

// ── 1. HTTP 상태 확인 ────────────────────────────────────────────────────────
section('1. HTTP 상태')

const publicPages = [
  ['홈페이지', '/'],
  ['로그인', '/auth/login'],
  ['회원가입', '/auth/signup'],
  ['이용약관', '/terms'],
  ['개인정보처리방침', '/privacy'],
  ['고객지원', '/support'],
]

for (const [name, path] of publicPages) {
  await test(`${name} (${path}) → 200`, async () => {
    const res = await fetch(`${BASE}${path}`)
    assert(res.status === 200, `HTTP ${res.status}`)
  })
}

// ── 2. 인증 필요 페이지 → 로그인으로 리다이렉트 ──────────────────────────────
section('2. 인증 보호 — 비로그인 시 리다이렉트')

const protectedPages = [
  ['대시보드(유저)', '/dashboard/user'],
  ['프로필', '/profile'],
  ['중개사 대시보드', '/dashboard/broker'],
  ['중개사 매물목록', '/broker/properties'],
]

for (const [name, path] of protectedPages) {
  await test(`${name} → /auth/login 리다이렉트`, async () => {
    const page = await context.newPage()
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
      const url = page.url()
      assert(url.includes('/auth/login') || url === `${BASE}/`, `리다이렉트 안 됨: ${url}`)
    } finally {
      await page.close()
    }
  })
}

// ── 3. 핵심 UI 요소 존재 확인 ─────────────────────────────────────────────────
section('3. 핵심 UI 요소')

await test('홈 — 부소장 로고', async () => {
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    const logo = await page.locator('text=부소장').first().isVisible().catch(() => false)
    assert(logo, '부소장 로고 없음')
  } finally { await page.close() }
})

await test('홈 — 매물 요청하기 버튼', async () => {
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    const btn = await page.locator('text=매물 요청').first().isVisible().catch(() => false)
    assert(btn, '매물 요청 버튼 없음')
  } finally { await page.close() }
})

await test('로그인 — 이메일/비밀번호 입력창', async () => {
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    const email = await page.locator('input[type="email"]').isVisible().catch(() => false)
    const pw = await page.locator('input[type="password"]').isVisible().catch(() => false)
    assert(email && pw, `입력창 없음 (email=${email}, pw=${pw})`)
  } finally { await page.close() }
})

await test('회원가입 — 이름/이메일/비밀번호 입력창', async () => {
  const page = await context.newPage()
  try {
    await page.goto(`${BASE}/auth/signup`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    const email = await page.locator('input[type="email"]').isVisible().catch(() => false)
    assert(email, '회원가입 입력창 없음')
  } finally { await page.close() }
})

// ── 4. 없는 페이지 → 404 ──────────────────────────────────────────────────────
section('4. 에러 처리')

await test('없는 경로 → 404', async () => {
  const res = await fetch(`${BASE}/this-page-does-not-exist-12345`)
  assert(res.status === 404, `HTTP ${res.status}`)
})

await test('없는 요청 ID → 404', async () => {
  const res = await fetch(`${BASE}/request/00000000-0000-0000-0000-000000000000`)
  assert(res.status === 404, `HTTP ${res.status}`)
})

// ── 5. API 라우트 ─────────────────────────────────────────────────────────────
section('5. API 라우트')

await test('auto-fill 비인증 → 401', async () => {
  const res = await fetch(`${BASE}/api/properties/auto-fill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: '서울' }),
  })
  assert(res.status === 401, `예상 401, 실제 ${res.status}`)
})

await browser.close()

const elapsed = ((Date.now() - start) / 1000).toFixed(1)
const total = pass + fail
console.log('\n' + '═'.repeat(55))
console.log(`스모크 테스트: ${pass}/${total} 통과 | ❌ ${fail}건 실패 | 소요 ${elapsed}초`)

if (failures.length > 0) {
  console.log('\n실패 목록:')
  failures.forEach(f => console.log(`  • ${f}`))
  process.exit(1)
}
console.log('═'.repeat(55))
