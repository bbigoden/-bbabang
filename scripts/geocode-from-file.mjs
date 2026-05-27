#!/usr/bin/env node
/**
 * 입력 파일에서 (id, address) 목록을 읽어 Kakao geocode 후
 * UPDATE SQL 문을 stdout으로 출력.
 *
 * 사용:
 *   node scripts/geocode-from-file.mjs <input.txt> > out.sql
 *
 * input.txt는 Supabase MCP execute_sql 결과 파일 (JSON 배열)
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

function loadEnvLocal() {
  const p = resolve(projectRoot, '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
loadEnvLocal()

const KAKAO_KEY = process.env.KAKAO_REST_KEY
if (!KAKAO_KEY) { console.error('KAKAO_REST_KEY missing'); process.exit(1) }

const inputPath = process.argv[2]
if (!inputPath) { console.error('usage: node geocode-from-file.mjs <input.txt>'); process.exit(1) }

// MCP 결과 파일은 outer JSON({"result": "...escaped JSON inside <untrusted-data> tags..."}) 형식.
// 1) outer JSON 파싱 → result 문자열 추출 (이때 \" \n 등 unescape됨)
// 2) result 문자열에서 inner JSON 배열 추출
let raw = readFileSync(inputPath, 'utf8')
let inner = raw
try {
  const outer = JSON.parse(raw)
  if (typeof outer?.result === 'string') inner = outer.result
} catch { /* outer JSON 아니면 raw 그대로 시도 */ }
const jsonMatch = inner.match(/\[\s*\{[\s\S]*\}\s*\]/)
if (!jsonMatch) { console.error('JSON 배열을 찾지 못함'); process.exit(1) }
const rows = JSON.parse(jsonMatch[0])
console.error(`총 ${rows.length}건 입력`)

function normalize(a) {
  return String(a || '')
    .replace(/\s+[0-9A-Za-z\-]+\s*동\s+/, ' ')
    .replace(/\s+[0-9\-]+\s*호\s*$/, '')
    .replace(/\s*[Bb]?\d+층\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function kakao(query, retries = 3) {
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&analyze_type=similar`
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `KakaoAK ${KAKAO_KEY}` } })
      if (res.status === 429 || res.status === 503) {
        await new Promise(r => setTimeout(r, 1500 * Math.pow(2, i)))
        continue
      }
      if (!res.ok) return null
      const j = await res.json()
      const d = j?.documents?.[0]
      if (!d) return null
      const lat = parseFloat(d.y), lng = parseFloat(d.x)
      if (!isFinite(lat) || !isFinite(lng)) return null
      return { lat, lng }
    } catch {
      if (i === retries) return null
      await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)))
    }
  }
  return null
}

// 1) 정규화 주소별 그룹화
const groups = new Map() // norm -> [id, id, ...]
for (const r of rows) {
  const n = normalize(r.address)
  if (!n) continue
  if (!groups.has(n)) groups.set(n, [])
  groups.get(n).push(r.id)
}
console.error(`고유 정규화 주소 ${groups.size}건 → Kakao 호출 예정`)

// 2) Kakao 호출 + UPDATE 출력
let ok = 0, fail = 0, idx = 0
for (const [norm, ids] of groups) {
  idx++
  const coords = await kakao(norm)
  if (coords) {
    ok += ids.length
    // 같은 좌표를 가진 id들을 한 UPDATE로 묶음
    const escIds = ids.map(id => `'${id}'`).join(',')
    console.log(`UPDATE broker_properties SET lat=${coords.lat}, lng=${coords.lng} WHERE id IN (${escIds});`)
    if (idx % 50 === 0) console.error(`  진행 ${idx}/${groups.size} (성공 ${ok}, 실패 ${fail})`)
  } else {
    fail += ids.length
    console.error(`  ✗ ${norm} — geocode 실패 (${ids.length}건 영향)`)
  }
  // Kakao 권장 ~5건/초 미만
  await new Promise(r => setTimeout(r, 220))
}
console.error(`\n완료: 성공 ${ok}건 / 실패 ${fail}건 / 카카오 호출 ${groups.size}회`)
