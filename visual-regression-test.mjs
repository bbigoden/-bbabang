/**
 * 시각적 회귀 테스트 (Visual Regression Test)
 * 페이지 스크린샷을 기준 이미지와 픽셀 단위로 비교
 * 실행: node visual-regression-test.mjs
 * 기준 갱신: node visual-regression-test.mjs --update
 */

import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

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
const UPDATE = process.argv.includes('--update')
const THRESHOLD = 0.05        // 픽셀당 허용 색상 차이 (0~1)
const DIFF_PERCENT_LIMIT = 0.5 // 전체 픽셀 중 허용 차이 비율 (%)

const BASELINE_DIR = join(__dir, 'screenshots', 'baseline')
const ACTUAL_DIR = join(__dir, 'screenshots', 'actual')
const DIFF_DIR = join(__dir, 'screenshots', 'diff')

;[BASELINE_DIR, ACTUAL_DIR, DIFF_DIR].forEach(d => mkdirSync(d, { recursive: true }))

let pass = 0, fail = 0, skip = 0
const failures = []

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
}

async function captureAndCompare(page, name, path) {
  const url = `${BASE}${path}`
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    if (!res || res.status() >= 400) {
      console.log(`  ⏭️  ${name} SKIP — HTTP ${res?.status()}`)
      skip++
      return
    }
    // 레이아웃 안정화 대기
    await page.waitForTimeout(800)

    const actualPath = join(ACTUAL_DIR, `${name}.png`)
    await page.screenshot({ path: actualPath, fullPage: false })

    const baselinePath = join(BASELINE_DIR, `${name}.png`)

    if (UPDATE) {
      writeFileSync(baselinePath, readFileSync(actualPath))
      console.log(`  📸 ${name} — 기준 스크린샷 갱신`)
      pass++
      return
    }

    if (!existsSync(baselinePath)) {
      // 기준 없으면 최초 실행으로 간주하고 저장
      writeFileSync(baselinePath, readFileSync(actualPath))
      console.log(`  📸 ${name} — 기준 스크린샷 최초 저장 (다음 실행부터 비교)`)
      skip++
      return
    }

    const baselinePng = PNG.sync.read(readFileSync(baselinePath))
    const actualPng = PNG.sync.read(readFileSync(actualPath))

    // 크기가 다르면 기준 갱신 필요
    if (baselinePng.width !== actualPng.width || baselinePng.height !== actualPng.height) {
      console.log(`  ⚠️  ${name} — 크기 불일치 (기준 ${baselinePng.width}×${baselinePng.height} vs 실제 ${actualPng.width}×${actualPng.height}) — --update 로 갱신하세요`)
      fail++
      failures.push(`${name} (크기 불일치)`)
      return
    }

    const { width, height } = baselinePng
    const diffPng = new PNG({ width, height })

    const diffPixels = pixelmatch(
      baselinePng.data, actualPng.data, diffPng.data,
      width, height,
      { threshold: THRESHOLD, includeAA: false }
    )

    const totalPixels = width * height
    const diffPercent = (diffPixels / totalPixels) * 100

    const diffPath = join(DIFF_DIR, `${name}.png`)
    writeFileSync(diffPath, PNG.sync.write(diffPng))

    if (diffPercent <= DIFF_PERCENT_LIMIT) {
      console.log(`  ✅ ${name} — 차이 ${diffPercent.toFixed(3)}% (${diffPixels}px)`)
      pass++
    } else {
      console.log(`  ❌ ${name} — 차이 ${diffPercent.toFixed(3)}% (${diffPixels}px, 허용 ${DIFF_PERCENT_LIMIT}%) → diff: ${diffPath}`)
      fail++
      failures.push(`${name} (차이 ${diffPercent.toFixed(2)}%)`)
    }
  } catch (e) {
    console.log(`  ❌ ${name} — ${e.message}`)
    fail++
    failures.push(name)
  }
}

console.log(`\n시각적 회귀 테스트 대상: ${BASE}`)
if (UPDATE) console.log('모드: 기준 스크린샷 갱신 (--update)')

const browser = await chromium.launch({ headless: true })

// ── 데스크톱 뷰 ────────────────────────────────────────────────────────────────
section('1. 데스크톱 (1280×800)')
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const pages = [
    ['home-desktop', '/'],
    ['login-desktop', '/auth/login'],
    ['signup-desktop', '/auth/signup'],
    ['terms-desktop', '/terms'],
    ['privacy-desktop', '/privacy'],
    ['support-desktop', '/support'],
  ]
  for (const [name, path] of pages) {
    await captureAndCompare(page, name, path)
  }
  await ctx.close()
}

// ── 모바일 뷰 ─────────────────────────────────────────────────────────────────
section('2. 모바일 (390×844 — iPhone 14)')
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const page = await ctx.newPage()
  const pages = [
    ['home-mobile', '/'],
    ['login-mobile', '/auth/login'],
  ]
  for (const [name, path] of pages) {
    await captureAndCompare(page, name, path)
  }
  await ctx.close()
}

await browser.close()

// ── 결과 ──────────────────────────────────────────────────────────────────────
const total = pass + fail + skip
console.log('\n' + '═'.repeat(55))
console.log(`시각적 회귀 테스트: ${pass}/${total} 통과 | ❌ ${fail}건 실패 | ⏭️  ${skip}건 스킵`)
if (failures.length > 0) {
  console.log('\n실패 목록:')
  failures.forEach(f => console.log(`  • ${f}`))
  console.log(`\n💡 의도한 변경이라면: node visual-regression-test.mjs --update`)
}
console.log('═'.repeat(55))
if (fail > 0) process.exit(1)
