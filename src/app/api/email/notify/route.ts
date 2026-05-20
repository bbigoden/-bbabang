import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendEmail, emailTemplate, shouldSendEmail } from '@/lib/email-server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 인증된 사용자가 다른 사용자(또는 본인)에게 이메일 알림 발송.
 * 사용 시점: 새 제안·수락·거절 등 클라이언트가 알림 발생을 트리거할 때.
 *
 * POST { targetUserId, category, title, body, ctaUrl?, ctaLabel? }
 * - category: 'proposal' | 'message' | 'matching' | 'announcement' | ...
 * - 발신 인증된 사용자 한정, 시간당 30회 제한 (스팸 방지)
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { targetUserId?: string; category?: string; title?: string; body?: string; ctaUrl?: string; ctaLabel?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: '잘못된 요청' }, { status: 400 }) }
  if (!body.targetUserId || !body.title || !body.body || !body.category) {
    return NextResponse.json({ error: '필수 파라미터 누락' }, { status: 400 })
  }

  // Rate limit
  const allowed = await checkRateLimit(`user:${user.id}:email-notify`, 30, 3600)
  if (!allowed) return NextResponse.json({ error: '발송 횟수 제한 초과' }, { status: 429 })

  // 대상 사용자 email + preferences (service role로 조회 — 본인 이메일 외엔 RLS 막힘)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ ok: false, skipped: 'service_role_missing' })
  }
  const supa = createServiceClient(url, serviceKey)
  const { data: target } = await supa
    .from('profiles')
    .select('email, notification_preferences, account_status')
    .eq('id', body.targetUserId)
    .single()
  if (!target || !target.email) return NextResponse.json({ ok: false, skipped: 'no_email' })
  if (target.account_status === 'banned') return NextResponse.json({ ok: false, skipped: 'banned' })

  if (!shouldSendEmail(target.notification_preferences as any, body.category)) {
    return NextResponse.json({ ok: false, skipped: 'opted_out' })
  }

  const html = emailTemplate({
    title: body.title,
    preview: body.body.slice(0, 100),
    bodyHtml: body.body.replace(/\n/g, '<br>'),
    ctaLabel: body.ctaLabel,
    ctaUrl: body.ctaUrl,
  })

  const result = await sendEmail({
    to: target.email,
    subject: body.title,
    html,
    text: body.body,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
