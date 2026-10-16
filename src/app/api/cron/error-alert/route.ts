import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient, type SupabaseClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push-server'

/**
 * 미확인 에러 자동 알림 — 웹 푸시로 보낸다.
 *
 * Vercel cron 이 매일 한 번 부른다(vercel.json '0 9 * * *' = UTC 09:00 = 한국 18:00).
 * - 보관 정책(90일 지난 로그 삭제)을 먼저 돌린다
 * - error_logs 중 alerted_at IS NULL 인 최근 7일치를 모아 같은 message 끼리 묶는다(스팸 방지)
 * - 관리자(profiles.role='admin') 전원 + internal_config 'error_alert_user_ids' 에게 요약 푸시
 * - 실제로 한 대라도 받았을 때만 alerted_at 을 찍는다
 *
 * 예전엔 메일(Resend)로 보냈는데 RESEND_API_KEY 가 끝내 등록되지 않아, 2026-06 부터
 * 251건 중 한 건도 나가지 않았다(alerted_at 전부 NULL). 실패하면 바로 500 으로 끝나서
 * 그 뒤에 있던 90일 보관 삭제도 한 번도 돌지 않았다. 그래서
 *  - 받을 길이 이미 있는 푸시로 바꿨고(사장님 폰에 구독 4대),
 *  - 삭제는 발송 결과와 상관없이 맨 앞에서 돌리고,
 *  - 하루 실패해도 다음 날 다시 잡히게 24시간 → 7일로 넓혔다(이미 알린 행은 다시 안 알린다).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const LOOKBACK_DAYS = 7
const RETENTION_DAYS = 90
// Supabase(PostgREST) 한 번에 돌려주는 최대 행 수. 넘치는 건 표시하지 않고 다음 실행에 넘긴다.
const FETCH_LIMIT = 1000
// .in('id', …) 은 주소창(쿼리스트링)에 실리므로 uuid 를 잘라 보낸다 — 수백 개면 URL 길이 제한에 걸린다.
const MARK_CHUNK = 100
const TOP_GROUPS = 3
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[cron/error-alert] 서버 설정 누락')
    return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  }
  const supa = createServerClient(url, serviceKey)

  // 1) 보관 정책: 90일 지난 로그 삭제 (무한 적재 방지).
  //    발송 뒤에 두었더니 발송이 늘 실패해 한 번도 안 돌았다 → 발송과 무관하게 먼저 돌린다.
  const retentionCutoff = new Date(Date.now() - RETENTION_DAYS * DAY_MS).toISOString()
  const { count: purgedCount, error: purgeErr } = await supa
    .from('error_logs')
    .delete({ count: 'exact' })
    .lt('created_at', retentionCutoff)
  if (purgeErr) console.error('[cron/error-alert] purge failed', purgeErr)
  const purged = purgeErr ? null : (purgedCount ?? 0)

  // 2) 아직 안 알린 에러 (최근 7일). 하루 발송이 실패해도 다음 실행에서 다시 잡힌다.
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString()
  const { data: unalerted, count: totalCount, error } = await supa
    .from('error_logs')
    .select('id, message, source, user_id', { count: 'exact' })
    .is('alerted_at', null)
    .eq('status', 'open')  // 관리자가 이미 처리(무시·해결)한 건 다시 알리지 않는다
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(FETCH_LIMIT)

  if (error) {
    console.error('[cron/error-alert] select failed', error)
    return NextResponse.json({ ok: false, error: 'db_error', purged }, { status: 500 })
  }
  if (!unalerted || unalerted.length === 0) {
    return NextResponse.json({ ok: true, errors: 0, sent: 0, reason: 'no_new_errors', purged })
  }

  // 같은 message 끼리 묶는다 — 한 버그가 수십 번 찍혀도 한 줄로 보이게
  // error_logs 는 비로그인 화면도 쓸 수 있어 message 를 누구나 지어 넣을 수 있다. 그 글이 사장님
  // 폰 잠금화면에 그대로 뜨지 않게, 로그인한 사용자 화면에서 난 오류만 문구를 보이고 나머지는
  // 종류(source)만 적는다.
  const groups = new Map<string, { n: number; source: string | null; fromUser: boolean }>()
  for (const e of unalerted) {
    const key = (e.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || '(메시지 없음)'
    const g = groups.get(key) ?? { n: 0, source: e.source ?? null, fromUser: false }
    g.n += 1
    if (e.user_id) g.fromUser = true
    groups.set(key, g)
  }
  const ranked = Array.from(groups.entries()).sort((a, b) => b[1].n - a[1].n)

  // 이번에 표시할 건 받아온 행까지. 넘친 건(FETCH_LIMIT 초과) 다음 실행에 다시 세므로 '+' 만 붙인다.
  const remaining = Math.max(0, (totalCount ?? unalerted.length) - unalerted.length)
  const title = `부소장 에러 ${unalerted.length}${remaining > 0 ? '+' : ''}건(${groups.size}종)`
  const lines = ranked.slice(0, TOP_GROUPS).map(([msg, g]) =>
    `${g.n}회 · ${g.fromUser ? clip(msg, 60) : (g.source ?? '오류')}`)
  if (ranked.length > TOP_GROUPS) lines.push(`외 ${ranked.length - TOP_GROUPS}종`)
  const payload = { title, body: lines.join('\n').slice(0, 200), url: '/admin/errors', tag: 'error-alert' }

  // 3) 받는 사람
  const { userIds, configError } = await loadRecipients(supa)
  if (userIds.length === 0) {
    console.error('[cron/error-alert] 받는 사람 없음', configError)
    return NextResponse.json({
      ok: false, reason: 'no_recipients', configError,
      errors: unalerted.length, remaining, groups: groups.size, purged,
    }, { status: 500 })
  }

  // 4) 푸시. 한 사람 실패(VAPID 누락 등 throw)가 나머지를 막지 않게 사람별로 감싼다.
  const deliveries = await Promise.all(userIds.map(async userId => {
    try {
      const r = await sendPushToUser(userId, payload)
      return { userId, sent: r.sent, failed: r.failed }
    } catch (e) {
      return { userId, sent: 0, failed: 0, error: e instanceof Error ? e.message : String(e) }
    }
  }))
  const sent = deliveries.reduce((s, d) => s + d.sent, 0)
  const failed = deliveries.reduce((s, d) => s + d.failed, 0)

  // 한 대도 못 받았으면 표시하지 않는다 — 다음 실행(7일 안)에서 다시 보낸다.
  // 구독 0개(sent 0, failed 0)도 '보냈다' 가 아니다. 예전 메일처럼 조용히 사라지면 안 된다.
  if (sent === 0) {
    const reason = deliveries.some(d => d.error || d.failed > 0) ? 'push_failed' : 'no_subscriptions'
    console.error('[cron/error-alert] 푸시 0건', reason, deliveries)
    return NextResponse.json({
      ok: false, reason, configError,
      errors: unalerted.length, remaining, groups: groups.size,
      recipients: userIds.length, sent, failed, deliveries, purged,
    }, { status: 500 })
  }

  // 5) 알린 행 표시. alerted_at IS NULL 조건을 다시 걸어 동시 실행이 있어도 시각을 덮어쓰지 않는다.
  const alertedAt = new Date().toISOString()
  const ids = unalerted.map(e => e.id)
  let alerted = 0
  let markError: string | undefined
  for (let i = 0; i < ids.length; i += MARK_CHUNK) {
    const { count, error: mErr } = await supa
      .from('error_logs')
      .update({ alerted_at: alertedAt }, { count: 'exact' })
      .in('id', ids.slice(i, i + MARK_CHUNK))
      .is('alerted_at', null)
    if (mErr) {
      // 표시가 안 되면 다음 실행에 같은 에러가 한 번 더 온다 — 놓치는 것보단 낫다
      console.error('[cron/error-alert] mark failed', mErr)
      markError = mErr.message
      break
    }
    alerted += count ?? 0
  }

  return NextResponse.json({
    ok: !markError, configError, markError,
    errors: unalerted.length, remaining, groups: groups.size,
    recipients: userIds.length, sent, failed, deliveries,
    alerted, purged,
  }, { status: markError ? 500 : 200 })
}

/**
 * 받는 사람 = 관리자(profiles.role='admin') 전원 ∪ internal_config 'error_alert_user_ids'(쉼표 구분).
 * 관리자 계정은 폰에 푸시 구독이 없어 관리자만으로는 아무도 못 받는다 → 대표 계정을 설정으로 더한다.
 * internal_config 는 RLS 정책이 없어 service_role 만 읽으므로 사용자가 수신자를 바꿀 수 없다.
 * 한쪽 조회가 실패해도 다른 쪽으로라도 보낸다.
 */
async function loadRecipients(supa: SupabaseClient): Promise<{ userIds: string[]; configError?: string }> {
  const [admins, config] = await Promise.all([
    supa.from('profiles').select('id').eq('role', 'admin'),
    supa.from('internal_config').select('value').eq('key', 'error_alert_user_ids').maybeSingle(),
  ])

  const ids = new Set<string>()
  const problems: string[] = []

  if (admins.error) problems.push(`profiles: ${admins.error.message}`)
  for (const p of admins.data ?? []) ids.add(String(p.id).toLowerCase())

  if (config.error) problems.push(`internal_config: ${config.error.message}`)
  for (const raw of String(config.data?.value ?? '').split(/[\s,]+/)) {
    if (UUID_RE.test(raw)) ids.add(raw.toLowerCase())
    else if (raw) problems.push(`internal_config: uuid 아님 '${raw.slice(0, 40)}'`)
  }

  return { userIds: Array.from(ids), configError: problems.length ? problems.join('; ') : undefined }
}

/** 푸시 본문 한 줄 — 알림창은 좁아서 긴 스택 메시지는 잘라 보인다 */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}
