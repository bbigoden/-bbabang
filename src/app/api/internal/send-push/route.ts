import { NextRequest, NextResponse } from 'next/server'
import { sendPushToUser } from '@/lib/push-server'

/**
 * DB 트리거 등 내부 시스템에서 호출하는 푸시 발송 엔드포인트.
 * INTERNAL_PUSH_SECRET 환경변수와 일치하는 x-internal-secret 헤더가 있어야 통과.
 * 사용자 인증/관계 검증을 건너뛰므로 절대 외부 노출 금지.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_PUSH_SECRET
  if (!secret) {
    console.error('[internal/send-push] INTERNAL_PUSH_SECRET 미설정')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  if (req.headers.get('x-internal-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { targetUserId: string; title: string; body: string; url?: string; tag?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (!body.targetUserId || !body.title || !body.body) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
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
    console.error('[internal/send-push] error', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
