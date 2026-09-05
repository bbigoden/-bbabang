import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push-server'
import { fmtComma, validUntil } from '@/lib/estimate'
import { todayKST } from '@/lib/date-kst'

/**
 * 매일 1회 (Vercel cron). 보낸 견적서의 유효기간이 다가오면 알린다.
 *
 * 보낸 뒤 답이 없는 채로 기간이 지나 버리는 일이 흔하다. 만료 3일 전에 한 번
 * 알려 다시 연락할 기회를 준다. 이미 알린 건은 다시 알리지 않는다.
 *
 * 인증은 다른 cron 과 같다 — Authorization: Bearer CRON_SECRET.
 */

const NOTICE_DAYS = 3

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[cron/estimate-expiry] 서버 설정 누락')
    return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  }

  const supa = createServerClient(url, serviceKey)

  // 아직 결론나지 않은 견적서만 본다 (수주·실주는 만료를 따지지 않는다)
  const { data: rows, error } = await supa
    .from('estimates')
    .select('id, owner_broker_id, estimate_no, issue_date, valid_days, client_name, project_name, total, expiry_notified_at')
    .in('status', ['draft', 'sent'])
    .is('expiry_notified_at', null)
  if (error) {
    console.error('[cron/estimate-expiry] 조회 실패', error)
    return NextResponse.json({ error: 'query_failed' }, { status: 500 })
  }

  // Vercel 서버는 UTC 로 돈다. 로컬 시간으로 오늘을 세면 한국 아침에는 어제가
  // 나와 알림이 하루 어긋난다. 사장님이 보는 날짜(한국)로 센다.
  const todayStr = todayKST()
  const limitStr = validUntil(todayStr, NOTICE_DAYS)

  // 만료일이 오늘~3일 뒤 사이인 건
  const due = (rows ?? []).filter(r => {
    const until = validUntil(r.issue_date, r.valid_days)
    return until >= todayStr && until <= limitStr
  })

  let sent = 0
  for (const r of due) {
    // owner_broker_id → user_id 를 찾아 그 사람에게 보낸다
    const { data: bp } = await supa
      .from('broker_profiles').select('user_id').eq('id', r.owner_broker_id).maybeSingle()
    if (!bp?.user_id) continue

    const until = validUntil(r.issue_date, r.valid_days)
    const ok = await sendPushToUser(bp.user_id, {
      title: '견적서 유효기간이 곧 끝납니다',
      body: `${r.client_name || '거래처'} · ${r.project_name || r.estimate_no} (${fmtComma(r.total)}원) — ${until}까지`,
      url: `/broker/estimates/${r.id}`,
    }).catch(() => false)

    // 보냈든 못 보냈든 표시해 둔다 — 매일 같은 건으로 재시도하지 않게
    await supa.from('estimates').update({ expiry_notified_at: new Date().toISOString() }).eq('id', r.id)
    if (ok) sent++
  }

  return NextResponse.json({ ok: true, checked: rows?.length ?? 0, due: due.length, sent })
}
