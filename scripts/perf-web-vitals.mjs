// 점검 22단계 — 공개 페이지 Web Vitals 실측 (TTFB / FCP / LCP / CLS)
// 사용법: npm run perf:web
// 판정: LCP<2.5s 좋음 / <4s 개선 필요 / 이상 나쁨 (Google 기준). CLS<0.1 좋음.
// 로그인 페이지들은 시각 검증 report.json의 loadTimeMs 추세로 대신 본다.
import { chromium } from '@playwright/test'

const BASE = process.env.PERF_BASE_URL || 'https://bbabang.vercel.app'
const PAGES = ['/', '/explore/requests', '/auth/login', '/regions', '/search']
const RUNS = 2 // 콜드/웜 각 1회 — 중앙값 대신 두 값 모두 표기

async function measure(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(3500) // LCP·CLS 안정화 대기
  return page.evaluate(() => new Promise(resolve => {
    const nav = performance.getEntriesByType('navigation')[0]
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    let lcp = 0, cls = 0
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime)
    }).observe({ type: 'largest-contentful-paint', buffered: true })
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value
    }).observe({ type: 'layout-shift', buffered: true })
    setTimeout(() => resolve({
      ttfb: Math.round(nav.responseStart),
      fcp: Math.round(fcp?.startTime ?? 0),
      lcp: Math.round(lcp),
      cls: Math.round(cls * 1000) / 1000,
    }), 300)
  }))
}

const grade = (lcp) => lcp < 2500 ? '좋음' : lcp < 4000 ? '개선' : '나쁨'

const browser = await chromium.launch()
console.log(`Web Vitals 실측 — ${BASE} (모바일 뷰포트 390x844, 런 ${RUNS}회)`)
console.log('페이지 | 런 | TTFB | FCP | LCP | CLS | 판정')

for (const path of PAGES) {
  for (let run = 1; run <= RUNS; run++) {
    // 콜드 측정을 위해 런마다 새 컨텍스트 (캐시·쿠키 없음)
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await ctx.newPage()
    try {
      const m = await measure(page, BASE + path)
      console.log(`${path} | ${run} | ${m.ttfb}ms | ${m.fcp}ms | ${m.lcp}ms | ${m.cls} | ${grade(m.lcp)}`)
    } catch (e) {
      console.log(`${path} | ${run} | 실패: ${e.message.slice(0, 80)}`)
    }
    await ctx.close()
  }
}
await browser.close()
