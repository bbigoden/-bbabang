// 부소장 DB 논리 백업 — public 스키마 전 테이블을 NDJSON으로 로컬 저장.
// Supabase Free 플랜은 자동 백업이 없어 점검(21단계)마다 이 스크립트로 스냅샷을 뜬다.
//
// 사용법:
//   1) .env.local에 SUPABASE_DB_URL 추가 (Supabase 대시보드 > Settings > Database >
//      Connection string (URI, Session pooler 권장). 비밀번호 포함)
//   2) npm run backup:db
//
// 산출물: backups/YYYY-MM-DD_HHmm/<table>.ndjson + manifest.json (테이블별 행 수)
// backups/는 gitignore — 로컬 보관 전용. 민감 데이터이므로 외부 공유 금지.
import { readFileSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function readEnv(key) {
  if (process.env[key]) return process.env[key]
  try {
    const env = readFileSync(join(root, '.env.local'), 'utf8')
    const m = env.match(new RegExp(`^${key}=(.+)$`, 'm'))
    return m?.[1]?.trim()
  } catch { return undefined }
}

const dbUrl = readEnv('SUPABASE_DB_URL')
if (!dbUrl) {
  console.error('[backup] SUPABASE_DB_URL이 없습니다. .env.local에 추가하세요.')
  console.error('  Supabase 대시보드 > Settings > Database > Connection string (URI)')
  process.exit(2)
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
const outDir = join(root, 'backups', stamp)
mkdirSync(outDir, { recursive: true })

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await client.connect()

const { rows: tables } = await client.query(`
  SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)

const manifest = { created_at: new Date().toISOString(), tables: {} }
const PAGE = 2000

for (const { tablename } of tables) {
  const out = createWriteStream(join(outDir, `${tablename}.ndjson`))
  let offset = 0
  let count = 0
  for (;;) {
    // 페이지 경계 고정을 위해 PK 없이도 안정적인 ctid 대신 단순 OFFSET 사용
    // (스냅샷은 단일 커넥션 순차 실행이라 실질 문제 없음, 현재 최대 테이블 ~2천 행)
    const { rows } = await client.query(
      `SELECT to_jsonb(t) AS row FROM "${tablename}" t LIMIT $1 OFFSET $2`, [PAGE, offset])
    for (const r of rows) out.write(JSON.stringify(r.row) + '\n')
    count += rows.length
    if (rows.length < PAGE) break
    offset += PAGE
  }
  await new Promise(res => out.end(res))
  manifest.tables[tablename] = count
  console.log(`  ${tablename}: ${count}행`)
}

// 스토리지는 객체 목록만 기록 (파일 본체는 용량 문제로 제외 — 필요 시 별도)
const { rows: objects } = await client.query(
  `SELECT bucket_id, name, metadata->>'size' AS size, created_at FROM storage.objects ORDER BY bucket_id, name`)
writeFileSync(join(outDir, '_storage_objects.json'), JSON.stringify(objects, null, 1))
manifest.storage_objects = objects.length

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
await client.end()

const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0)
console.log(`[backup] 완료: ${tables.length}개 테이블 ${total}행 + 스토리지 목록 ${objects.length}건 → ${outDir}`)
