#!/usr/bin/env node
// geocode-updates.sql 의 UPDATE 문들을 (id, lat, lng) INSERT VALUES 한 줄로 압축.
import { readFileSync, writeFileSync } from 'node:fs'
const path = process.argv[2]
const out = process.argv[3]
if (!path || !out) { console.error('usage: compact-updates.mjs <in.sql> <out.sql>'); process.exit(1) }

const src = readFileSync(path, 'utf8')
const pairs = []
const re = /UPDATE broker_properties SET lat=([-\d.]+), lng=([-\d.]+) WHERE id IN \(([^)]+)\)/g
let m
while ((m = re.exec(src)) !== null) {
  const lat = m[1], lng = m[2]
  const ids = m[3].split(',').map(s => s.trim().replace(/^'|'$/g, ''))
  for (const id of ids) pairs.push(`('${id}'::uuid, ${lat}, ${lng})`)
}
console.error(`총 ${pairs.length} 행 압축됨`)

// 한 번에 다 처리 — 단일 트랜잭션
const sql = `WITH g(id, lat, lng) AS (VALUES\n${pairs.join(',\n')}\n)
UPDATE broker_properties bp SET lat=g.lat, lng=g.lng FROM g WHERE bp.id=g.id;`

writeFileSync(out, sql, 'utf8')
console.error(`출력: ${out} (${sql.length} chars)`)
