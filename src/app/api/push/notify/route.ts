import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push-server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 다른 사용자에게 푸시 알림 발송.
 * 인증된 사용자만 호출 가능 (스팸 방지).
 * 본인이 만든 행위(메시지/제안)의 결과로 상대방에게 알림 보내는 용도.
 *
 * 내용은 호출자가 정하므로 그대로 넘기지 않는다. 예전엔 url 을 검증하지 않아
 * 관계만 있으면(채팅 상대·같은 사무소) 외부 피싱 주소를 알림으로 보낼 수 있었고
 * (sw.js 가 클릭 시 그 주소를 그대로 연다), tag 가 자유라 다른 알림을 덮어쓸 수 있었다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 정상 호출처는 chat-panel(chat-<roomId>)·notify-owner(staff-<kind>-<id>-<ms>) 둘뿐
const TAG_RE = /^(chat|staff)-[\w-]{1,80}$/
const TITLE_MAX = 60
const BODY_MAX = 200

/** 같은 사이트 경로만. '//'·'/\' 는 브라우저가 외부 주소로 읽고, 그 밖은 실제로 풀어 본 출처로 가린다. */
function safeUrl(raw: unknown, origin: string): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  try {
    const u = new URL(raw, origin)
    return u.origin === origin ? u.pathname + u.search + u.hash : '/'
  } catch {
    return '/'
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { targetUserId?: unknown; title?: unknown; body?: unknown; url?: unknown; tag?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (typeof body.targetUserId !== 'string' || typeof body.title !== 'string' || typeof body.body !== 'string'
    || !body.title.trim() || !body.body.trim()) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }
  if (!UUID_RE.test(body.targetUserId)) {
    return NextResponse.json({ error: 'invalid_target' }, { status: 400 })
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
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  try {
    const result = await sendPushToUser(body.targetUserId, {
      title: body.title.slice(0, TITLE_MAX),
      body: body.body.slice(0, BODY_MAX),
      url: safeUrl(body.url, req.nextUrl.origin),
      tag: typeof body.tag === 'string' && TAG_RE.test(body.tag) ? body.tag : undefined,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[push/notify] error', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
