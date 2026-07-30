#!/usr/bin/env node
/**
 * broker_properties 좌표 백필.
 *
 * 카카오 REST geocode API로 lat/lng가 비어있는 매물 주소를 변환해 저장.
 * 같은 정규화 주소(호수·층·동수 제거)는 1번만 호출하고 동일 좌표 부여 — Kakao 호출 최소화.
 *
 * 환경변수 (.env.local 또는 쉘):
 *   - SUPABASE_URL                 또는 NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY    (RLS 무시하고 모든 매물 업데이트)
 *     └ 없으면 fallback: NEXT_PUBLIC_SUPABASE_ANON_KEY + PUSH_TEST_PASSWORD로
 *       대표 계정(t2@gmail.com, BACKFILL_LOGIN_EMAIL로 변경 가능) 로그인 —
 *       RLS can_edit_broker_property(사무소 단위)로 전 매물 업데이트 가능
 *   - KAKAO_REST_KEY
 *
 * 실행:
 *   node scripts/backfill-geocode.mjs
 *   node scripts/backfill-geocode.mjs --dry-run        # 변경 없이 미리보기
 *   node scripts/backfill-geocode.mjs --force          # lat/lng 이미 있어도 재조회
 *   node scripts/backfill-geocode.mjs --limit 100      # 처음 N건만
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

// .env.local 직접 로드 (Next.js 외부 스크립트라 dotenv 안 씀)
function loadEnvLocal() {
  const path = resolve(projectRoot, '.env.local')
  if (!existsSync(path)) return
  const raw = readFileSync(path, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/i)
    if (!m) continue
    if (!process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FORCE = args.includes('--force')
const limitIdx = args.indexOf('--limit')
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const KAKAO_KEY = process.env.KAKAO_REST_KEY
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const LOGIN_EMAIL = process.env.BACKFILL_LOGIN_EMAIL || 't2@gmail.com'
const LOGIN_PASSWORD = process.env.PUSH_TEST_PASSWORD

if (!SUPABASE_URL || (!SERVICE_KEY && !(ANON_KEY && LOGIN_PASSWORD))) {
  console.error('❌ SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY+PUSH_TEST_PASSWORD) 가 필요합니다.')
  process.exit(1)
}
if (!KAKAO_KEY) {
  console.error('❌ KAKAO_REST_KEY 가 설정되어야 합니다.')
  process.exit(1)
}

const supa = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY, { auth: { persistSession: false } })

// 서비스 롤 키 없으면 대표 계정 로그인 — RLS can_edit_broker_property(사무소 단위)로 전 매물 업데이트
if (!SERVICE_KEY) {
  const { error: authErr } = await supa.auth.signInWithPassword({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD })
  if (authErr) {
    console.error(`❌ ${LOGIN_EMAIL} 로그인 실패: ${authErr.message}`)
    process.exit(1)
  }
  console.log(`🔑 서비스 롤 키 없음 → ${LOGIN_EMAIL} 계정 로그인 (RLS 모드)`)
}

// 매물장 page.tsx 및 /api/geocode와 동일한 정규화
// 끝 콤마·구두점 먼저 제거 — "두정동 913 202," 같은 입력 데이터 대응
function normalizeAddr(a) {
  return String(a || '')
    .trim()
    .replace(/[,.;]+$/, '')
    .replace(/\s+[0-9A-Za-z\-]+\s*동\s+/, ' ')
    .replace(/\s+[0-9\-]+\s*호\s*$/, '')
    .replace(/\s*[Bb]?\d+층\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function kakaoGeocode(query, retries = 3) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&analyze_type=similar`
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } })
      if (res.status === 429 || res.status === 503) {
        const wait = 1000 * Math.pow(2, attempt)
        console.warn(`  ⏳ rate-limit (${res.status}), ${wait}ms 후 재시도`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) return null
      const json = await res.json()
      const doc = json?.documents?.[0]
      if (!doc) return null
      const lat = parseFloat(doc.y)
      const lng = parseFloat(doc.x)
      if (!isFinite(lat) || !isFinite(lng)) return null
      return { lat, lng }
    } catch (e) {
      if (attempt === retries) return null
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }
  return null
}

async function main() {
  console.log(`📍 매물 좌표 백필 시작 ${DRY_RUN ? '(DRY RUN)' : ''} ${FORCE ? '(FORCE)' : ''}`)

  // 좌표 없는 매물 조회 (FORCE면 전체)
  let query = supa
    .from('broker_properties')
    .select('id, address, lat, lng')
    .not('address', 'is', null)
    .neq('address', '')
  if (!FORCE) query = query.or('lat.is.null,lng.is.null')

  const { data: rows, error } = await query
  if (error) { console.error('조회 실패:', error); process.exit(1) }
  if (!rows?.length) { console.log('✅ 백필할 매물 없음'); return }

  const targets = rows.slice(0, LIMIT)
  console.log(`총 ${targets.length}건 대상 (전체 lat/lng 비어있음: ${rows.length}건)`)

  // 정규화 주소 → 좌표 캐시 (같은 건물 다른 호수는 1회만 호출)
  const cache = new Map()
  let okCount = 0, failCount = 0, cacheHit = 0
  const failures = []  // { id, address, norm, reason } — 수기 확인용 목록

  for (let i = 0; i < targets.length; i++) {
    const row = targets[i]
    const norm = normalizeAddr(row.address)
    if (!norm) {
      failCount++
      failures.push({ id: row.id, address: row.address, norm, reason: '빈 주소(정규화 후)' })
      continue
    }

    let coords = cache.get(norm)
    if (coords !== undefined) {
      cacheHit++
    } else {
      coords = await kakaoGeocode(norm)
      // 실패 시 fallback: "두정동 913 202"처럼 '호' 없는 끝 호수 숫자 제거 후 재시도
      // (앞에 지번 토큰이 남아있을 때만 — "불당동 1479" 같은 지번 자체는 건드리지 않음)
      if (!coords && /\d\s+\d+\s*$/.test(norm)) {
        const fallback = norm.replace(/\s+\d+\s*$/, '')
        await new Promise(r => setTimeout(r, 220))
        coords = await kakaoGeocode(fallback)
        if (coords) console.log(`  ↩ fallback 성공: "${norm}" → "${fallback}"`)
      }
      cache.set(norm, coords)
      // Kakao 권장 호출 간격 (~5건/초 미만) — 200ms 슬립
      await new Promise(r => setTimeout(r, 220))
    }

    const tag = `[${i + 1}/${targets.length}]`
    if (coords) {
      okCount++
      if (DRY_RUN) {
        console.log(`${tag} ✓ ${norm} → ${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`)
      } else {
        const { error: upErr } = await supa
          .from('broker_properties')
          .update({ lat: coords.lat, lng: coords.lng })
          .eq('id', row.id)
        if (upErr) {
          failCount++; okCount--
          failures.push({ id: row.id, address: row.address, norm, reason: `update 실패: ${upErr.message}` })
          console.error(`${tag} ✗ update 실패: ${row.id} — ${upErr.message}`)
        } else {
          console.log(`${tag} ✓ ${norm} → ${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`)
        }
      }
    } else {
      failCount++
      failures.push({ id: row.id, address: row.address, norm, reason: 'geocode 실패 (카카오 결과 없음)' })
      console.log(`${tag} ✗ ${norm} — geocode 실패`)
    }
  }

  console.log('────────────────────────────────────────')
  console.log(`✅ 성공: ${okCount}건  (캐시 hit ${cacheHit}건)`)
  console.log(`❌ 실패: ${failCount}건`)
  console.log(`📞 카카오 호출: ${cache.size}건 (정규화 주소 기준)`)
  if (DRY_RUN) console.log('※ DRY RUN — DB 변경 없음')

  if (failures.length > 0) {
    console.log('')
    console.log('❌ 변환 실패 주소 목록 (수기 확인용) ─────────')
    for (const f of failures) {
      console.log(`  - [${f.id}] "${f.address}" → 정규화 "${f.norm}" (${f.reason})`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
