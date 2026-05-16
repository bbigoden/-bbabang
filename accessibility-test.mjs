/**
 * 접근성 테스트 (Accessibility Test)
 * axe-core + Playwright로 WCAG 2.1 위반 항목 검출
 * 실행: node accessibility-test.mjs
 */

import { chromium } from 'playwright'
import axePkg from 'axe-core'
const { source: axeSource } = axePkg
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

// 테스트할 공개 페이지 목록
const PAGES = [
  { path: '/', name: '홈' },
  { path: '/auth/login', name: '로그인' },
  { path: '/auth/signup', name: '회원가입' },
  { path: '/privacy', name: '개인정보처리방침' },
  { path: '/terms', name: '이용약관' },
  { path: '/support', name: '고객지원' },
]

// axe-core 위반 심각도 필터 (critical, serious만 실패 처리)
const FAIL_IMPACT = new Set(['critical', 'serious'])

let totalPass = 0, totalFail = 0, totalSkip = 0
const allViolations = []

async function runAxe(page) {
  await page.evaluate(axeSource)
  return page.evaluate(() =>
    window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'best-practice'] },
    })
  )
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
}

console.log(`\n접근성 테스트 대상: ${BASE}`)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (compatible; a11y-test)',
  viewport: { width: 390, height: 844 },
})

section('페이지별 접근성 검사')

for (const { path, name } of PAGES) {
  const url = `${BASE}${path}`
  const page = await context.newPage()

  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 })

    if (!res || res.status() >= 400) {
      console.log(`  ⏭️  ${name} (${path}) — HTTP ${res?.status() ?? '응답없음'} SKIP`)
      totalSkip++
      await page.close()
      continue
    }

    // 리다이렉트된 경우 (로그인 필요 페이지 등)
    const finalUrl = page.url()
    if (finalUrl.includes('/auth/login') && !path.includes('/auth/login')) {
      console.log(`  ⏭️  ${name} (${path}) — 로그인 필요 SKIP`)
      totalSkip++
      await page.close()
      continue
    }

    const results = await runAxe(page)
    const violations = results.violations
    const criticalViolations = violations.filter(v => FAIL_IMPACT.has(v.impact))
    const minorViolations = violations.filter(v => !FAIL_IMPACT.has(v.impact))

    if (criticalViolations.length === 0) {
      const minorNote = minorViolations.length > 0 ? ` (경미 ${minorViolations.length}건)` : ''
      console.log(`  ✅ ${name}${minorNote}`)
      totalPass++
    } else {
      console.log(`  ❌ ${name} — critical/serious ${criticalViolations.length}건`)
      for (const v of criticalViolations) {
        console.log(`     • [${v.impact}] ${v.id}: ${v.description}`)
        console.log(`       영향 요소: ${v.nodes.slice(0, 2).map(n => n.html).join(' | ')}`)
        allViolations.push({ page: name, ...v })
      }
      totalFail++
    }

    if (minorViolations.length > 0) {
      console.log(`     ⚠️  경미한 위반 ${minorViolations.length}건:`)
      for (const v of minorViolations.slice(0, 3)) {
        console.log(`        - [${v.impact ?? 'moderate'}] ${v.id}: ${v.description}`)
      }
    }
  } catch (e) {
    console.log(`  ❌ ${name} — ${e.message}`)
    totalFail++
  } finally {
    await page.close()
  }
}

await browser.close()

section('결과 요약')
const total = totalPass + totalFail + totalSkip
console.log(`접근성 테스트: ${totalPass}/${total} 통과 | ❌ ${totalFail}건 실패 | ⏭️ ${totalSkip}건 스킵`)

if (allViolations.length > 0) {
  console.log('\n수정 필요 항목 (critical/serious):')
  const grouped = {}
  for (const v of allViolations) {
    if (!grouped[v.id]) grouped[v.id] = { desc: v.description, pages: [] }
    grouped[v.id].pages.push(v.page)
  }
  for (const [id, info] of Object.entries(grouped)) {
    console.log(`  • ${id}: ${info.desc}`)
    console.log(`    발생 페이지: ${[...new Set(info.pages)].join(', ')}`)
  }
}

console.log('═'.repeat(55))
if (totalFail > 0) process.exit(1)
