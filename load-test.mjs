/**
 * 부하 테스트 (Load Test)
 * autocannon으로 주요 공개 엔드포인트 성능 측정
 * 실행: node load-test.mjs
 *
 * 주의: 프로덕션 서버(Vercel) 대상 시 연결 수를 낮게 유지
 */

import autocannon from 'autocannon'
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

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://bbabang.vercel.app'

// 성능 기준 (p99 응답시간 기준)
const THRESHOLDS = {
  p99: 3000,   // 3초 이내
  p95: 2000,   // 2초 이내
  errors: 0.05, // 오류율 5% 미만
}

const TARGETS = [
  { path: '/', name: '홈페이지' },
  { path: '/auth/login', name: '로그인 페이지' },
  { path: '/auth/signup', name: '회원가입 페이지' },
  { path: '/terms', name: '이용약관' },
]

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}`)
}

function ms(n) {
  return `${n.toFixed(0)}ms`
}

function runLoad(url, connections = 5, duration = 5) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url,
      connections,
      duration,
      timeout: 10,
      headers: {
        'user-agent': 'load-test/1.0',
      },
    }, (err, result) => {
      if (err) reject(err)
      else resolve(result)
    })
    autocannon.track(instance, { renderResultsTable: false })
  })
}

let pass = 0, fail = 0
const failures = []

console.log(`\n부하 테스트 대상: ${BASE}`)
console.log(`설정: 연결수 5, 각 ${5}초 지속`)

section('엔드포인트별 성능 측정')

for (const { path, name } of TARGETS) {
  const url = `${BASE}${path}`
  process.stdout.write(`  🔄 ${name} 측정 중...`)

  try {
    const result = await runLoad(url)

    const p95 = result.latency.p97_5   // autocannon은 p97.5 사용
    const p99 = result.latency.p99
    const rps = result.requests.mean
    const errorRate = result.errors / Math.max(result.requests.total, 1)
    const ok = p99 <= THRESHOLDS.p99 && p95 <= THRESHOLDS.p95 && errorRate <= THRESHOLDS.errors

    const latencyStr = `p95=${ms(p95)} p99=${ms(p99)}`
    const rpsStr = `${rps.toFixed(0)} RPS`
    const errStr = result.errors > 0 ? ` 오류=${result.errors}건` : ''

    process.stdout.write('\r')
    if (ok) {
      console.log(`  ✅ ${name} — ${latencyStr} | ${rpsStr}${errStr}`)
      pass++
    } else {
      const reasons = []
      if (p99 > THRESHOLDS.p99) reasons.push(`p99 ${ms(p99)} > ${ms(THRESHOLDS.p99)}`)
      if (p95 > THRESHOLDS.p95) reasons.push(`p95 ${ms(p95)} > ${ms(THRESHOLDS.p95)}`)
      if (errorRate > THRESHOLDS.errors) reasons.push(`오류율 ${(errorRate * 100).toFixed(1)}%`)
      console.log(`  ❌ ${name} — ${reasons.join(', ')} (${rpsStr})`)
      fail++
      failures.push({ name, p95, p99, errorRate, rps })
    }
  } catch (e) {
    process.stdout.write('\r')
    console.log(`  ❌ ${name} — ${e.message}`)
    fail++
    failures.push({ name, error: e.message })
  }
}

section('결과 요약')
const total = pass + fail
console.log(`부하 테스트: ${pass}/${total} 통과 | ❌ ${fail}건 실패`)
console.log(`기준: p95<${THRESHOLDS.p95}ms, p99<${THRESHOLDS.p99}ms, 오류율<${THRESHOLDS.errors * 100}%`)

if (failures.length > 0) {
  console.log('\n실패 항목:')
  for (const f of failures) {
    if (f.error) {
      console.log(`  • ${f.name}: ${f.error}`)
    } else {
      console.log(`  • ${f.name}: p95=${ms(f.p95)} p99=${ms(f.p99)} 오류율=${(f.errorRate * 100).toFixed(1)}%`)
    }
  }
}

console.log('═'.repeat(55))
if (fail > 0) process.exit(1)
