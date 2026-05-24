#!/usr/bin/env node
/**
 * 모바일 터치 타겟 44×44px 자동 측정 (WCAG 2.5.5).
 * 운영 사이트의 핵심 페이지를 모바일 viewport로 열어 클릭 가능한 요소의 크기 측정.
 */
import { chromium } from 'playwright'

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://bbabang.vercel.app'

const PAGES = [
  { path: '/', name: '홈' },
  { path: '/auth/login', name: '로그인' },
  { path: '/auth/signup', name: '회원가입' },
  { path: '/brokers', name: '중개사 목록' },
  { path: '/explore/requests', name: '요청 둘러보기' },
  { path: '/support', name: '고객지원' },
]

const MIN_PX = 44 // WCAG AA target size minimum

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 14
})

let totalChecked = 0, totalSmall = 0
const report = []

for (const { path, name } of PAGES) {
  const page = await context.newPage()
  try {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 15000 })
    if (!res || res.status() >= 400) {
      console.log(`  ⏭️  ${name} (${path}) — HTTP ${res?.status() ?? '응답없음'} SKIP`)
      await page.close(); continue
    }
    await page.waitForTimeout(800) // hydration

    const small = await page.evaluate((MIN_PX) => {
      const clickable = Array.from(document.querySelectorAll(
        'a, button, [role="button"], input[type="checkbox"], input[type="radio"], input[type="submit"], input[type="button"], select'
      ))
      const issues = []
      for (const el of clickable) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue // hidden
        if (r.width < MIN_PX || r.height < MIN_PX) {
          issues.push({
            tag: el.tagName,
            text: (el.textContent ?? '').trim().slice(0, 40),
            w: Math.round(r.width),
            h: Math.round(r.height),
            class: (el.className ?? '').slice(0, 80),
          })
        }
      }
      return { total: clickable.length, issues }
    }, MIN_PX)

    totalChecked += small.total
    totalSmall += small.issues.length

    const passRate = small.total > 0 ? ((1 - small.issues.length / small.total) * 100).toFixed(0) : '100'
    const icon = small.issues.length === 0 ? '✅' : (small.issues.length <= 3 ? '⚠️' : '❌')
    console.log(`  ${icon} ${name} — ${small.total - small.issues.length}/${small.total} (${passRate}%) ≥${MIN_PX}px`)
    if (small.issues.length > 0) {
      report.push({ page: name, issues: small.issues.slice(0, 5) })
      for (const iss of small.issues.slice(0, 3)) {
        console.log(`     • ${iss.tag} ${iss.w}×${iss.h}px "${iss.text}"`)
      }
    }
  } catch (e) {
    console.log(`  ❌ ${name} — ${e.message}`)
  } finally {
    await page.close()
  }
}

await browser.close()

const overallPass = totalChecked > 0 ? ((1 - totalSmall / totalChecked) * 100).toFixed(1) : '100'
console.log(`\n터치 타겟 44px: ${totalChecked - totalSmall}/${totalChecked} 통과 (${overallPass}%) · ❌ ${totalSmall}건 미달`)
