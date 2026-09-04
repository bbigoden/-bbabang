/**
 * 견적서 새 기능 실동작 점검 — 품목 사전·원가·공유·첨부·청구서·수정 견적.
 *
 * 한 번만 로그인하고 단계로 나눠 훑는다. 테스트마다 로그인하면 Supabase 인증
 * 제한에 걸린다(실제로 걸려서 이렇게 바꿨다).
 * 만든 것은 마지막에 모두 지운다. 메일은 실제로 나가므로 보내지 않는다.
 */

import { test, expect } from '@playwright/test'

const BASE_URL = process.env.BBANG_BASE_URL ?? 'https://bbabang.vercel.app'
const PW = process.env.PUSH_TEST_PASSWORD ?? ''
const MARK = '점검용 거래처'          // 정리 기준이 되는 표식

test.skip(!PW, 'PUSH_TEST_PASSWORD 없음 — 견적서 기능 점검 생략')

test('견적서 새 기능 전체 훑기', async ({ page, context, request }) => {
  test.setTimeout(300_000)

  await test.step('로그인', async () => {
    await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' })
    await page.locator('input[type="email"], input[name="email"]').first().fill('t2@gmail.com')
    await page.locator('input[type="password"], input[name="password"]').first().fill(PW)
    await page.locator('button[type="submit"]').first().click()
    await page.waitForURL(u => !u.pathname.startsWith('/auth/login'), { timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
  })

  let estimateUrl = ''

  await test.step('견적서 만들고 원가 넣기 → 이익 계산', async () => {
    await page.goto(`${BASE_URL}/broker/estimates`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '새 견적', exact: true }).click()
    await page.waitForURL(/\/broker\/estimates\/[0-9a-f-]{36}/, { timeout: 20_000 })
    estimateUrl = page.url()

    await page.locator('#f-cname').fill(MARK)
    await page.locator('#f-project').fill('점검용 공사')
    await page.locator('#f-period').fill('2026-10-01 ~ 2026-10-31')

    await page.getByRole('button', { name: '품목 추가' }).click()
    await page.locator('input[aria-label="품명"]').first().fill('점검 타일')
    await page.locator('input[aria-label="수량"]').first().fill('10')
    await page.locator('input[aria-label="단가"]').first().fill('100000')

    await page.getByRole('button', { name: /원가 (보기|숨기기)/ }).click()
    await page.locator('input[aria-label="원가"]').first().fill('60000')

    // 100,000×10 = 1,000,000 / 원가 600,000 → 이익 400,000 (40%)
    await expect(page.getByText('예상 이익')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('내부용 · 견적서에는 나가지 않습니다')).toBeVisible()
    await expect(page.getByText('400,000')).toBeVisible()
    await expect(page.getByText('(40.0%)')).toBeVisible()

    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByText('저장했습니다')).toBeVisible({ timeout: 20_000 })
    console.log('[OK] 원가·이익 계산')
  })

  await test.step('품목 사전에 쌓이고 자동완성으로 불러진다', async () => {
    await page.goto(`${BASE_URL}/broker/estimates/settings`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '품목 사전' }).click()
    await expect(page.getByRole('cell', { name: '점검 타일' })).toBeVisible({ timeout: 20_000 })

    await page.goto(estimateUrl, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '품목 추가' }).click()
    await page.locator('input[aria-label="품명"]').last().fill('점검')
    const hit = page.getByRole('button', { name: /점검 타일/ }).first()
    await expect(hit).toBeVisible({ timeout: 10_000 })
    await hit.click()
    await expect(page.locator('input[aria-label="단가"]').last()).toHaveValue('100000')
    console.log('[OK] 품목 사전 · 자동완성')
  })

  let shareUrl = ''

  await test.step('공유 링크 — 로그인 없이 열리고 원가는 안 나간다', async () => {
    await page.goto(estimateUrl, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '공유 링크 만들기' }).click()
    const box = page.getByRole('textbox', { name: '공유 링크' })
    await expect(box).toBeVisible({ timeout: 20_000 })
    shareUrl = await box.inputValue()
    expect(shareUrl).toContain('/e/')

    const guestCtx = await context.browser()!.newContext()
    const guest = await guestCtx.newPage()
    await guest.goto(shareUrl, { waitUntil: 'domcontentloaded' })
    await expect(guest.getByRole('heading', { name: '견 적 서' })).toBeVisible({ timeout: 20_000 })
    await expect(guest.getByText(MARK)).toBeVisible()
    // 내부 정보가 새면 안 된다
    await expect(guest.getByText('60,000')).toHaveCount(0)
    await expect(guest.getByText('예상 이익')).toHaveCount(0)
    await guest.close()
    await guestCtx.close()

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/거래처가 \d+번 열어봤습니다/)).toBeVisible({ timeout: 20_000 })
    console.log('[OK] 공유 링크 · 열람 기록 · 원가 미노출')
  })

  await test.step('청구서 발행 → PDF', async () => {
    await page.goto(estimateUrl, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '청구서 발행' }).click()
    await expect(page.getByRole('heading', { name: '청구서 발행' })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: '발행', exact: true }).click()
    await expect(page.getByText('청구서를 발행했습니다')).toBeVisible({ timeout: 20_000 })

    const row = page.locator('tr', { hasText: /C\d{4}-\d{4}-\d{2}/ }).first()
    await expect(row).toBeVisible({ timeout: 10_000 })

    // 팝업의 url() 은 로딩 전이라 비어 있을 때가 있다. window.open 을 가로채 주소만 본다
    await page.evaluate(() => {
      const w = window as unknown as { __opened?: string }
      window.open = (u?: string | URL) => { w.__opened = String(u ?? ''); return null }
    })
    await row.getByRole('button', { name: '청구서 PDF' }).click()
    const pdfUrl = await page.evaluate(() => (window as unknown as { __opened?: string }).__opened ?? '')
    expect(pdfUrl).toMatch(/\/api\/estimates\/invoices\/[0-9a-f-]{36}\/pdf/)

    const cookies = await context.cookies()
    const res = await request.get(new URL(pdfUrl, BASE_URL).toString(), {
      headers: { cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ') },
    })
    expect(res.status()).toBe(200)
    const buf = await res.body()
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    console.log(`[OK] 청구서 PDF ${buf.length} bytes`)
  })

  await test.step('수정 견적 r2', async () => {
    await page.goto(estimateUrl, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '수정 견적' }).click()
    await page.waitForURL(u => u.pathname.startsWith('/broker/estimates/') && u.pathname !== new URL(estimateUrl).pathname, { timeout: 25_000 })
    await expect(page.getByText('수정 2차')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/\d{4}-\d{4}-\d{2}-r2/)).toBeVisible()
    console.log('[OK] 수정 견적 r2')
  })

  await test.step('정리 — 만든 견적서 모두 삭제', async () => {
    await page.goto(`${BASE_URL}/broker/estimates`, { waitUntil: 'domcontentloaded' })
    const rows = page.locator('tr', { hasText: MARK })
    let removed = 0
    for (let i = 0; i < 20; i++) {
      const before = await rows.count()
      if (before === 0) break
      page.once('dialog', d => d.accept())
      await rows.first().getByRole('button', { name: '삭제', exact: true }).click()
      await expect(rows).toHaveCount(before - 1, { timeout: 20_000 })
      removed++
    }
    await expect(rows).toHaveCount(0)
    console.log(`[정리] 점검용 견적서 ${removed}건 삭제`)
  })
})
