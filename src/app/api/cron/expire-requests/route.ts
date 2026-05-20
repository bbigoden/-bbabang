import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push-server'

/**
 * 매일 1회 호출 (Vercel cron). vercel.json에 정의.
 * - 25일 이상 활성 요청 → 갱신 권유 알림 (한 번만)
 * - 30일 이상 활성 요청 → 자동 마감
 *
 * 인증: Vercel cron은 자동으로 헤더에 CRON_SECRET을 포함시킴.
 * 또는 Authorization: Bearer CRON_SECRET 검증.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  // Vercel cron은 Authorization: Bearer <CRON_SECRET>를 자동 추가
  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'service role missing' }, { status: 500 })
  }

  const supa = createServerClient(url, serviceKey)
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  // 25~30일 활성 요청 → 갱신 권유 (이미 알림 받은 건 제외)
  const renewalSince = new Date(now - 30 * day).toISOString()
  const renewalUntil = new Date(now - 25 * day).toISOString()
  const { data: renewalTargets } = await supa
    .from('request_posts')
    .select('id, user_id, city, district')
    .eq('status', 'active')
    .gte('created_at', renewalSince)
    .lte('created_at', renewalUntil)

  let renewalNotified = 0
  let renewalPushed = 0
  for (const r of renewalTargets ?? []) {
    // 이미 갱신 권유 알림을 받았는지 체크
    const { data: existing } = await supa
      .from('notifications')
      .select('id')
      .eq('user_id', r.user_id)
      .eq('type', 'request_renewal_reminder')
      .eq('link', `/request/${r.id}`)
      .limit(1)
      .maybeSingle()
    if (existing) continue

    const region = [r.city, r.district].filter(Boolean).join(' ') || '내'
    await supa.from('notifications').insert({
      user_id: r.user_id,
      type: 'request_renewal_reminder',
      title: '요청이 곧 마감돼요 ⏰',
      body: `'${region}' 요청이 5일 후 자동 마감됩니다. 아직 찾고 계시면 갱신해주세요.`,
      link: `/request/${r.id}`,
    })
    renewalNotified++

    try {
      const p = await sendPushToUser(r.user_id, {
        title: '요청이 곧 마감돼요',
        body: `'${region}' 요청이 5일 후 자동 마감됩니다.`,
        url: `/request/${r.id}`,
        tag: `renewal-${r.id}`,
      })
      renewalPushed += p.sent
    } catch {/* 푸시 실패 무시 */}
  }

  // 30일 이상 활성 요청 → 자동 마감
  const expireBefore = new Date(now - 30 * day).toISOString()
  const { data: expireTargets } = await supa
    .from('request_posts')
    .select('id, user_id, city, district')
    .eq('status', 'active')
    .lte('created_at', expireBefore)

  let expired = 0
  for (const r of expireTargets ?? []) {
    const { error } = await supa
      .from('request_posts')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', r.id)
    if (error) continue
    expired++

    const region = [r.city, r.district].filter(Boolean).join(' ') || '내'
    await supa.from('notifications').insert({
      user_id: r.user_id,
      type: 'request_expired',
      title: '요청이 자동 마감됐어요',
      body: `'${region}' 요청이 30일 경과로 마감됐어요. 다시 등록하면 새 제안을 받을 수 있어요.`,
      link: `/request/${r.id}`,
    })
  }

  return NextResponse.json({
    ok: true,
    renewalReminders: { matched: renewalTargets?.length ?? 0, notified: renewalNotified, pushed: renewalPushed },
    expired,
  })
}
