// 건축물대장 대조에서 '확실한' 유형·면적만 대장 값으로 고친다 (2026-11-02, 옛 자동채움 버그로 들어간 값 바로잡기).
//   유형: '아파트'·'기타'로 적혔는데 대장이 상가·공장 등(숙박 제외)
//   면적: 호수나 층이 적힌 매물, 또는 우리 값이 대장의 딱 2배(옛 버그가 지하1층+지상1층을 합친 흔적)
//   빼는 것: 통건물·전체·단지내·통매 같은 묶음, 우리 값이 대장보다 작은 것
// 대조 뒤에 누가 이미 고쳤으면(지금 값이 대조 때와 다르면) 건드리지 않는다. 바꾼 것은 CSV 로 남긴다.
//   node scripts/apply-ledger-fix.mjs <대조 json>... [--write]
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
// --skip-area=323,745 — 미리보기에서 이상했던 것(호수를 잘못 읽음·대조 때와 결과가 다름)은 면적을 안 건드린다
const SKIP_AREA = new Set((process.argv.find(a => a.startsWith('--skip-area=')) ?? '').slice(12).split(',').filter(Boolean).map(Number))
const inputs = process.argv.slice(2).filter(a => !a.startsWith('--'))
const STATE = path.join(ROOT, '.playwright-auth', 'owner.json')
const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const deps = { seumKey: env.SEUM_API_KEY, kakaoKey: env.KAKAO_REST_KEY, mapRoomType: mapPurposeToRoomType }

const b = await chromium.launch(); const ctx = await b.newContext({ storageState: STATE }); const pg = await ctx.newPage()
await pg.goto('https://busojang.vercel.app/dashboard/broker', { waitUntil: 'domcontentloaded' }); await pg.waitForTimeout(3000)
let raw = (await ctx.cookies()).filter(c => c.name.startsWith('sb-') && c.name.includes('auth-token')).sort((a, c) => a.name.localeCompare(c.name)).map(c => decodeURIComponent(c.value)).join('')
if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8')
const token = JSON.parse(raw).access_token
await ctx.storageState({ path: STATE }); await b.close()
const rest = async (q, init = {}) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${q}`, { ...init, headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

const BUNDLE = /통건물|통매|전체|단지내|일부|,|·|~/
const picks = new Map()   // seq_no → { type?, area? }
for (const f of inputs) for (const x of JSON.parse(fs.readFileSync(f, 'utf8'))) {
  for (const note of x.메모.split(' · ')) {
    const p = picks.get(x.번호) ?? { addr: x.주소 }
    if (note.startsWith('유형')) {
      const ours = note.split("'")[1], theirs = note.split("'")[3]
      if (['아파트', '기타'].includes(ours) && !['단독/다가구', '기타', '숙박'].includes(theirs)) p.type = { ours, theirs }
    } else if (note.startsWith('면적')) {
      const [ours, theirs] = note.match(/[\d.]+(?=평)/g).map(Number)
      const { hos, floor } = splitAddressForAutoFill(x.주소)
      const twice = Math.abs(ours / theirs - 2) < 0.08
      if (BUNDLE.test(x.주소.replace(/\([^)]*\)/g, '')) && !(hos.length === 1)) continue
      if (ours < theirs) continue
      if (hos.length === 1 || floor != null || twice) p.area = { ours }
    }
    if (p.type || p.area) picks.set(x.번호, p)
  }
}
console.log('고칠 후보', picks.size)

const log = [['번호', '주소', '바꾼 것', '전', '후', '비고']]
let changed = 0
for (const [seq, p] of picks) {
  const [cur] = await rest(`broker_properties?select=id,seq_no,address,room_type,size_pyeong,area_supplied&seq_no=eq.${seq}&deleted_at=is.null&status=eq.available`)
  if (!cur) { log.push([seq, p.addr, '-', '', '', '없음(지웠거나 계약됨)']); continue }
  if (cur.address !== p.addr) { log.push([seq, cur.address, '-', '', '', '대조 뒤 주소가 바뀜 — 건너뜀']); continue }
  const { addr, hos, floor } = splitAddressForAutoFill(cur.address)
  let d = null
  for (let k = 0; k < 2 && !d; k++) { try { const r = await lookupBuilding({ address: addr, ho: hos[0] ?? '', floor }, deps); if (r.status === 200) d = r.data } catch {} }
  if (!d) { log.push([seq, cur.address, '-', '', '', '대장 조회 실패']); continue }
  const upd = {}
  if (p.type) {
    if (cur.room_type !== p.type.ours) log.push([seq, cur.address, '유형', cur.room_type, '', '이미 고쳐짐 — 그대로'])
    else if (d.room_type && d.room_type === p.type.theirs) { upd.room_type = d.room_type; log.push([seq, cur.address, '유형', cur.room_type, d.room_type, '']) }
  }
  if (p.area && SKIP_AREA.has(seq)) log.push([seq, cur.address, '면적', cur.size_pyeong, '', '미리보기에서 이상해 뺌 — 직접 확인'])
  else if (p.area) {
    if (parseFloat(cur.size_pyeong) !== p.area.ours) log.push([seq, cur.address, '면적', cur.size_pyeong, '', '이미 고쳐짐 — 그대로'])
    else if (d.size_pyeong && String(d.size_pyeong) !== String(cur.size_pyeong)) {
      upd.size_pyeong = String(d.size_pyeong)
      // 공급면적: 대장에 있으면 대장 값, 없는데 남은 값이 전용보다 작으면(서로 안 맞음) 비운다
      if (d.size_pyeong_supplied) upd.area_supplied = Number(d.size_pyeong_supplied)
      else if (cur.area_supplied != null && cur.area_supplied < d.size_pyeong) upd.area_supplied = null
      log.push([seq, cur.address, '면적', `${cur.size_pyeong}평 (공급 ${cur.area_supplied ?? '-'})`, `${d.size_pyeong}평 (공급 ${upd.area_supplied ?? cur.area_supplied ?? '-'})`, ''])
    }
  }
  if (Object.keys(upd).length) {
    changed++
    if (WRITE) await rest(`broker_properties?id=eq.${cur.id}`, { method: 'PATCH', body: JSON.stringify(upd) })
  }
}
const out = path.join(ROOT, '.qa', `ledger-fix-${WRITE ? 'write' : 'dry'}-${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace(/[-:T]/g, '')}.csv`)
fs.writeFileSync(out, '﻿' + log.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'))
console.log(`${WRITE ? '저장함' : '보기만'} · 바꾼 매물 ${changed} · 기록 ${out}`)
for (const l of log.slice(1)) console.log(l.join(' | '))
