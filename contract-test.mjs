/**
 * API 계약 테스트 (Contract Test)
 * Supabase REST API 응답이 TypeScript 인터페이스와 일치하는지 검증
 * 실행: node contract-test.mjs
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY 환경변수가 필요합니다.')
  process.exit(1)
}

// ── 공통 ──────────────────────────────────────────────────────────────────────

let pass = 0, fail = 0
const failures = []

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
}

async function supaRest(path, token = null) {
  const headers = { apikey: ANON_KEY, 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { headers })
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

async function supaLogin(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  return data.access_token ? { token: data.access_token, uid: data.user?.id } : null
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function test(label, fn) {
  try {
    await fn()
    console.log(`  ✅ ${label}`)
    pass++
  } catch (e) {
    console.log(`  ❌ ${label} — ${e.message}`)
    fail++
    failures.push(label)
  }
}

// ── 스키마 검증 헬퍼 ──────────────────────────────────────────────────────────

function hasFields(obj, required, optional = []) {
  const all = [...required, ...optional]
  for (const f of required) {
    if (!(f in obj)) throw new Error(`필수 필드 누락: ${f}`)
  }
  for (const key of Object.keys(obj)) {
    if (!all.includes(key)) {
      // 경고만 (추가 필드는 허용)
    }
  }
}

function isType(val, type, field) {
  if (val === null || val === undefined) return // nullable 허용
  if (typeof val !== type) throw new Error(`${field}: 기대 ${type}, 실제 ${typeof val}`)
}

// ══════════════════════════════════════════════════════════════════════════════
// T1. profiles 테이블 스키마
// ══════════════════════════════════════════════════════════════════════════════
section('T1. profiles 스키마 검증')

const loginResult = process.env.TEST_USER_EMAIL
  ? await supaLogin(process.env.TEST_USER_EMAIL, process.env.TEST_USER_PASSWORD ?? '')
  : null

if (!loginResult) {
  console.log('  ⏭️  로그인 SKIP — TEST_USER_EMAIL/PASSWORD 미설정 (T1~T5 스킵)')
} else {
  const { token, uid } = loginResult

  await test('profiles — 필수 필드 존재', async () => {
    const { status, data } = await supaRest(`/profiles?id=eq.${uid}&select=*`, token)
    assert(status === 200, `HTTP ${status}`)
    assert(Array.isArray(data) && data.length > 0, '데이터 없음')
    const row = data[0]
    hasFields(row,
      ['id', 'email', 'role', 'created_at'],
      ['name', 'phone', 'updated_at']
    )
  })

  await test('profiles — 타입 검증', async () => {
    const { data } = await supaRest(`/profiles?id=eq.${uid}&select=id,email,name,phone,role,created_at`, token)
    const row = data?.[0]
    assert(row, '데이터 없음')
    isType(row.id, 'string', 'id')
    isType(row.email, 'string', 'email')
    isType(row.name, 'string', 'name')
    isType(row.phone, 'string', 'phone')
    isType(row.role, 'string', 'role')
    assert(['user', 'broker', 'admin'].includes(row.role), `role 값 비정상: ${row.role}`)
    isType(row.created_at, 'string', 'created_at')
    assert(!isNaN(Date.parse(row.created_at)), 'created_at ISO 날짜 아님')
  })

  // ── T2. request_posts ──────────────────────────────────────────────────────
  section('T2. request_posts 스키마 검증')

  await test('request_posts — 필수 필드 존재', async () => {
    const { status, data } = await supaRest('/request_posts?select=*&limit=1&order=created_at.desc', token)
    assert(status === 200, `HTTP ${status}`)
    if (!Array.isArray(data) || data.length === 0) {
      console.log('    (데이터 없음 — 스킵)')
      return
    }
    const row = data[0]
    hasFields(row,
      ['id', 'user_id', 'deal_type', 'room_type', 'city', 'district', 'min_price', 'max_price', 'status', 'created_at'],
      ['min_size', 'max_size', 'min_monthly', 'max_monthly', 'move_in_date', 'description', 'updated_at']
    )
  })

  await test('request_posts — status 값 범위', async () => {
    const { data } = await supaRest('/request_posts?select=status&limit=20&order=created_at.desc', token)
    const valid = new Set(['open', 'closed', 'matched'])
    for (const row of (data ?? [])) {
      assert(valid.has(row.status), `비정상 status: ${row.status}`)
    }
  })

  await test('request_posts — price 숫자 타입', async () => {
    const { data } = await supaRest('/request_posts?select=min_price,max_price&limit=5', token)
    for (const row of (data ?? [])) {
      if (row.min_price != null) isType(row.min_price, 'number', 'min_price')
      if (row.max_price != null) isType(row.max_price, 'number', 'max_price')
    }
  })

  // ── T3. proposals ──────────────────────────────────────────────────────────
  section('T3. proposals 스키마 검증')

  await test('proposals — 필수 필드 존재', async () => {
    const { status, data } = await supaRest('/proposals?select=*&limit=1&order=created_at.desc', token)
    assert(status === 200, `HTTP ${status}`)
    if (!Array.isArray(data) || data.length === 0) {
      console.log('    (데이터 없음 — 스킵)')
      return
    }
    const row = data[0]
    hasFields(row,
      ['id', 'request_id', 'broker_id', 'price', 'property_address', 'status', 'created_at'],
      ['description', 'updated_at']
    )
  })

  await test('proposals — status 값 범위', async () => {
    const { data } = await supaRest('/proposals?select=status&limit=20', token)
    const valid = new Set(['pending', 'accepted', 'rejected', 'cancelled'])
    for (const row of (data ?? [])) {
      assert(valid.has(row.status), `비정상 status: ${row.status}`)
    }
  })

  // ── T4. broker_properties ─────────────────────────────────────────────────
  section('T4. broker_properties 스키마 검증')

  await test('broker_properties — 필수 필드 존재', async () => {
    const { status, data } = await supaRest('/broker_properties?select=*&limit=1', token)
    assert(status === 200, `HTTP ${status}`)
    if (!Array.isArray(data) || data.length === 0) {
      console.log('    (데이터 없음 — 스킵)')
      return
    }
    const row = data[0]
    hasFields(row,
      ['id', 'broker_id', 'deal_type', 'room_type', 'address', 'price', 'status', 'created_at'],
      ['monthly_rent', 'management_fee', 'premium', 'size_pyeong', 'floor', 'total_floors',
       'options', 'description', 'images', 'assignee', 'brief_memo', 'memo', 'updated_at']
    )
  })

  await test('broker_properties — deal_type 값 범위', async () => {
    const { data } = await supaRest('/broker_properties?select=deal_type&limit=20', token)
    const valid = new Set(['매매', '전세', '월세'])
    for (const row of (data ?? [])) {
      assert(valid.has(row.deal_type), `비정상 deal_type: ${row.deal_type}`)
    }
  })

  await test('broker_properties — images 배열 타입', async () => {
    const { data } = await supaRest('/broker_properties?select=images&limit=5', token)
    for (const row of (data ?? [])) {
      if (row.images != null) {
        assert(Array.isArray(row.images), `images가 배열이 아님: ${typeof row.images}`)
      }
    }
  })

  await test('broker_properties — options 배열 타입', async () => {
    const { data } = await supaRest('/broker_properties?select=options&limit=5', token)
    for (const row of (data ?? [])) {
      if (row.options != null) {
        assert(Array.isArray(row.options), `options가 배열이 아님: ${typeof row.options}`)
      }
    }
  })

  // ── T5. 관계(JOIN) 응답 형태 ──────────────────────────────────────────────
  section('T5. 관계(JOIN) 응답 검증')

  await test('request_posts + profiles JOIN', async () => {
    const { status, data } = await supaRest('/request_posts?select=id,profiles(id,name)&limit=1', token)
    assert(status === 200, `HTTP ${status}`)
    if (Array.isArray(data) && data.length > 0) {
      assert('profiles' in data[0], 'profiles JOIN 필드 없음')
    }
  })

  await test('proposals + broker_profiles JOIN', async () => {
    const { status, data } = await supaRest('/proposals?select=id,broker_profiles(id,office_name)&limit=1', token)
    assert(status === 200, `HTTP ${status}`)
    if (Array.isArray(data) && data.length > 0) {
      assert('broker_profiles' in data[0], 'broker_profiles JOIN 필드 없음')
    }
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// T6. 공개 엔드포인트 (토큰 없이도 가능한 것)
// ══════════════════════════════════════════════════════════════════════════════
section('T6. 공개 엔드포인트 스키마')

await test('broker_profiles — 공개 조회 가능', async () => {
  const { status, data } = await supaRest('/broker_profiles?select=id,office_name,district,is_verified,rating,review_count&limit=1')
  assert(status === 200, `HTTP ${status}`)
  if (Array.isArray(data) && data.length > 0) {
    hasFields(data[0], ['id'], ['office_name', 'district', 'is_verified', 'rating', 'review_count'])
    if (data[0].rating != null) isType(data[0].rating, 'number', 'rating')
    if (data[0].review_count != null) isType(data[0].review_count, 'number', 'review_count')
  }
})

await test('reviews — 공개 조회 가능', async () => {
  const { status, data } = await supaRest('/reviews?select=id,broker_id,rating,content,created_at&limit=1')
  assert(status === 200, `HTTP ${status}`)
  if (Array.isArray(data) && data.length > 0) {
    hasFields(data[0], ['id', 'broker_id', 'rating'], ['content', 'created_at'])
    isType(data[0].rating, 'number', 'rating')
    assert(data[0].rating >= 1 && data[0].rating <= 5, `rating 범위 초과: ${data[0].rating}`)
  }
})

// ══════════════════════════════════════════════════════════════════════════════
// 결과
// ══════════════════════════════════════════════════════════════════════════════

const total = pass + fail
console.log('\n' + '═'.repeat(55))
console.log(`API 계약 테스트: ${pass}/${total} 통과 | ❌ ${fail}건 실패`)
if (failures.length > 0) {
  console.log('\n실패 목록:')
  failures.forEach(f => console.log(`  • ${f}`))
}
console.log('═'.repeat(55))
if (fail > 0) process.exit(1)
