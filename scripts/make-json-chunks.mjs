#!/usr/bin/env node
// UPDATE SQL을 JSON 배열 청크로 변환 → 작은 파일들에 분할 저장
// 각 청크는 SELECT json_array_elements(...) ... UPDATE 형태
import { readFileSync, writeFileSync } from 'node:fs'
const inPath = process.argv[2]
const outPrefix = process.argv[3]
const CHUNK = parseInt(process.argv[4] || '300', 10)

const src = readFileSync(inPath, 'utf8')
const pairs = []
const re = /UPDATE broker_properties SET lat=([-\d.]+), lng=([-\d.]+) WHERE id IN \(([^)]+)\)/g
let m
while ((m = re.exec(src)) !== null) {
  const lat = parseFloat(m[1]), lng = parseFloat(m[2])
  const ids = m[3].split(',').map(s => s.trim().replace(/^'|'$/g, ''))
  for (const id of ids) pairs.push({ id, lat, lng })
}
console.error(`총 ${pairs.length} 행`)

let chunkIdx = 0
for (let i = 0; i < pairs.length; i += CHUNK) {
  const slice = pairs.slice(i, i + CHUNK)
  const jsonStr = JSON.stringify(slice).replace(/'/g, "''") // SQL 문자열 이스케이프
  const sql = `UPDATE broker_properties bp
SET lat=(g->>'lat')::double precision,
    lng=(g->>'lng')::double precision
FROM json_array_elements('${jsonStr}'::json) AS g
WHERE bp.id = (g->>'id')::uuid;`
  const outPath = `${outPrefix}-${chunkIdx}.sql`
  writeFileSync(outPath, sql, 'utf8')
  console.error(`${outPath}: ${slice.length} rows, ${sql.length} chars`)
  chunkIdx++
}
