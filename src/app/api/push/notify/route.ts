import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push-server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 다른 사용자에게 푸시 알림 발송.
 * 인증된 사용자만 호출 가능 (스팸 방지).
 * 본인이 만든 행위(메시지/제안)의 결과로 상대방에게 알림 보내는 용도.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { targetUserId: string; title: string; body: string; url?: string; tag?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })
  }

  if (!body.targetUserId || !body.title || !body.body) {
    return NextResponse.json({ error: '필수 필드 누락' }, { status: 400 })
  }

  // 자기 자신에게는 알림 안 보냄 (불필요)
  if (body.targetUserId === user.id) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 'self' })
  }

  // 화이트리스트 검증: chat_room/사무소/proposal 관계 있을 때만 허용 (P1-3)
  const { data: allowedRelation } = await supabase.rpc('can_notify_user', {
    p_target_user_id: body.targetUserId,
  })
  if (allowedRelation !== true) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 'no_relation' })
  }

  // Rate limit: 사용자당 분당 30회 (스팸 방지). 푸시는 strict — DB 장애 시 차단.
  const allowed = await checkRateLimit(`user:${user.id}:push-notify`, 30, 60, true)
  if (!allowed) {
    return NextResponse.json({ error: '알림 호출 제한 초과' }, { status: 429 })
  }

  try {
    const result = await sendPushToUser(body.targetUserId, {
      title: body.title,
      body: body.body,
      url: body.url,
      tag: body.tag,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[push/notify] error', e)
    return NextResponse.json({ error: '발송 실패' }, { status: 500 })
  }
}
