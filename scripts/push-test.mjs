// 점검용 푸시 도달 테스트 — 지정 이메일 사용자의 구독으로 테스트 알림 발송.
// 사용법: npm run push:test  (기본 대상: 대표 계정)
//         node scripts/push-test.mjs someone@example.com
// 수신 확인은 수동: 폰/PC에 "빠방 점검 테스트" 알림이 왔는지 확인.
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const get = k => process.env[k] ?? (env.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim()

const URL_ = get('NEXT_PUBLIC_SUPABASE_URL')
const ANON = get('NEXT_PUBLIC_SUPABASE_ANON_KEY')
const email = process.argv[2] || 'bigodennn@gmail.com'

webpush.setVapidDetails(get('VAPID_SUBJECT') || 'mailto:bigodennn@gmail.com',
  get('NEXT_PUBLIC_VAPID_PUBLIC_KEY'), get('VAPID_PRIVATE_KEY'))

// 본인 구독은 RLS로 본인만 조회 가능 → 대상 계정 로그인 필요.
// 점검 계정 비번은 로컬에서만: PUSH_TEST_PASSWORD env 또는 인자로 받지 않고 고정 안내.
const password = process.env.PUSH_TEST_PASSWORD
if (!password) {
  console.error('[push-test] PUSH_TEST_PASSWORD 환경변수로 대상 계정 비밀번호를 넘기세요.')
  console.error('  예: $env:PUSH_TEST_PASSWORD="..."; npm run push:test')
  process.exit(2)
}

const sb = createClient(URL_, ANON, { auth: { persistSession: false } })
const { error: authErr } = await sb.auth.signInWithPassword({ email, password })
if (authErr) { console.error('[push-test] 로그인 실패:', authErr.message); process.exit(1) }

const { data: subs, error } = await sb.from('push_subscriptions').select('*')
if (error) { console.error('[push-test] 구독 조회 실패:', error.message); process.exit(1) }
if (!subs?.length) { console.log('[push-test] 이 계정에 푸시 구독이 없습니다.'); process.exit(0) }

let ok = 0, fail = 0
for (const s of subs) {
  const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }
  try {
    await webpush.sendNotification(sub, JSON.stringify({
      title: '빠방 점검 테스트', body: `푸시 도달 확인 (${new Date().toLocaleString('ko-KR')})`, url: '/',
    }))
    ok++
  } catch (e) {
    fail++
    console.log(`  실패(${e.statusCode ?? '?'}): ${s.endpoint.slice(0, 60)}… — 410/404면 만료 구독`)
  }
}
console.log(`[push-test] ${email}: 발송 성공 ${ok} / 실패 ${fail} (총 구독 ${subs.length})`)
console.log('  → 기기에서 "빠방 점검 테스트" 알림 수신을 직접 확인하세요.')
await sb.auth.signOut()
