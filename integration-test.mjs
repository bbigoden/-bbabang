/**
 * 통합 테스트 (Integration Test)
 * 실제 Supabase DB에 연결하여 CRUD 흐름 검증
 * 실행: node integration-test.mjs
 *
 * 필요 환경변수 (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   TEST_USER_EMAIL / TEST_USER_PASSWORD
 *   TEST_BROKER_EMAIL / TEST_BROKER_PASSWORD
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

// .env.local 자동 로드 (worktree 또는 상위 메인 프로젝트 폴더)
const __dir = dirname(fileURLToPath(import.meta.url))
const envPaths = [join(__dir, '.env.local'), join(__dir, '..', '..', '..', '.env.local')]
try {
  const envFile = envPaths.find(p => { try { readFileSync(p); return true } catch { return false } })
  const env = readFileSync(envFile ?? envPaths[0], 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local 없으면 이미 주입된 환경변수 사용 */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const USER_EMAIL = process.env.TEST_USER_EMAIL
const USER_PW = process.env.TEST_USER_PASSWORD
const BROKER_EMAIL = process.env.TEST_BROKER_EMAIL
const BROKER_PW = process.env.TEST_BROKER_PASSWORD

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.')
  process.exit(1)
}

// ── 공통 유틸 ──────────────────────────────────────────────────────────────────

let pass = 0, fail = 0, skip = 0
const results = []

function log(icon, label, detail = '') {
  const msg = `  ${icon} ${label}${detail ? ' — ' + detail : ''}`
  console.log(msg)
  results.push({ icon, label })
}

async function test(label, fn) {
  try {
    await fn()
    log('✅', label)
    pass++
  } catch (e) {
    log('❌', label, e.message ?? String(e))
    fail++
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? '단언 실패')
}

async function supaRest(path, { token, method = 'GET', body } = {}) {
  const headers = {
    'apikey': ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

async function supaLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!data.access_token) throw new Error(`로그인 실패: ${data.error_description ?? JSON.stringify(data)}`)
  return { token: data.access_token, uid: data.user?.id }
}

// ── 섹션 구분 ──────────────────────────────────────────────────────────────────

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// T1. 환경 연결 확인
// ══════════════════════════════════════════════════════════════════════════════
section('T1. 환경 연결 확인')

await test('Supabase URL 응답', async () => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: ANON_KEY }
  })
  assert([200, 400, 401].includes(res.status), `예상 외 상태: ${res.status}`)
})

await test('anon 키 유효', async () => {
  const { status } = await supaRest('/profiles?select=id&limit=1')
  assert(status === 200 || status === 401, `예상 외 상태: ${status}`)
})

// ══════════════════════════════════════════════════════════════════════════════
// T2. 인증 (Auth)
// ══════════════════════════════════════════════════════════════════════════════
section('T2. 인증')

let userToken = null, userUid = null
let brokerToken = null, brokerUid = null

if (!USER_EMAIL || !USER_PW) {
  log('⏭️', '일반 사용자 로그인 SKIP — TEST_USER_EMAIL/PASSWORD 미설정')
  skip += 3
} else {
  await test('일반 사용자 로그인', async () => {
    const { token, uid } = await supaLogin(USER_EMAIL, USER_PW)
    userToken = token
    userUid = uid
    assert(token, '토큰 없음')
    assert(uid, 'UID 없음')
  })

  await test('로그인 토큰으로 내 프로필 조회', async () => {
    assert(userToken, '토큰 없음 (로그인 실패)')
    const { status, data } = await supaRest(`/profiles?id=eq.${userUid}&select=id,name,role`, { token: userToken })
    assert(status === 200, `상태 ${status}`)
    assert(Array.isArray(data) && data.length > 0, '프로필 없음')
    assert(data[0].id === userUid, 'ID 불일치')
  })

  await test('잘못된 토큰으로 프로필 수정 → 거부', async () => {
    const { status } = await supaRest(`/profiles?id=eq.${userUid}`, {
      method: 'PATCH',
      token: 'invalid.token.here',
      body: { name: 'hacked' },
    })
    assert(status === 401 || status === 403, `예상 거부인데 ${status}`)
  })
}

if (!BROKER_EMAIL || !BROKER_PW) {
  log('⏭️', '중개사 로그인 SKIP — TEST_BROKER_EMAIL/PASSWORD 미설정')
  skip += 1
} else {
  await test('중개사 로그인', async () => {
    const { token, uid } = await supaLogin(BROKER_EMAIL, BROKER_PW)
    brokerToken = token
    brokerUid = uid
    assert(token, '토큰 없음')
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// T3. RLS — 비인증 차단
// ══════════════════════════════════════════════════════════════════════════════
section('T3. RLS — 비인증 접근 차단')

await test('비인증 profiles INSERT → 거부', async () => {
  const { status } = await supaRest('/profiles', {
    method: 'POST',
    body: { id: '00000000-0000-0000-0000-000000000001', email: 'hack@test.com', role: 'admin' },
  })
  assert(status === 401 || status === 403, `예상 거부인데 ${status}`)
})

await test('비인증 request_posts INSERT → 거부', async () => {
  const { status } = await supaRest('/request_posts', {
    method: 'POST',
    body: { deal_type: '매매', room_type: '아파트', city: '서울특별시', district: '강남구', min_price: 10000, max_price: 50000 },
  })
  assert(status === 401 || status === 403, `예상 거부인데 ${status}`)
})

await test('비인증 proposals INSERT → 거부', async () => {
  const { status } = await supaRest('/proposals', {
    method: 'POST',
    body: { request_id: '00000000-0000-0000-0000-000000000001', price: 10000, property_address: '서울', description: '테스트' },
  })
  assert(status === 401 || status === 403, `예상 거부인데 ${status}`)
})

await test('비인증 reviews INSERT → 거부', async () => {
  const { status } = await supaRest('/reviews', {
    method: 'POST',
    body: { broker_id: '00000000-0000-0000-0000-000000000001', rating: 5 },
  })
  assert(status === 401 || status === 403, `예상 거부인데 ${status}`)
})

await test('비인증 chat_messages INSERT → 거부', async () => {
  const { status } = await supaRest('/chat_messages', {
    method: 'POST',
    body: { room_id: '00000000-0000-0000-0000-000000000001', content: '해킹', message_type: 'text' },
  })
  assert(status === 401 || status === 403, `예상 거부인데 ${status}`)
})

// ══════════════════════════════════════════════════════════════════════════════
// T4. CRUD — 요청(request_posts) 생성·조회·삭제
// ══════════════════════════════════════════════════════════════════════════════
section('T4. CRUD — 요청 등록/조회/삭제')

let createdRequestId = null

if (!userToken) {
  log('⏭️', 'CRUD 테스트 SKIP — 사용자 로그인 필요')
  skip += 4
} else {
  await test('요청 등록 (INSERT)', async () => {
    const { status, data } = await supaRest('/request_posts', {
      method: 'POST',
      token: userToken,
      body: {
        deal_type: '전세',
        room_type: '아파트',
        city: '서울특별시',
        district: '강남구',
        min_price: 30000,
        max_price: 50000,
        description: '[통합테스트] 자동 삭제됩니다',
      },
    })
    assert(status === 201, `상태 ${status}: ${JSON.stringify(data)}`)
    assert(Array.isArray(data) && data.length > 0, 'ID 없음')
    createdRequestId = data[0].id
  })

  await test('등록된 요청 조회 (SELECT)', async () => {
    assert(createdRequestId, '이전 단계 실패')
    const { status, data } = await supaRest(`/request_posts?id=eq.${createdRequestId}&select=*`, { token: userToken })
    assert(status === 200, `상태 ${status}`)
    assert(Array.isArray(data) && data.length === 1, '조회 실패')
    assert(data[0].district === '강남구', '지역 불일치')
    assert(data[0].min_price === 30000, '가격 불일치')
  })

  await test('요청 수정 (UPDATE)', async () => {
    assert(createdRequestId, '이전 단계 실패')
    const { status, data } = await supaRest(`/request_posts?id=eq.${createdRequestId}`, {
      method: 'PATCH',
      token: userToken,
      body: { district: '서초구', max_price: 60000 },
    })
    assert(status === 200, `상태 ${status}`)
    assert(Array.isArray(data) && data[0].district === '서초구', '수정 미반영')
  })

  await test('요청 삭제 (DELETE)', async () => {
    assert(createdRequestId, '이전 단계 실패')
    const { status } = await supaRest(`/request_posts?id=eq.${createdRequestId}`, {
      method: 'DELETE',
      token: userToken,
    })
    assert(status === 200 || status === 204, `상태 ${status}`)
    // 삭제 확인
    const { data: check } = await supaRest(`/request_posts?id=eq.${createdRequestId}&select=id`, { token: userToken })
    assert(!Array.isArray(check) || check.length === 0, '삭제 후에도 존재')
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// T5. CRUD — 프로필 수정·원복
// ══════════════════════════════════════════════════════════════════════════════
section('T5. CRUD — 프로필 수정/원복')

if (!userToken || !userUid) {
  log('⏭️', '프로필 CRUD SKIP — 사용자 로그인 필요')
  skip += 3
} else {
  let originalName = null

  await test('프로필 이름 조회', async () => {
    const { status, data } = await supaRest(`/profiles?id=eq.${userUid}&select=name`, { token: userToken })
    assert(status === 200, `상태 ${status}`)
    assert(Array.isArray(data) && data.length > 0, '프로필 없음')
    originalName = data[0].name ?? ''
  })

  await test('프로필 이름 수정', async () => {
    const { status, data } = await supaRest(`/profiles?id=eq.${userUid}`, {
      method: 'PATCH',
      token: userToken,
      body: { name: '__통합테스트__' },
    })
    assert(status === 200, `상태 ${status}`)
    assert(data[0]?.name === '__통합테스트__', '수정 미반영')
  })

  await test('프로필 이름 원복', async () => {
    const { status, data } = await supaRest(`/profiles?id=eq.${userUid}`, {
      method: 'PATCH',
      token: userToken,
      body: { name: originalName },
    })
    assert(status === 200, `상태 ${status}`)
    assert(data[0]?.name === originalName, '원복 실패')
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// T6. 타인 데이터 수정 차단 (RLS 격리)
// ══════════════════════════════════════════════════════════════════════════════
section('T6. RLS — 타인 데이터 수정 차단')

if (!userToken || !brokerToken) {
  log('⏭️', '타인 격리 테스트 SKIP — 양쪽 계정 로그인 필요')
  skip += 2
} else {
  await test('사용자가 중개사 프로필 수정 → 거부 또는 0건 수정', async () => {
    const { status, data } = await supaRest(`/profiles?id=eq.${brokerUid}`, {
      method: 'PATCH',
      token: userToken,
      body: { name: '해킹시도' },
    })
    const ok = status === 403 || status === 401 || (Array.isArray(data) && data.length === 0)
    assert(ok, `타인 수정이 허용됨: status=${status}, data=${JSON.stringify(data)}`)
  })

  await test('중개사가 사용자 프로필 수정 → 거부 또는 0건 수정', async () => {
    const { status, data } = await supaRest(`/profiles?id=eq.${userUid}`, {
      method: 'PATCH',
      token: brokerToken,
      body: { name: '해킹시도' },
    })
    const ok = status === 403 || status === 401 || (Array.isArray(data) && data.length === 0)
    assert(ok, `타인 수정이 허용됨: status=${status}, data=${JSON.stringify(data)}`)
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// T7. API 라우트 — auto-fill 인증 체크
// ══════════════════════════════════════════════════════════════════════════════
section('T7. API 라우트 인증')

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

await test('auto-fill API — 비인증 요청 → 401', async () => {
  const res = await fetch(`${BASE_URL}/api/properties/auto-fill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: '서울특별시 강남구 역삼동 123' }),
  }).catch(() => null)

  if (!res) {
    log('⏭️', 'auto-fill API SKIP — 로컬 서버 미실행 (로컬 dev 서버 기동 후 재실행)')
    skip++
    return
  }
  assert(res.status === 401, `예상 401인데 ${res.status}`)
})

// ══════════════════════════════════════════════════════════════════════════════
// T8. 데이터 무결성 검증
// ══════════════════════════════════════════════════════════════════════════════
section('T8. 데이터 무결성')

if (!brokerToken) {
  log('⏭️', 'T8 broker_profiles SKIP — 중개사 로그인 필요')
  log('⏭️', 'T8 proposals 참조 무결성 SKIP — 중개사 로그인 필요')
  skip += 2
} else {
  await test('broker_profiles — user_id 필드 존재 확인', async () => {
    const { status, data } = await supaRest('/broker_profiles?select=id,user_id&limit=1', { token: brokerToken })
    assert(status === 200, `상태 ${status}`)
    if (Array.isArray(data) && data.length > 0) {
      assert('user_id' in data[0], 'user_id 필드 없음')
    }
  })

  await test('proposals — request_id 참조 무결성 (없는 ID 거부)', async () => {
    const { status } = await supaRest('/proposals', {
      method: 'POST',
      token: brokerToken,
      body: {
        request_id: '00000000-0000-0000-0000-999999999999',
        price: 10000,
        property_address: '테스트',
        description: '참조 무결성 테스트',
      },
    })
    assert(status === 409 || status === 422 || status === 400 || status === 403,
      `외래키 위반이 허용됨: ${status}`)
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// 결과 요약
// ══════════════════════════════════════════════════════════════════════════════

const total = pass + fail + skip
console.log('\n' + '═'.repeat(55))
console.log(`통합 테스트 결과: ${pass}/${total} 통과 | ❌ ${fail}건 실패 | ⏭️ ${skip}건 스킵`)
console.log('═'.repeat(55))

if (fail > 0) {
  console.log('\n실패 목록:')
  results.filter(r => r.icon === '❌').forEach(r => console.log(`  • ${r.label}`))
  process.exit(1)
}
