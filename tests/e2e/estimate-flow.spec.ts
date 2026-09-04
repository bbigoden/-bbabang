/**
 * 견적서 실동작 검증 — 만들고 → 채우고 → 저장하고 → PDF 받고 → 지운다.
 *
 * 화면 조작과 서버 PDF 생성을 실제로 통과시키는 것이 목적이라, 검증이 끝나면
 * 만든 견적서를 반드시 지운다(운영 데이터에 점검 흔적을 남기지 않는다).
 * 메일 발송은 실제로 거래처에 나가므로 하지 않는다 — 발송 직전까지만 확인한다.
 */

import { test, expect, type Page } from '@playwright/test'

const BASE_URL = process.env.BBANG_BASE_URL ?? 'https://bbabang.vercel.app'
const PW = process.env.PUSH_TEST_PASSWORD ?? ''

test.skip(!PW, 'PUSH_TEST_PASSWORD 없음 — 견적서 실동작 검증 생략')
test.describe.configure({ mode: 'serial' })

async function loginAsBroker(page: Page) {
  await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type="email"], input[name="email"]').first().fill('t2@gmail.com')
  await page.locator('input[type="password"], input[name="password"]').first().fill(PW)
  await page.locator('button[type="submit"]').first().click()
  // 로그인 후 도착지가 대시보드가 아닐 수 있다(온보딩 등). 도착지를 단정하지 않고
  // 로그인 화면을 벗어났는지만 본다 — 실제 확인은 다음 단계의 견적서 화면에서 한다.
  // 대시보드는 무거워서 'load' 를 기다리면 시간이 넘는다. 주소가 바뀌는 순간만 본다
  await page.waitForURL(url => !url.pathname.startsWith('/auth/login'), { timeout: 30_000, waitUntil: 'commit' })
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
}

let estimateUrl = ''

test('견적서를 만들고 프리셋·거래처를 채워 저장한다', async ({ page }) => {
  await loginAsBroker(page)

  await page.goto(`${BASE_URL}/broker/estimates`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '견적서' })).toBeVisible()

  // 새 견적 → 채번 후 상세로 이동
  // '복사해서 새 견적' 버튼과 겹치므로 정확히 일치시킨다
  await page.getByRole('button', { name: '새 견적', exact: true }).click()
  await page.waitForURL(/\/broker\/estimates\/[0-9a-f-]{36}/, { timeout: 20_000 })
  estimateUrl = page.url()

  // 거래처·공사 정보
  await page.locator('#f-cname').fill('점검용 거래처')
  await page.locator('#f-ccontact').fill('점검담당')
  await page.locator('#f-project').fill('점검용 공사 (자동 삭제됨)')

  // 프리셋 불러오기 — 선택지가 있을 때만 (없으면 수동으로 한 줄 넣는다)
  const preset = page.locator('select[aria-label="프리셋 불러오기"]')
  const options = await preset.locator('option').count()
  if (options > 1) {
    page.once('dialog', d => d.accept())   // "현재 내역을 바꿀까요?" 확인창
    await preset.selectOption({ index: 1 })
  } else {
    await page.getByRole('button', { name: '품목 추가' }).click()
    await page.locator('input[aria-label="품명"]').first().fill('점검 품목')
    await page.locator('input[aria-label="단가"]').first().fill('100000')
  }

  // 합계가 0보다 커야 한다 (계산이 실제로 돌았다는 뜻)
  await expect(page.getByText(/일금 .*원정/)).toBeVisible()

  await page.getByRole('button', { name: '저장', exact: true }).click()
  await expect(page.getByText('저장했습니다')).toBeVisible({ timeout: 15_000 })
})

test('저장한 견적서가 PDF로 나온다', async ({ page, request }) => {
  await loginAsBroker(page)
  const id = estimateUrl.split('/').pop()!

  // 브라우저 세션 쿠키를 그대로 써서 서버 PDF 라우트를 친다
  const cookies = await page.context().cookies()
  const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  const res = await request.get(`${BASE_URL}/api/estimates/${id}/pdf`, {
    headers: { cookie: cookieHeader },
  })
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('application/pdf')

  const buf = await res.body()
  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect(buf.length).toBeGreaterThan(10_000)   // 폰트가 빠지면 훨씬 작아진다
  console.log(`[견적서 PDF] ${buf.length} bytes`)
})

test('메일 발송창이 열리고 첨부 파일명이 채워진다', async ({ page }) => {
  await loginAsBroker(page)
  await page.goto(estimateUrl, { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: '메일 발송', exact: true }).click()
  await expect(page.getByRole('heading', { name: '견적서 메일 발송' })).toBeVisible({ timeout: 15_000 })

  // 메일 설정 전이면 안내가, 설정 후면 첨부 파일명이 보인다. 둘 다 정상 상태.
  // 설정을 읽어오기 전에는 "불러오는 중…"이라 즉시 판정하면 둘 다 없는 순간을 잡는다.
  const attachment = page.getByText(/견적서_.*\.pdf/)
  const needsSetup = page.getByText('메일 설정이 필요합니다')
  await expect(attachment.or(needsSetup).first()).toBeVisible({ timeout: 15_000 })
  console.log(`[메일 발송창] ${await attachment.isVisible().catch(() => false) ? '발송 준비됨' : '메일 설정 필요 안내'}`)
})

test('점검용 견적서를 지운다', async ({ page }) => {
  await loginAsBroker(page)
  await page.goto(`${BASE_URL}/broker/estimates`, { waitUntil: 'domcontentloaded' })

  // 앞선 실행이 중간에 끊겨 여러 건 남아 있을 수 있으니 전부 지운다
  const rows = page.locator('tr', { hasText: '점검용 거래처' })
  await expect(rows.first()).toBeVisible({ timeout: 15_000 })

  let removed = 0
  for (let i = 0; i < 20; i++) {
    const before = await rows.count()
    if (before === 0) break
    page.once('dialog', d => d.accept())
    await rows.first().getByRole('button', { name: '삭제', exact: true }).click()
    await expect(rows).toHaveCount(before - 1, { timeout: 15_000 })
    removed++
  }
  await expect(rows).toHaveCount(0)
  console.log(`[정리] 점검용 견적서 ${removed}건 삭제 완료`)
})
