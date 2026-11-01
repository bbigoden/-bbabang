// 면적 빈 거래가능 매물을 건축물대장 자동채움으로 한 번에 채운다 — 웹 [자동채움] 버튼과 같은 코드(src/lib/building-lookup.ts).
// 빈 칸만 채우고 이미 적힌 값은 건드리지 않는다. 바꾼 것은 전부 CSV 로 남긴다(되돌리기용).
//
//   node scripts/backfill-area.mjs            ← 무엇이 채워질지 보기만(저장 안 함)
//   node scripts/backfill-area.mjs --write    ← 저장
//
// 로그인은 사장님 저장 세션(.playwright-auth/owner.json, npm run login:save). 한 번에 하나만 돌릴 것.
// 2026-11-01: 자동채움이 5/28부터 '203호' 를 못 읽어 면적 빈 매물이 쌓인 것을 메우려고 만듦.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(ROOT, 'package.json'))
const { chromium } = require('@playwright/test')
const lib = f => import(pathToFileURL(path.join(ROOT, 'src', 'lib', f)).href)
const { lookupBuilding } = await lib('building-lookup.ts')
const { splitAddressForAutoFill } = await lib('auto-fill-address.ts')
const { mapPurposeToRoomType } = await lib('property-types.ts')

const WRITE = process.argv.includes('--write')
const STATE = path.join(ROOT, '.playwright-auth', 'owner.json')
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const deps = { seumKey: env.SEUM_API_KEY, kakaoKey: env.KAKAO_REST_KEY, mapRoomType: mapPurposeToRoomType }
if (!deps.seumKey || !deps.kakaoKey) throw new Error('.env.local 에 SEUM_API_KEY·KAKAO_REST_KEY 필요')

// 사장님 세션에서 접근 토큰을 꺼낸다(열면서 갱신된 세션은 다시 저장 — 갱신 토큰 재사용으로 세션이 끊기지 않게)
async function getToken() {
  const b = await chromium.launch()
  const ctx = await b.newContext({ storageState: STATE })
  const page = await ctx.newPage()
  await page.goto('https://bbabang.vercel.app/dashboard/broker', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  const parts = (await ctx.cookies()).filter(c => c.name.startsWith('sb-') && c.name.includes('auth-token')).sort((a, b) => a.name.localeCompare(b.name))
  let raw = parts.map(c => decodeURIComponent(c.value)).join('')
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8')
  await ctx.storageState({ path: STATE })
  await b.close()
  const t = JSON.parse(raw).access_token
  if (!t) throw new Error('로그인 세션이 없어요 — npm run login:save')
  return t
}
let token = await getToken(), tokenAt = Date.now()
const rest = async (q, init = {}) => {
  if (Date.now() - tokenAt > 40 * 60e3) { token = await getToken(); tokenAt = Date.now() }
  const r = await fetch(`${URL_}/rest/v1/${q}`, { ...init, headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

const rows = []
for (let from = 0; ; from += 1000) {
  const j = await rest(`broker_properties?select=id,seq_no,address,size_pyeong,area_supplied,total_floors,approval_date,parking,room_type&deleted_at=is.null&status=eq.available&order=seq_no.desc`, { headers: { Range: `${from}-${from + 999}` } })
  rows.push(...j)
  if (j.length < 1000) break
}
const blank = v => v == null || String(v).trim() === ''
// 동·읍·면·리·가 + 지번, 또는 도로명 + 번호가 있어야 시도한다 — '파푸 301-1802' 같은 별명은 엉뚱한 건물로 잡힐 수 있다
const legal = a => /(동|읍|면|리|가)\s*(산\s*)?\d/.test(a) || /(로|길)\s*\d/.test(a)
const targets = rows.filter(r => blank(r.size_pyeong) && r.area_supplied == null)
const tried = targets.filter(r => legal(r.address || ''))
console.log(`거래가능 ${rows.length} · 면적 빈칸 ${targets.length} · 주소로 시도 ${tried.length} · 별명 주소라 건너뜀 ${targets.length - tried.length}`)

const log = [['번호', '주소', '결과', '면적(전)', '면적(후)', '공급(후)', '층(후)', '유형(후)', '승인일(후)', '주차(후)', '호수']]
let filled = 0
for (const [i, r] of tried.entries()) {
  const { addr, hos, floor } = splitAddressForAutoFill(r.address)
  const results = []
  for (const ho of hos.length ? hos : ['']) {
    let res = null
    for (let k = 0; k < 2 && !res; k++) {   // 세움터가 가끔 SERVICETIMEOUT — 한 번 더
      try { res = await lookupBuilding({ address: addr, ho, floor }, deps) } catch { res = null }
    }
    if (res?.status === 200) results.push(res.data)
  }
  let note = '', upd = {}
  if (!results.length) note = '대장 못 찾음'
  else {
    const d = { ...results[0] }
    const m2 = results.reduce((s, x) => s + (Number(x.size_m2) || 0), 0)
    const m2s = results.reduce((s, x) => s + (Number(x.size_m2_supplied) || 0), 0)
    if (m2 > 0) d.size_pyeong = +(m2 / 3.305785).toFixed(2)
    if (m2s > 0) d.size_pyeong_supplied = +(m2s / 3.305785).toFixed(2)
    if (d.size_pyeong != null) upd.size_pyeong = String(d.size_pyeong)
    if (d.size_pyeong_supplied != null) upd.area_supplied = Number(d.size_pyeong_supplied)
    if (blank(r.total_floors) && d.total_floors != null) upd.total_floors = d.floor != null ? `${d.floor}/${d.total_floors}` : String(d.total_floors)
    if (blank(r.approval_date) && d.approval_date) upd.approval_date = d.approval_date
    if (blank(r.parking) && d.parking) upd.parking = d.parking
    if (blank(r.room_type) && d.room_type) upd.room_type = d.room_type
    note = upd.size_pyeong ? '면적 채움' : (hos.length ? '대장에 그 호수 없음' : '호수 없음(집합건물이면 호수 필요)')
  }
  if (upd.size_pyeong) filled++
  if (WRITE && Object.keys(upd).length) await rest(`broker_properties?id=eq.${r.id}`, { method: 'PATCH', body: JSON.stringify(upd) })
  log.push([r.seq_no, r.address, note, r.size_pyeong ?? '', upd.size_pyeong ?? '', upd.area_supplied ?? '', upd.total_floors ?? '', upd.room_type ?? '', upd.approval_date ?? '', upd.parking ?? '', hos.join('+')])
  if ((i + 1) % 20 === 0) console.log(`${i + 1}/${tried.length} · 면적 채움 ${filled}`)
}
const out = path.join(ROOT, '.qa', `backfill-area-${WRITE ? 'write' : 'dry'}-${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.csv`)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, '﻿' + log.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n'))
console.log(`${WRITE ? '저장함' : '보기만(저장 안 함)'} · 면적 채움 ${filled}/${tried.length} · 기록 ${out}`)
