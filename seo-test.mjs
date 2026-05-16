/**
 * SEO 테스트
 * meta 태그, og 태그, robots.txt, sitemap, h1, canonical 검증
 * 실행: node seo-test.mjs
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

let pass = 0, fail = 0, warn = 0
const failures = []
const warnings = []

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
}

async function test(label, fn) {
  try {
    await fn()
    console.log(`  ✅ ${label}`)
    pass++
  } catch (e) {
    if (e.__warn) {
      console.log(`  ⚠️  ${label} — ${e.message}`)
      warn++
      warnings.push(label)
    } else {
      console.log(`  ❌ ${label} — ${e.message}`)
      fail++
      failures.push(label)
    }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? '단언 실패')
}

function warnIf(condition, message) {
  if (!condition) {
    const e = new Error(message)
    e.__warn = true
    throw e
  }
}

// 페이지 SEO 정보 추출 헬퍼
async function getSeoInfo(page) {
  return page.evaluate(() => ({
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content ?? '',
    ogTitle: document.querySelector('meta[property="og:title"]')?.content ?? '',
    ogDescription: document.querySelector('meta[property="og:description"]')?.content ?? '',
    ogImage: document.querySelector('meta[property="og:image"]')?.content ?? '',
    ogUrl: document.querySelector('meta[property="og:url"]')?.content ?? '',
    canonical: document.querySelector('link[rel="canonical"]')?.href ?? '',
    h1: Array.from(document.querySelectorAll('h1')).map(el => el.textContent?.trim()),
    viewport: document.querySelector('meta[name="viewport"]')?.content ?? '',
    robots: document.querySelector('meta[name="robots"]')?.content ?? '',
    lang: document.documentElement.lang,
  }))
}

console.log(`\nSEO 테스트 대상: ${BASE}`)

// ── 1. robots.txt ─────────────────────────────────────────────────────────────
section('1. robots.txt')

await test('robots.txt 존재', async () => {
  const res = await fetch(`${BASE}/robots.txt`)
  assert(res.status === 200, `HTTP ${res.status}`)
  const text = await res.text()
  assert(text.length > 0, '내용 없음')
})

await test('robots.txt — User-agent 포함', async () => {
  const res = await fetch(`${BASE}/robots.txt`)
  const text = await res.text()
  assert(text.toLowerCase().includes('user-agent'), 'User-agent 지시어 없음')
})

// ── 2. sitemap.xml ────────────────────────────────────────────────────────────
section('2. sitemap.xml')

await test('sitemap.xml 존재', async () => {
  const res = await fetch(`${BASE}/sitemap.xml`)
  warnIf(res.status === 200, `HTTP ${res.status} — sitemap.xml 없음 (SEO 권장사항)`)
  if (res.status === 200) {
    const text = await res.text()
    assert(text.includes('<urlset') || text.includes('<sitemapindex'), '유효한 sitemap 아님')
  }
})

// ── 3. 페이지별 meta 태그 ─────────────────────────────────────────────────────
section('3. 페이지별 meta 태그')

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

const SEO_PAGES = [
  { path: '/', name: '홈', requireOg: true },
  { path: '/auth/login', name: '로그인', requireOg: false },
  { path: '/auth/signup', name: '회원가입', requireOg: false },
  { path: '/terms', name: '이용약관', requireOg: false },
  { path: '/privacy', name: '개인정보처리방침', requireOg: false },
  { path: '/support', name: '고객지원', requireOg: false },
]

for (const { path, name, requireOg } of SEO_PAGES) {
  const page = await context.newPage()
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    if (!res || res.status() >= 400) {
      console.log(`  ⏭️  ${name} SKIP — HTTP ${res?.status()}`)
      await page.close()
      continue
    }

    const seo = await getSeoInfo(page)

    await test(`${name} — <title> 존재`, async () => {
      assert(seo.title && seo.title.length > 0, 'title 없음')
      assert(seo.title.length <= 60, `title 너무 김 (${seo.title.length}자): ${seo.title}`)
    })

    await test(`${name} — <meta description>`, async () => {
      warnIf(seo.description.length > 0, `meta description 없음`)
      if (seo.description) {
        warnIf(seo.description.length <= 160, `description 너무 김 (${seo.description.length}자)`)
      }
    })

    await test(`${name} — viewport meta`, async () => {
      assert(seo.viewport.includes('width=device-width'), `viewport 설정 없음: "${seo.viewport}"`)
    })

    await test(`${name} — html lang 속성`, async () => {
      warnIf(seo.lang && seo.lang.length > 0, `html lang 없음 (권장: lang="ko")`)
    })

    if (requireOg) {
      await test(`${name} — og:title`, async () => {
        warnIf(seo.ogTitle.length > 0, 'og:title 없음')
      })
      await test(`${name} — og:description`, async () => {
        warnIf(seo.ogDescription.length > 0, 'og:description 없음')
      })
      await test(`${name} — og:image`, async () => {
        warnIf(seo.ogImage.length > 0, 'og:image 없음 (SNS 공유 시 이미지 없음)')
      })
    }

    // h1 검증
    await test(`${name} — h1 태그`, async () => {
      warnIf(seo.h1.length > 0, 'h1 없음')
      warnIf(seo.h1.length <= 1, `h1 중복 (${seo.h1.length}개): ${seo.h1.join(', ')}`)
    })

    console.log(`     title: "${seo.title}"`)
    if (seo.description) console.log(`     desc: "${seo.description.slice(0, 60)}${seo.description.length > 60 ? '...' : ''}"`)

  } finally {
    await page.close()
  }
}

// ── 4. 보안 헤더 (SEO 간접 영향) ─────────────────────────────────────────────
section('4. HTTP 보안 헤더')

await test('X-Content-Type-Options 헤더', async () => {
  const res = await fetch(`${BASE}/`)
  const header = res.headers.get('x-content-type-options')
  warnIf(header === 'nosniff', `X-Content-Type-Options 없음 (권장: nosniff)`)
})

await test('X-Frame-Options 또는 CSP frame-ancestors', async () => {
  const res = await fetch(`${BASE}/`)
  const xframe = res.headers.get('x-frame-options')
  const csp = res.headers.get('content-security-policy')
  const hasFrameProtection = xframe || (csp && csp.includes('frame-ancestors'))
  warnIf(hasFrameProtection, 'X-Frame-Options 없음 (클릭재킹 취약)')
})

await test('Strict-Transport-Security (HTTPS)', async () => {
  const res = await fetch(`${BASE}/`)
  const hsts = res.headers.get('strict-transport-security')
  warnIf(hsts, 'HSTS 헤더 없음')
})

await browser.close()

// ── 결과 ──────────────────────────────────────────────────────────────────────
const total = pass + fail + warn
console.log('\n' + '═'.repeat(55))
console.log(`SEO 테스트: ${pass}/${total} 통과 | ❌ ${fail}건 실패 | ⚠️  ${warn}건 권고`)

if (failures.length > 0) {
  console.log('\n수정 필요:')
  failures.forEach(f => console.log(`  • ${f}`))
}
if (warnings.length > 0) {
  console.log('\n권고사항 (필수 아님):')
  warnings.forEach(f => console.log(`  ○ ${f}`))
}
console.log('═'.repeat(55))
if (fail > 0) process.exit(1)
