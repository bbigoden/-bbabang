import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push-server'

/**
 * 매일 아침 1회 호출 (Vercel cron, vercel.json 정의).
 * 오늘 시작하는 일정 중 알림(remind_minutes != null)이 켜진 일정을
 * 작성자에게 푸시 + notifications 기록. 하루 1회 cron이라 "당일 아침 요약" 방식.
 *
 * 인증: Authorization: Bearer CRON_SECRET (expire-requests와 동일).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[cron/event-reminders] 서버 설정 누락')
    return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  }

  const supa = createServerClient(url, serviceKey)

  // KST(UTC+9) 기준 '오늘' 00:00 ~ 24:00 범위를 UTC로 환산
  const KST_OFFSET = 9 * 60 * 60 * 1000
  const nowKst = new Date(Date.now() + KST_OFFSET)
  const y = nowKst.getUTCFullYear(), m = nowKst.getUTCMonth(), d = nowKst.getUTCDate()
  const dayStart = new Date(Date.UTC(y, m, d) - KST_OFFSET)        // 오늘 00:00 KST in UTC
  const dayEnd = new Date(Date.UTC(y, m, d + 1) - KST_OFFSET)      // 내일 00:00 KST in UTC

  // 오늘 시작 + 알림 켜짐 + 아직 미발송
  const { data: events } = await supa
    .from('office_events')
    .select('id, title, starts_at, all_day, created_by, location')
    .not('remind_minutes', 'is', null)
    .is('reminded_at', null)
    .gte('starts_at', dayStart.toISOString())
    .lt('starts_at', dayEnd.toISOString())

  let pushed = 0
  let notified = 0
  const reminded: string[] = []

  for (const e of events ?? []) {
    if (!e.created_by) { reminded.push(e.id); continue }
    // created_by(broker_profiles.id) → user_id 조회
    const { data: bp } = await supa
      .from('broker_profiles')
      .select('user_id')
      .eq('id', e.created_by)
      .maybeSingle()
    const userId = bp?.user_id
    if (!userId) { reminded.push(e.id); continue }

    const timeLabel = e.all_day
      ? '오늘'
      : `오늘 ${String(new Date(new Date(e.starts_at).getTime() + KST_OFFSET).getUTCHours()).padStart(2, '0')}:${String(new Date(new Date(e.starts_at).getTime() + KST_OFFSET).getUTCMinutes()).padStart(2, '0')}`
    const body = `${timeLabel} · ${e.title}${e.location ? ` (${e.location})` : ''}`

    // 인앱 알림
    const { error: nErr } = await supa.from('notifications').insert({
      user_id: userId,
      type: 'event_reminder',
      title: '오늘 일정 알림 📅',
      body,
      link: '/broker/schedule',
    })
    if (!nErr) notified++

    // 푸시
    try {
      const p = await sendPushToUser(userId, {
        title: '오늘 일정 알림',
        body,
        url: '/broker/schedule',
        tag: `event-${e.id}`,
      })
      pushed += p.sent
    } catch {/* 푸시 실패 무시 */}

    reminded.push(e.id)
  }

  // 발송 완료 표시 (중복 방지)
  if (reminded.length > 0) {
    await supa.from('office_events').update({ reminded_at: new Date().toISOString() }).in('id', reminded)
  }

  return NextResponse.json({ ok: true, matched: events?.length ?? 0, notified, pushed })
}
