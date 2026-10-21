// 점검용 로그인 저장 — 창이 뜨면 사장님이 직접 로그인한다. 비밀번호는 어디에도 적히지 않는다.
// 로그인이 끝나면 세션(쿠키)만 .playwright-auth/owner.json 에 저장하고 창을 닫는다.
// 점검 브라우저(페르소나)들이 이 파일로 같은 계정으로 들어간다.
//
//   사용: npm run login:save            (운영 bbabang.vercel.app)
//         npm run login:save -- http://localhost:3100   (다른 주소)
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const base = (process.argv[2] ?? 'https://bbabang.vercel.app').replace(/\/$/, '')
const OUT = path.join('.playwright-auth', 'owner.json')
fs.mkdirSync('.playwright-auth', { recursive: true })

const browser = await chromium.launch({ headless: false })
const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: 'ko-KR' })
const page = await ctx.newPage()
await page.goto(`${base}/auth/login?redirect=%2Fbroker%2Fproperties`, { waitUntil: 'domcontentloaded' })
console.log('\n  열린 창에서 로그인해 주세요. 매물목록이 뜨면 자동으로 저장하고 닫습니다. (10분 안에)\n')

try {
  await page.waitForURL(u => !/\/auth\//.test(u.toString()), { timeout: 10 * 60 * 1000 })
  // 세션 쿠키가 실제로 박힐 때까지 잠깐
  await page.waitForFunction(() => document.cookie.includes('-auth-token'), null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await ctx.storageState({ path: OUT })
  const who = await page.evaluate(() => document.body.innerText.match(/[가-힣]{2,4}\s*(대표|님)/)?.[0] ?? '').catch(() => '')
  console.log(`  저장했습니다 → ${OUT}${who ? ` (${who})` : ''}. 이 파일은 비밀번호가 아니라 로그인 세션이며, 1시간쯤 지나면 다시 저장해야 할 수 있습니다.\n`)
} catch {
  console.log('  10분 안에 로그인이 끝나지 않아 저장하지 않았습니다. 다시 실행해 주세요.\n')
  process.exitCode = 1
} finally {
  await browser.close()
}
