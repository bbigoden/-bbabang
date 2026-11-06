// 폰 속도 점검 — 운영(또는 지정 주소)을 중급 폰처럼 열어 아래 메뉴마다 화면이 다 뜨는 시간을 잰다.
// 2026-11-05 사무실·일지가 폰에서 3~4초 걸리던 것을 이걸로 찾아 1초 안팎으로 줄였다. 기능을 붙이거나
// 화면을 고친 뒤 한 번씩 돌려, 1초를 넘는 화면이 생기면 바로 안다.
//
//   사용: npm run perf:phone                     (운영 busojang.vercel.app)
//         npm run perf:phone -- http://localhost:3000
//
// - 로그인은 npm run login:save 로 저장한 사장님 세션(.playwright-auth/owner.json)을 쓴다. 비밀번호는 넣지 않는다.
// - 보기만 한다: 메뉴를 누르기만 하고, DB·저장소에 쓰는 요청과 알림 발송은 전부 가짜로 답해 막는다.
// - 조건: Pixel 7 화면, CPU 4배 느리게, LTE(지연 60ms·12Mbps). 같은 메뉴를 두 바퀴 — 처음/다시 연 때.
// - '다 뜸' = 메뉴를 누른 뒤 마지막 데이터(Supabase) 응답이 끝난 때. '멈춤' = 화면을 그리느라 폰이 멈춘 시간 합계.
// - 기준(BUDGET_MS)을 넘는 화면이 있으면 끝에 표시하고 종료 코드 1.
import fs from 'node:fs'
import path from 'node:path'
import { chromium, devices } from 'playwright'

const BASE = (process.argv[2] ?? 'https://busojang.vercel.app').replace(/\/$/, '')
const STATE = path.join('.playwright-auth', 'owner.json')
const BUDGET_MS = 1500   // 처음 열 때 이보다 오래 걸리면 걸린다
const SETTLE_MS = 4000   // 메뉴를 누르고 이만큼 지켜본다

if (!fs.existsSync(STATE)) {
  console.error('저장된 로그인이 없습니다. 먼저 npm run login:save 로 로그인해 주세요.')
  process.exit(2)
}
const state = JSON.parse(fs.readFileSync(STATE, 'utf8'))
if (BASE.includes('localhost')) {
  // 운영에서 받은 로그인 쿠키를 로컬 주소에도 쓴다
  state.cookies = state.cookies.filter(c => c.name.startsWith('sb-')).map(c => ({ ...c, domain: 'localhost', secure: false, sameSite: 'Lax' }))
  state.origins = []
}


const browser = await chromium.launch()

// 폰 한 대 — 새 창(캐시·로그인 상태 빈 채)을 열고 느린 폰·LTE 조건과 쓰기 막기를 건다
async function openPhone() {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], storageState: state })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 60, downloadThroughput: 12e6 / 8, uploadThroughput: 4e6 / 8 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

  // 쓰기 막기 — 읽기(GET·HEAD)와 읽기 전용 RPC·사진 서명만 통과
  const READ_RPC = /\/rpc\/(office_|get_|search_|diary_customers_for_date|my_|can_|is_)/
  await page.route(/supabase\.co\/(rest|storage)\//, route => {
    const r = route.request()
    const read = r.method() === 'GET' || r.method() === 'HEAD'
      || (r.method() === 'POST' && (READ_RPC.test(r.url()) || r.url().includes('/object/sign/')))
    return read ? route.continue() : route.fulfill({ status: 201, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/api/messenger/notify', r => r.fulfill({ status: 200, body: '{}' }))

  const ph = { ctx, page, reqs: [] }
  page.on('request', r => { if (r.url().includes('supabase.co/')) ph.reqs.push({ r, t: Date.now(), end: 0 }) })
  const done = r => { const x = ph.reqs.find(i => i.r === r); if (x) x.end = Date.now() }
  page.on('requestfinished', done)
  page.on('requestfailed', done)

  await page.goto(`${BASE}/dashboard/broker`, { waitUntil: 'load', timeout: 90000 })
  if (/\/auth\//.test(page.url())) {
    console.error('저장된 로그인이 끝났습니다. npm run login:save 로 다시 로그인해 주세요.')
    await browser.close(); process.exit(2)
  }
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => {
    window.__lt = []
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration }) }).observe({ type: 'longtask', buffered: true })
  })
  return ph
}

// 화면을 가장 늦게 끝낸 요청 — 걸렸을 때 무엇을 기다렸는지 보인다
function slowest(data, t0) {
  const x = data.reduce((m, x) => ((x.end || Date.now()) > ((m && m.end) || 0) ? x : m), null)
  if (!x) return ''
  const u = decodeURIComponent(x.r.url().replace(/^https:\/\/[^/]+\/(rest\/v1|storage\/v1)\//, '')).split(/[?&]select=/)[0].slice(0, 60)
  return `${u} (${x.t - t0}ms 에 시작, ${(x.end || Date.now()) - x.t}ms 걸림)`
}

// 화면 하나 재기 — 아래 메뉴에 있으면 눌러서, 없으면 주소로 바로 연다(새로고침 기준이라 조금 불리하다)
async function measure(ph, href, viaMenu) {
  const { page } = ph
  ph.reqs = []
  const t0 = Date.now()
  let p0 = 0
  if (viaMenu) {
    p0 = await page.evaluate(() => { window.__lt = []; return performance.now() })
    await page.click(`nav a[href="${href}"] >> visible=true`)
  } else {
    await page.goto(`${BASE}${href}`, { waitUntil: 'load', timeout: 90000 })
    await page.evaluate(() => {
      window.__lt = []
      new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration }) }).observe({ type: 'longtask', buffered: true })
    })
  }
  await page.waitForTimeout(SETTLE_MS)
  // 메신저 목록이 뒤에서 방을 미리 받아 두는 것(office_chat_room_open)은 화면을 기다리게 하지 않으니 빼고 센다
  const data = ph.reqs.filter(x => /supabase\.co\/(rest|storage)/.test(x.r.url()) && !x.r.url().includes('/rpc/office_chat_room_open'))
  const loaded = data.length ? Math.max(...data.map(x => (x.end || Date.now()) - t0)) : (viaMenu ? 0 : Date.now() - t0 - SETTLE_MS)
  const busy = await page.evaluate(p0 => Math.round(window.__lt.filter(x => x.s >= p0).reduce((a, x) => a + x.d, 0)), p0)
  return { loaded, n: data.length, busy, slow: slowest(data, t0) }
}

const ph = await openPhone()
const menus = await ph.page.$$eval('nav a[href^="/"]', as => [...new Set(as.filter(a => a.offsetParent).map(a => a.getAttribute('href')))])
// 폰 아래 메뉴에 없는 화면(더보기·버튼으로 들어가는 곳)
const EXTRA = ['/broker/lists', '/broker/events', '/broker/settlement', '/broker/resources', '/broker/team', '/broker/trash', '/broker/naver', '/broker/ads']
  .filter(h => !menus.includes(h))
const screens = [...menus.map(h => [h, true]), ...EXTRA.map(h => [h, false])]

console.log(`\n폰 속도 점검 — ${BASE} (Pixel 7 · CPU 4배 느리게 · LTE)\n`)
const result = {}
for (const round of [0, 1]) {
  for (const [href, viaMenu] of screens) (result[href] ??= [])[round] = await measure(ph, href, viaMenu)
}
await ph.ctx.close()

// 한 번 재서 넘은 화면은 새 창에서 두 번 더 처음 열어 가운데 값으로 본다.
// 같은 화면이 재기마다 0.9~4초로 흔들렸다(11-06, PC·서버가 바쁜 순간) — 한 번 값으로 고치러 들지 않게.
const RECHECK = 2
const med = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
for (const [href, viaMenu] of screens) {
  const a = result[href][0]
  a.tries = [a.loaded]
  if (a.loaded <= BUDGET_MS) continue
  for (let i = 0; i < RECHECK; i++) {
    const p = await openPhone()
    const m = await measure(p, href, viaMenu)
    await p.ctx.close()
    a.tries.push(m.loaded)
    if (m.loaded >= a.loaded) a.slow = m.slow
  }
}

console.log('화면                  | 처음 다 뜸 | 다시 다 뜸 | 요청 | 멈춤(처음)')
const over = []
for (const [href] of screens) {
  const [a, b] = result[href]
  const first = med(a.tries)
  const flag = first > BUDGET_MS ? '  ← 느림' : ''
  if (flag) over.push(href)
  console.log(`${href.padEnd(21)} | ${String(first).padStart(7)}ms | ${String(b.loaded).padStart(7)}ms | ${String(a.n).padStart(4)} | ${String(a.busy).padStart(7)}ms${flag}`)
  if (a.tries.length > 1) console.log(`${' '.repeat(23)}└ 세 번 잼: ${a.tries.join(' · ')}ms${flag ? ` — 가장 늦은 요청: ${a.slow}` : ' — 한 번만 늦었다(흔들림)'}`)
}
await browser.close()
if (over.length) {
  console.log(`\n${BUDGET_MS / 1000}초를 넘는 화면(세 번 잰 가운데 값): ${over.join(', ')}`)
  process.exit(1)
}
console.log(`\n모든 화면이 ${BUDGET_MS / 1000}초 안에 떴습니다.`)
