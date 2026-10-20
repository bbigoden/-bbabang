import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 부소장 핵심 업무 흐름 E2E (라이브 사이트)
 *
 * 시나리오:
 *   1. 고객(t1)이 /request/new 에서 매물 요청 등록
 *   2. 중개사(t2)가 /explore/requests 에서 요청 발견 → /request/[id] 의 [이 고객에게 매물 제안하기]로
 *      제안 생성 + 옆에 열린 대화창으로 제안 내용 전송
 *   3. 고객(t1)이 /my/requests 에서 요청, /my/proposals 에서 도착한 제안을 확인하고
 *      그 제안을 열어(/request/[id]?p=) 대화창에 온 제안 내용 확인
 *   4. /chat/[proposalId] 에서 고객 → 중개사 → 고객 메시지 왕복 확인
 *   5. afterAll: 만든 요청/제안/채팅/알림/열람기록 전부 삭제 + 잔존 0건 검증
 *
 * 운영 DB 안전장치:
 *   - 지역을 "서울 강남구 역삼동"으로 고정 — 실제 사무소(플러스불당) 중개사들의
 *     alert_regions(충남 천안시 서북구)와 매칭되지 않아 notify-brokers 푸시가 0건 발송됨
 *   - 모든 텍스트에 "E2E-점검-<timestamp>" 마커를 넣어 식별 가능
 *   - 삭제는 마커(description LIKE 'E2E-점검-%') + t1 소유(user_id) 이중 필터
 *   - 마커가 남는 행은 요청뿐이다 — 인라인 제안은 내용이 빈 칸으로 만들어지고 제안 내용은
 *     대화 메시지로 간다. 그래서 제안·채팅방은 마커 요청의 id 로 따라가 찾고 잔존을 검증한다.
 *   - request_posts DELETE는 RLS상 admin 전용 → admin 계정으로 삭제하며,
 *     proposals / chat_rooms 는 request_id, chat_messages 는 room_id 의 FK ON DELETE CASCADE 로 함께 삭제됨
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
// 중개사가 제안하기 직후 대화창으로 보내는 제안 내용 (제안 행 description 이 아니라 채팅 메시지로 남는다)
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

// [이 고객에게 매물 제안하기](request-detail-client handleProposeClick)는 중개사 프로필이 없거나(!broker)
// 제안 insert 가 막히면(!proposal) 아무 말 없이 끝나 화면이 그대로다. 버튼만 봐서는 어디서
// 멈췄는지 알 수 없으므로, 대화창이 안 열렸을 때 DB 에 무엇이 생겼는지를 실패 보고에 붙인다.
async function describeProposeState(reqId: string): Promise<string> {
  const { client, userId } = await signedInClient(ACCOUNTS.broker)
  try {
    const { data: bp, error: bpErr } = await client.from('broker_profiles').select('id').eq('user_id', userId).maybeSingle()
    if (bpErr) return `중개사 프로필 조회 실패: ${bpErr.message}`
    if (!bp) return 't2 의 broker_profiles 행 없음 (!broker 에서 멈춤)'
    const { data: prop, error: propErr } = await client.from('proposals')
      .select('id, status').eq('request_id', reqId).eq('broker_id', bp.id).maybeSingle()
    if (propErr) return `제안 행 조회 실패: ${propErr.message}`
    if (!prop) return '제안 행 없음 (클릭이 반영되지 않았거나 insert 가 막힘 — !proposal)'
    const { data: room } = await client.from('chat_rooms').select('id').eq('proposal_id', prop.id).limit(1).maybeSingle()
    return `제안 행 있음 (id=${prop.id}, status=${prop.status}), 채팅방 ${room ? '있음' : '없음'}`
  } finally {
    await client.auth.signOut({ scope: 'local' })
  }
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
let brokerOfficeName = ''

test.beforeAll(async ({ browser }) => {
  userCtx = await browser.newContext()
  brokerCtx = await browser.newContext()
  userPage = await userCtx.newPage()
  brokerPage = await brokerCtx.newPage()
})

// ── 정리 (테스트 실패 여부와 무관하게 항상 실행) ──────────────────────
test.afterAll(async () => {
  const problems: string[] = []
  // 지우기 전에 찾아 둔 대상 — 알림 정리와 잔존 검증이 이 id 들로 돈다
  let reqIds: string[] = []
  let propIds: string[] = []
  let roomIds: string[] = []

  try {
    const { client: t1, userId: t1Id } = await signedInClient(ACCOUNTS.user)
    const { client: t2, userId: t2Id } = await signedInClient(ACCOUNTS.broker)
    const { client: admin } = await signedInClient(ACCOUNTS.admin)

    // 0) 정리 대상 찾기. 마커는 요청 description 에만 있다 — 인라인 제안은 내용이 빈 칸이라
    //    제안·채팅방은 마커로 못 찾고, 마커 요청의 id 로 따라가야 한다. 요청이 지워지면 그 길이
    //    끊기므로(제안은 요청자 기준으로 보이고, 방은 제안 id 가 SET NULL 된다) 반드시 지우기 전에 모은다.
    //    이번 실행뿐 아니라 이전 실행이 실패하며 남긴 마커 요청도 함께 청소한다.
    //    RLS: request_posts 는 SELECT 공개, 제안은 요청자(t1)가, 채팅방은 방의 고객(user_id=t1)이 읽을 수 있다.
    const { data: markedReqs, error: findErr } = await t1
      .from('request_posts').select('id').eq('user_id', t1Id).like('description', `${MARKER_PREFIX}%`)
    if (findErr) problems.push(`정리 대상 요청 조회 실패: ${findErr.message}`)
    reqIds = Array.from(new Set<string>([...(markedReqs ?? []).map(r => r.id), ...(requestId ? [requestId] : [])]))

    if (reqIds.length > 0) {
      const { data: props, error: pErr } = await t1.from('proposals').select('id').in('request_id', reqIds)
      if (pErr) problems.push(`정리 대상 제안 조회 실패: ${pErr.message}`)
      propIds = Array.from(new Set<string>([...(props ?? []).map(p => p.id), ...(proposalId ? [proposalId] : [])]))

      const { data: rooms, error: rErr } = await t1.from('chat_rooms').select('id').in('request_id', reqIds)
      if (rErr) problems.push(`정리 대상 채팅방 조회 실패: ${rErr.message}`)
      roomIds = (rooms ?? []).map(r => r.id)
    }

    // 1) 요청 삭제 (admin 전용 RLS) — 마커 + t1 소유 이중 필터.
    //    proposals·chat_rooms 는 request_id FK CASCADE, chat_messages 는 room_id FK CASCADE 로 함께 삭제됨.
    //    (chat_rooms.proposal_id 는 ON DELETE SET NULL 이라 방을 지우는 건 제안이 아니라 요청 쪽 CASCADE 다)
    const { error: delReqErr } = await admin
      .from('request_posts')
      .delete()
      .eq('user_id', t1Id)
      .like('description', `${MARKER_PREFIX}%`)
    if (delReqErr) problems.push(`request_posts 삭제 실패: ${delReqErr.message}`)

    // 2) 알림 정리 (본인 행만 삭제 가능) — link 에 요청·제안 id 가 들어간다.
    //    t1: 새 제안 도착(/request/<요청id>) / t2: 관심 지역 새 요청(/request/<요청id>), 수락·거절(/chat/<제안id>)
    for (const id of [...reqIds, ...propIds]) {
      for (const [label, c, uid] of [['t1', t1, t1Id], ['t2', t2, t2Id]] as const) {
        const { error } = await c.from('notifications').delete().eq('user_id', uid).like('link', `%${id}%`)
        if (error) problems.push(`${label} notifications 삭제 실패: ${error.message}`)
      }
    }

    // 3) 열람 기록 정리 (요청 상세를 열었던 흔적, 본인 행만 삭제 가능)
    if (reqIds.length > 0) {
      for (const [label, c, uid] of [['t1', t1, t1Id], ['t2', t2, t2Id]] as const) {
        const { error } = await c.from('view_history').delete()
          .eq('user_id', uid).eq('target_type', 'request').in('target_id', reqIds)
        if (error) problems.push(`${label} view_history 삭제 실패: ${error.message}`)
      }
    }

    // 4) 잔존 검증 — 종류별로 남은 id 를 모아 한 번에 보고한다
    const leftover = new Map<string, Set<string>>()
    const collect = async (kind: string, query: PromiseLike<{ data: { id: string }[] | null; error: { message: string } | null }>) => {
      const { data, error } = await query
      if (error) { problems.push(`${kind} 잔존 검증 쿼리 실패: ${error.message}`); return }
      for (const r of data ?? []) {
        if (!leftover.has(kind)) leftover.set(kind, new Set())
        leftover.get(kind)!.add(r.id)
      }
    }

    // 요청: SELECT 공개라 그대로 확인. 찾은 id 로 + (다른 계정 것까지) 마커 요청 전체로.
    await collect('E2E 요청', admin.from('request_posts').select('id').like('description', `${MARKER_PREFIX}%`))
    if (reqIds.length > 0) await collect('E2E 요청', admin.from('request_posts').select('id').in('id', reqIds))

    // 제안: 요청이 지워지면 요청자 쪽 SELECT 근거가 사라지므로 작성자(t2)로 확인 (CASCADE 미동작 의심)
    if (reqIds.length > 0) await collect('E2E 요청의 제안', t2.from('proposals').select('id').in('request_id', reqIds))
    if (propIds.length > 0) await collect('E2E 요청의 제안', t2.from('proposals').select('id').in('id', propIds))

    // 채팅방: 방의 고객(t1)은 요청·제안이 없어도 방 행 자체로 읽을 수 있다. proposal_id 는 SET NULL 로
    // 비었을 수 있어 지우기 전에 모은 방 id 와 request_id 로 본다. 메시지는 방이 지워지면 RLS(방 당사자)로도
    // 안 보여 따로 셀 수 없다 — room_id CASCADE 라 방 잔존 0 으로 갈음한다.
    if (roomIds.length > 0) await collect('E2E 채팅방', t1.from('chat_rooms').select('id').in('id', roomIds))
    if (reqIds.length > 0) await collect('E2E 채팅방', t1.from('chat_rooms').select('id').in('request_id', reqIds))

    for (const [kind, ids] of leftover) {
      problems.push(`${kind} ${ids.size}건이 남아 있습니다: ${[...ids].join(', ')}`)
    }

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
  console.log(`[E2E 정리 완료] ${RUN_ID} — 요청 ${reqIds.length} · 제안 ${propIds.length} · 채팅방 ${roomIds.length}건 삭제, 잔존 0건 확인`)
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

  // 제안은 요청 상세 안에서 한다(별도 작성 화면 없음). 버튼이 가격·내용 없이 제안 행을
  // 만들고 오른쪽에 대화창을 연다 — 제안 내용은 그 대화창으로 보낸다.
  // React 하이드레이션 전 클릭은 무시되고 fill 은 리렌더로 비워지는 레이스가 있어(실측),
  // networkidle 대기 + 대화창이 열릴 때까지 클릭 재시도 + 입력값 재확인으로 방어한다.
  // 재클릭해도 안전하다: 이미 제안했으면 새로 만들지 않고 기존 대화창을 연다.
  await brokerPage.goto(`${BASE_URL}/request/${requestId}`, { waitUntil: 'domcontentloaded' })
  await brokerPage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  const proposeBtn = brokerPage.getByRole('button', { name: /이 고객에게 매물 제안하기/ })
  const chatInput = brokerPage.getByPlaceholder('메시지 입력 (Enter 전송)')
  try {
    await expect(async () => {
      if (!(await chatInput.isVisible())) await proposeBtn.click({ timeout: 5_000 })
      await expect(chatInput).toBeVisible({ timeout: 10_000 })
    }).toPass({ timeout: 60_000 })
  } catch (e) {
    // 버튼이 0개면 역할(broker)·요청 상태(active) 조건에 걸렸거나 '준비 중...'에서 안 돌아온 것,
    // 1개인데 대화창이 안 열렸으면 handleProposeClick 안(!broker / !proposal)에서 멈춘 것
    const btnCount = await proposeBtn.count().catch(() => -1)
    const dbState = await describeProposeState(requestId)
      .catch(err => `DB 진단 실패: ${err instanceof Error ? err.message : String(err)}`)
    throw new Error(
      `[제안하기] 대화창이 열리지 않았습니다.\n현재 URL: ${brokerPage.url()}\n제안 버튼: ${btnCount}개\n` +
      `DB: ${dbState}\n원래 오류: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  await chatInput.fill(PROP_DESC)
  await expect(chatInput).toHaveValue(PROP_DESC)
  await chatInput.press('Enter')
  // 전송되면 입력창이 비워진다. 채팅방을 못 만들었으면(room 없음) sendMessage 가 그냥 돌아가 값이 남는다.
  try {
    await expect(chatInput).toHaveValue('')
  } catch {
    // 대화창은 제안을 못 읽거나 채팅방을 못 만들어도 입력칸은 그린다 — 어느 쪽인지 DB 로 가려 알린다
    const state = await describeProposeState(requestId).catch(err => `DB 상태 조회 실패: ${err}`)
    throw new Error(`전송 후 입력창이 비워지지 않았습니다(채팅방 없음?). 현재 URL: ${brokerPage.url()}, ${state}`)
  }

  // 화면이 아니라 서버에 실제로 남은 것을 중개사(t2) 권한으로 확인한다(제안 작성자는 SELECT 가능).
  // 인라인 제안은 가격 0·내용 빈 칸으로 만들어져 제안 행 자체엔 확인할 글자가 없고, 제안 내용은
  // 대화 메시지로만 남는다. (제안 행 UPDATE 는 RLS 상 요청자·admin 만 가능해 중개사가 고쳐 쓸 수도 없다)
  const { client: t2, userId } = await signedInClient(ACCOUNTS.broker)
  try {
    const { data: bp } = await t2.from('broker_profiles').select('id, office_name').eq('user_id', userId).single()
    expect(bp?.id).toBeTruthy()
    // 3번에서 고객 화면의 제안 카드를 사무소 이름으로 확인한다 — 인라인 제안 카드에 보이는 중개사 쪽 글자는 이것뿐
    expect(bp?.office_name, '점검 계정 t2 에 사무소 이름이 있어야 3번에서 고객 쪽 제안 카드를 확인할 수 있습니다').toBeTruthy()
    brokerOfficeName = bp!.office_name

    // (request_id, broker_id) 는 유일 제약이라 재클릭으로 제안이 둘 생기지 않는다 — single() 이 맞다
    const { data: created, error: propErr } = await t2.from('proposals')
      .select('id, status')
      .eq('request_id', requestId)
      .eq('broker_id', bp!.id)
      .single()
    expect(propErr, `제안 행을 찾지 못했습니다: ${propErr?.message}`).toBeNull()
    expect(created?.status).toBe('pending')
    proposalId = created!.id

    // 대화창이 쓰는 채팅방 — ChatPanel 처럼 이 제안의 가장 먼저 만든 방을 고른다
    const { data: room } = await t2.from('chat_rooms').select('id')
      .eq('proposal_id', proposalId).order('created_at', { ascending: true }).limit(1).maybeSingle()
    expect(room?.id, '제안 대화창의 채팅방이 만들어졌어야 합니다').toBeTruthy()

    // 대화창으로 보낸 제안 내용이 그 방에 중개사가 보낸 메시지로 저장됐는지 (화면 반영은 realtime 의존이라 DB로 확인).
    // 입력창은 insert 가 끝나기 전에 비워지므로 저장될 때까지 잠깐 기다린다.
    await expect.poll(async () => {
      const { data } = await t2.from('chat_messages').select('id')
        .eq('room_id', room!.id).eq('sender_id', userId).eq('content', PROP_DESC)
      return (data ?? []).length
    }, { timeout: 15_000, message: '대화창으로 보낸 제안 내용이 채팅 메시지로 저장됐어야 합니다' }).toBe(1)
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

  // 받은 제안 목록에 t2의 제안이 '대기 중'으로 뜬다. 인라인 제안은 가격·내용이 비어 있어 카드에
  // 이번 실행만의 글자가 없으므로, 이 제안으로 가는 링크(href 에 제안 id)로 집고 사무소 이름을 본다.
  await userPage.goto(`${BASE_URL}/my/proposals`, { waitUntil: 'domcontentloaded' })
  const card = userPage.locator(`a[href="/request/${requestId}?p=${proposalId}"]`)
  await expect(card).toBeVisible()
  await expect(card).toContainText('대기 중')
  await expect(card).toContainText(brokerOfficeName)

  // 카드를 누르면 요청 상세에서 그 제안의 대화창이 바로 열리고, 중개사가 보낸 제안 내용이 보인다.
  // ?p 는 고객이 읽을 수 있는 제안 목록에 그 id 가 있을 때만 대화를 연다(page.tsx) — 메시지가
  // 보이면 고객 권한으로 제안·채팅방·메시지를 모두 읽었다는 뜻이다. 메시지는 대화창이 열릴 때
  // 서버에서 읽어 오므로 realtime 에 기대지 않는다.
  await card.click()
  await userPage.waitForURL(u => u.pathname === `/request/${requestId}` && u.searchParams.get('p') === proposalId, { timeout: 30_000 })
  await expect(userPage.getByText(PROP_DESC).first()).toBeVisible({ timeout: 30_000 })
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
