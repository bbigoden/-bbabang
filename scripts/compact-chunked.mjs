#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
const path = process.argv[2]
const outPrefix = process.argv[3]
const CHUNK = parseInt(process.argv[4] || '450', 10)

const src = readFileSync(path, 'utf8')
const pairs = []
const re = /UPDATE broker_properties SET lat=([-\d.]+), lng=([-\d.]+) WHERE id IN \(([^)]+)\)/g
let m
while ((m = re.exec(src)) !== null) {
  const lat = m[1], lng = m[2]
  const ids = m[3].split(',').map(s => s.trim().replace(/^'|'$/g, ''))
  for (const id of ids) pairs.push(`('${id}'::uuid, ${lat}, ${lng})`)
}
console.error(`총 ${pairs.length} 행`)

let chunkIdx = 0
for (let i = 0; i < pairs.length; i += CHUNK) {
  const slice = pairs.slice(i, i + CHUNK)
  const sql = `WITH g(id, lat, lng) AS (VALUES\n${slice.join(',\n')}\n)
UPDATE broker_properties bp SET lat=g.lat, lng=g.lng FROM g WHERE bp.id=g.id;`
  const outPath = `${outPrefix}-${chunkIdx}.sql`
  writeFileSync(outPath, sql, 'utf8')
  console.error(`${outPath}: ${slice.length} rows, ${sql.length} chars`)
  chunkIdx++
}
