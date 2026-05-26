import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * 푸시 구독 등록.
 * 클라이언트의 PushManager.subscribe() 결과를 받아 DB에 저장한다.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  // upsert: 같은 endpoint면 갱신 (디바이스 재구독 시)
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: body.userAgent ?? null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )

  if (error) {
    return NextResponse.json({ error: 'db_error', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/**
 * 푸시 구독 해제.
 */
export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const endpoint = searchParams.get('endpoint')
  if (!endpoint) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint)

  return NextResponse.json({ ok: true })
}
