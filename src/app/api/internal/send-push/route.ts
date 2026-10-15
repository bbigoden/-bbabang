import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { sendPushToUser } from '@/lib/push-server'

/**
 * DB 트리거 전용 푸시 발송 엔드포인트 — 코드 안에 호출처가 없어도 지우면 안 된다.
 *
 * 부르는 곳은 public.notify_assignee_change() (trg_notify_{customer,property}_assignee_{insert,update}).
 * 담당자로 지정되면 pg_net 이 internal_config.internal_push_url(이 주소)로 x-internal-secret 을 붙여 POST 한다.
 * 7/26 '고아 API 정리'(01709c7)에서 코드 호출처만 보고 지웠다가, 그 뒤 담당자 지정 푸시가
 * 석 달 가까이 전부 404 로 떨어졌다(인앱 알림만 남음). 그래서 되살렸다.
 *
 * INTERNAL_PUSH_SECRET(Vercel)과 internal_config.internal_push_secret(DB)이 같아야 통과한다.
 * 사용자 인증·관계 검증을 건너뛰므로, 비밀값이 새도 피해가 작게 내용은 트리거가 보내는 모양만 받는다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// 트리거가 'assignee-' || kind || '-' || id 로 만든다
const TAG_RE = /^assignee-[\w-]{1,80}$/

function secretMatches(given: string | null, secret: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 같은 사이트 경로만. '//'·'/\' 는 브라우저가 외부 주소로 읽는다. */
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
  const secret = process.env.INTERNAL_PUSH_SECRET
  if (!secret) {
    console.error('[internal/send-push] INTERNAL_PUSH_SECRET 미설정')
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }

  if (!secretMatches(req.headers.get('x-internal-secret'), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: { targetUserId?: unknown; title?: unknown; body?: unknown; url?: unknown; tag?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (typeof body.targetUserId !== 'string' || !UUID_RE.test(body.targetUserId)
    || typeof body.title !== 'string' || !body.title || typeof body.body !== 'string' || !body.body) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  try {
    const result = await sendPushToUser(body.targetUserId, {
      title: body.title.slice(0, 60),
      body: body.body.slice(0, 200),
      url: safeUrl(body.url, req.nextUrl.origin),
      tag: typeof body.tag === 'string' && TAG_RE.test(body.tag) ? body.tag : undefined,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[internal/send-push] error', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
