import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 부소장 핵심 업무 흐름 E2E (라이브 사이트)
 *
 * 시나리오:
 *   1. 고객(t1)이 /request/new 에서 매물 요청 등록
 *   2. 중개사(t2)가 /explore/requests 에서 요청 발견 → /request/[id]/propose 로 제안 전송
 *   3. 고객(t1)이 /my/requests → /request/[id] 에서 제안 도착 확인
 *   4. /chat/[proposalId] 에서 고객 → 중개사 → 고객 메시지 왕복 확인
 *   5. afterAll: 만든 요청/제안/채팅/알림/열람기록 전부 삭제 + 잔존 0건 검증
 *
 * 운영 DB 안전장치:
 *   - 지역을 "서울 강남구 역삼동"으로 고정 — 실제 사무소(플러스불당) 중개사들의
 *     alert_regions(충남 천안시 서북구)와 매칭되지 않아 notify-brokers 푸시가 0건 발송됨
 *   - 모든 텍스트에 "E2E-점검-<timestamp>" 마커를 넣어 식별 가능
 *   - 삭제는 마커(description LIKE 'E2E-점검-%') + t1 소유(user_id) 이중 필터
 *   - request_posts DELETE는 RLS상 admin 전용 → admin 계정으로 삭제하며,
 *     proposals / chat_rooms / chat_messages 는 FK ON DELETE CASCADE 로 함께 삭제됨
 */

const BASE_URL = process.env.BBANG_BASE_URL ?? 'https://bbabang.vercel.app'

// 점검 전용 테스트 계정 (tests/visual/inspection.spec.ts 와 동일한 방식)
// 공개 레포이므로 비밀번호 하드코딩 금지 (.env.local의 PUSH_TEST_PASSWORD)
const PW = process.env.PUSH_TEST_PASSWORD ?? ''
if (!PW) throw new Error('[inspect:e2e] PUSH_TEST_PASSWORD가 없어요. .env.local에 점검 계정 비밀번호를 넣어주세요.')

const ACCOUNTS = {
  user: { email: 't1@gmail.com', password: PW },     // 고객
  broker: { email: 't2@gmail.com', password: PW },   // 중개사
  admin: { email: 'bigodennn@gmail.com', password: PW }, // 정리용 (request_posts DELETE는 admin 전용)
}

// 이번 실행 식별 마커
const MARKER_PREFIX = 'E2E-점검-'
const RUN_ID = `${MARKER_PREFIX}${Date.now()}`
const REQ_DESC = `${RUN_ID} 요청 — 자동 테스트 데이터입니다. 잠시 후 삭제됩니다.`
const PROP_DESC = `${RUN_ID} 제안 — 자동 테스트 데이터입니다. 잠시 후 삭제됩니다.`
const MSG_USER = `${RUN_ID} 고객 메시지`
const MSG_BROKER = `${RUN_ID} 중개사 답장`

// ── Supabase (정리·검증용, .env.local에서 URL/anon key 로드) ──────────
function loadEnvLocal(): Record<string, string> {
  const p = path.resolve(__dirname, '../../.env.local')
  const out: Record<string, string> = {}
  if (!fs.existsSync(p)) return out
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2]
  }
  return out
}
const ENV = loadEnvLocal()
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ENV.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function signedInClient(account: { email: string; password: string }): Promise<{ client: SupabaseClient; userId: string }> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('.env.local에서 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY를 찾지 못했습니다')
  }
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword(account)
  if (error || !data.user) throw new Error(`Supabase 로그인 실패 (${account.email}): ${error?.message}`)
  return { client, userId: data.user.id }
}

// ── UI 로그인 헬퍼 (tests/visual/inspection.spec.ts loginAs 패턴) ──────
async function loginAs(page: Page, account: { email: string; password: string }) {
  await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

  const emailInput = page.locator('input[type="email"], input[name="email"]').first()
  const pwInput = page.locator('input[type="password"], input[name="password"]').first()

  // React 하이드레이션 전에 fill하면 controlled input이 리렌더로 비워지는
  // 레이스가 있어(실측), 값이 유지될 때까지 재시도한다.
  await expect(async () => {
    await emailInput.fill(account.email)
    await pwInput.fill(account.password)
    expect(await emailInput.inputValue()).toBe(account.email)
    expect(await pwInput.inputValue()).toBe(account.password)
  }).toPass({ timeout: 20_000 })

  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL(/\/(dashboard|admin)\b/, { timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
}

// ── 시나리오 상태 (serial 모드로 테스트 간 공유) ─────────────────────
test.describe.configure({ mode: 'serial' })

let userCtx: BrowserContext
let brokerCtx: BrowserContext
let userPage: Page
let brokerPage: Page
let requestId = ''
let proposalId = ''

test.beforeAll(async ({ browser }) => {
  userCtx = await browser.newContext()
  brokerCtx = await browser.newContext()
  userPage = await userCtx.newPage()
  brokerPage = await brokerCtx.newPage()
})

// ── 정리 (테스트 실패 여부와 무관하게 항상 실행) ──────────────────────
test.afterAll(async () => {
  const problems: string[] = []

  try {
    const { client: t1, userId: t1Id } = await signedInClient(ACCOUNTS.user)
    const { client: t2, userId: t2Id } = await signedInClient(ACCOUNTS.broker)
    const { client: admin } = await signedInClient(ACCOUNTS.admin)

    // 1) 요청 삭제 (admin 전용 RLS) — 마커 + t1 소유 이중 필터.
    //    proposals / chat_rooms / chat_messages 는 FK CASCADE로 함께 삭제됨.
    //    이번 실행뿐 아니라 이전 실행이 실패하며 남긴 마커 행도 함께 청소.
    const { error: delReqErr } = await admin
      .from('request_posts')
      .delete()
      .eq('user_id', t1Id)
      .like('description', `${MARKER_PREFIX}%`)
    if (delReqErr) problems.push(`request_posts 삭제 실패: ${delReqErr.message}`)

    // 2) 알림 정리 (본인 행만 삭제 가능) — 제안 도착 알림 등
    if (requestId) {
      const { error } = await t1.from('notifications').delete().eq('user_id', t1Id).like('link', `%${requestId}%`)
      if (error) problems.push(`t1 notifications 삭제 실패: ${error.message}`)
      if (proposalId) {
        const { error: e2 } = await t2.from('notifications').delete().eq('user_id', t2Id).like('link', `%${proposalId}%`)
        if (e2) problems.push(`t2 notifications 삭제 실패: ${e2.message}`)
      }
    }

    // 3) 열람 기록 정리 (요청 상세를 열었던 흔적, 본인 행만 삭제 가능)
    if (requestId) {
      for (const [label, c, uid] of [['t1', t1, t1Id], ['t2', t2, t2Id]] as const) {
        const { error } = await c.from('view_history').delete()
          .eq('user_id', uid).eq('target_type', 'request').eq('target_id', requestId)
        if (error) problems.push(`${label} view_history 삭제 실패: ${error.message}`)
      }
    }

    // 4) 잔존 검증 — request_posts는 SELECT 공개(true)라 그대로 확인 가능
    const { data: leftoverReqs, error: verErr } = await admin
      .from('request_posts').select('id').like('description', `${MARKER_PREFIX}%`)
    if (verErr) problems.push(`잔존 검증 쿼리 실패: ${verErr.message}`)
    else if ((leftoverReqs ?? []).length > 0) problems.push(`E2E 마커 요청이 ${leftoverReqs!.length}건 남아 있습니다: ${leftoverReqs!.map(r => r.id).join(', ')}`)

    // proposals는 당사자만 SELECT 가능 → t2(제안 작성자)로 잔존 확인
    const { data: leftoverProps } = await t2
      .from('proposals').select('id').like('description', `${MARKER_PREFIX}%`)
    if ((leftoverProps ?? []).length > 0) problems.push(`E2E 마커 제안이 ${leftoverProps!.length}건 남아 있습니다 (CASCADE 미동작 의심)`)

    // global signOut은 사용자의 모든 기기 세션을 끊으므로 local로 제한
    await Promise.all([
      t1.auth.signOut({ scope: 'local' }),
      t2.auth.signOut({ scope: 'local' }),
      admin.auth.signOut({ scope: 'local' }),
    ])
  } catch (e) {
    problems.push(`정리 절차 자체가 실패: ${e instanceof Error ? e.message : String(e)}`)
  }

  await userCtx?.close().catch(() => {})
  await brokerCtx?.close().catch(() => {})

  if (problems.length > 0) {
    throw new Error(`[E2E 정리 실패 — 수동 확인 필요]\n${problems.join('\n')}`)
  }
  console.log(`[E2E 정리 완료] ${RUN_ID} 관련 행 잔존 0건 확인`)
})

// ── 1. 고객: 요청 등록 ────────────────────────────────────────────────
test('1. 고객(t1)이 매물 요청을 등록한다', async () => {
  await loginAs(userPage, ACCOUNTS.user)

  await userPage.goto(`${BASE_URL}/request/new`, { waitUntil: 'domcontentloaded' })
  await userPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})

  // Step 0: 거래 유형 + 매물 유형 (칩 다중선택 버튼)
  // 하이드레이션 전 클릭은 무시되므로 aria-pressed로 반영 여부를 확인하며 재시도
  for (const name of ['매매', '아파트']) {
    // 선택되면 라벨이 "✓ 매매"로 바뀌므로 접두 체크표시를 허용하는 정규식 사용
    const chip = userPage.getByRole('button', { name: new RegExp(`^(✓\\s*)?${name}$`) })
    await expect(async () => {
      if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click()
      expect(await chip.getAttribute('aria-pressed')).toBe('true')
    }).toPass({ timeout: 20_000 })
  }
  await userPage.getByRole('button', { name: /다음/ }).click()

  // Step 1: 지역 — 실제 사무소 alert_regions(천안 서북구)와 겹치지 않는 역삼동 사용
  const regionInput = userPage.locator('input[placeholder*="동·읍·면"]')
  await regionInput.fill('역삼동')
  await userPage.locator('li button', { hasText: '역삼동' }).first().click()
  await userPage.getByRole('button', { name: /다음/ }).click()

  // Step 2: 예산 (만원)
  await userPage.getByLabel('최소값 (만원)').fill('30000')
  await userPage.getByLabel('최대값 (만원)').fill('60000')
  await userPage.getByRole('button', { name: /다음/ }).click()

  // Step 3: 추가 요청사항에 식별 마커
  await userPage.locator('textarea').fill(REQ_DESC)
  await userPage.getByRole('button', { name: /조건 등록 완료/ }).click()

  // 등록 완료 → /request/[id] 로 이동
  await userPage.waitForURL(/\/request\/[0-9a-f-]{36}$/, { timeout: 30_000 })
  requestId = userPage.url().match(/\/request\/([0-9a-f-]{36})/)![1]
  expect(requestId).toBeTruthy()

  // 상세 페이지에 방금 쓴 요청 내용이 보이는지
  await expect(userPage.getByText(RUN_ID).first()).toBeVisible()
})

// ── 2. 중개사: 요청 발견 + 제안 전송 ─────────────────────────────────
test('2. 중개사(t2)가 요청을 발견하고 제안을 보낸다', async () => {
  expect(requestId, '1번 테스트에서 요청이 등록됐어야 합니다').toBeTruthy()

  await loginAs(brokerPage, ACCOUNTS.broker)

  // 공개 요청 피드에서 방금 등록된 요청 발견
  await brokerPage.goto(`${BASE_URL}/explore/requests`, { waitUntil: 'domcontentloaded' })
  await expect(brokerPage.locator(`a[href="/request/${requestId}"]`)).toBeVisible()

  // 제안 작성 — React 하이드레이션 전에 fill하면 controlled input이 리렌더로
  // 비워지는 레이스가 있어(실측), networkidle 대기 + 값 재확인으로 방어
  await brokerPage.goto(`${BASE_URL}/request/${requestId}/propose`, { waitUntil: 'domcontentloaded' })
  await brokerPage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  const priceInput = brokerPage.getByLabel('제안 가격 (만원)')
  await priceInput.fill('55000')
  await expect(priceInput).toHaveValue('55000')
  const descInput = brokerPage.locator('textarea')
  await descInput.fill(PROP_DESC)
  await expect(descInput).toHaveValue(PROP_DESC)
  await brokerPage.getByRole('button', { name: /제안 보내기/ }).click()

  // 전송 완료 → 요청 상세로 이동 (실패 시 화면의 에러 문구를 함께 보고)
  try {
    await brokerPage.waitForURL(`**/request/${requestId}`, { timeout: 30_000 })
  } catch (e) {
    const errText = await brokerPage.locator('.bg-red-50').first().innerText().catch(() => '(에러 박스 없음)')
    throw new Error(`제안 전송 후 요청 상세로 이동하지 못했습니다. 현재 URL: ${brokerPage.url()}, 화면 에러: ${errText}`)
  }

  // 방금 만든 제안 id 조회 (RLS: 제안 작성 중개사 본인은 SELECT 가능)
  const { client: t2, userId } = await signedInClient(ACCOUNTS.broker)
  try {
    const { data: bp } = await t2.from('broker_profiles').select('id').eq('user_id', userId).single()
    expect(bp?.id).toBeTruthy()
    const { data: prop } = await t2.from('proposals')
      .select('id, description')
      .eq('request_id', requestId)
      .eq('broker_id', bp!.id)
      .single()
    expect(prop?.description).toBe(PROP_DESC)
    proposalId = prop!.id
  } finally {
    // scope 기본값(global)은 브라우저 세션의 refresh token까지 전부 무효화해
    // 이후 테스트의 로그인 상태가 풀린다(실측) — 반드시 local로 로그아웃
    await t2.auth.signOut({ scope: 'local' })
  }
})

// ── 3. 고객: 제안 도착 확인 ──────────────────────────────────────────
test('3. 고객(t1)이 내 요청에서 도착한 제안을 확인한다', async () => {
  expect(proposalId, '2번 테스트에서 제안이 생성됐어야 합니다').toBeTruthy()

  // 내 요청 목록에 해당 요청이 있고
  await userPage.goto(`${BASE_URL}/my/requests`, { waitUntil: 'domcontentloaded' })
  await expect(userPage.locator(`a[href="/request/${requestId}"]`).first()).toBeVisible()

  // 요청 상세의 제안 목록에 t2의 제안(마커 포함)이 보인다
  await userPage.goto(`${BASE_URL}/request/${requestId}`, { waitUntil: 'domcontentloaded' })
  await expect(userPage.getByText(PROP_DESC).first()).toBeVisible()
})

// ── 4. 채팅 왕복 ─────────────────────────────────────────────────────
test('4. 채팅에서 고객 ↔ 중개사 메시지가 왕복된다', async () => {
  expect(proposalId).toBeTruthy()

  // 고객이 채팅방 진입 + 첫 메시지 전송
  await userPage.goto(`${BASE_URL}/chat/${proposalId}`, { waitUntil: 'domcontentloaded' })
  const userInput = userPage.locator('textarea')
  await userInput.waitFor({ state: 'visible', timeout: 30_000 })
  await userInput.fill(MSG_USER)
  await expect(userInput).toHaveValue(MSG_USER) // 하이드레이션 레이스 방어
  await userInput.press('Enter')
  // 전송되면 입력창이 비워짐. 화면 반영은 realtime 구독에 의존해 불안정하므로
  // 재로딩(서버에서 다시 조회)으로 저장 여부를 검증한다.
  await expect(userInput).toHaveValue('')
  await userPage.reload({ waitUntil: 'domcontentloaded' })
  await expect(userPage.getByText(MSG_USER).first()).toBeVisible({ timeout: 30_000 })

  // 중개사 쪽에서 고객 메시지가 보이고, 답장 전송
  await brokerPage.goto(`${BASE_URL}/chat/${proposalId}`, { waitUntil: 'domcontentloaded' })
  const brokerInput = brokerPage.locator('textarea')
  await brokerInput.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(brokerPage.getByText(MSG_USER).first()).toBeVisible()
  await brokerInput.fill(MSG_BROKER)
  await expect(brokerInput).toHaveValue(MSG_BROKER) // 하이드레이션 레이스 방어
  await brokerInput.press('Enter')
  await expect(brokerInput).toHaveValue('')
  await brokerPage.reload({ waitUntil: 'domcontentloaded' })
  await expect(brokerPage.getByText(MSG_BROKER).first()).toBeVisible({ timeout: 30_000 })

  // 고객 쪽에서 답장 확인 (재로딩으로 서버 저장 여부까지 검증)
  await userPage.reload({ waitUntil: 'domcontentloaded' })
  await expect(userPage.getByText(MSG_USER).first()).toBeVisible({ timeout: 30_000 })
  await expect(userPage.getByText(MSG_BROKER).first()).toBeVisible()
})
