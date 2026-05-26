import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'

/**
 * A/B 이벤트 기록 API.
 * 클라이언트의 trackAb() 유틸이 호출.
 * service_role key 사용 (RLS bypass) — 인증 없는 노출 실험도 기록 가능.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { experimentId, variantId, eventName, userId, sessionId, properties } = body

  if (
    typeof experimentId !== 'string' || !experimentId ||
    typeof variantId !== 'string' || !variantId ||
    typeof eventName !== 'string' || !eventName
  ) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'config_error' }, { status: 500 })
  }

  const supa = createServerClient(url, serviceKey)
  const { error } = await supa.from('ab_events').insert({
    experiment_id: experimentId,
    variant_id: variantId,
    event_name: eventName,
    user_id: typeof userId === 'string' ? userId : null,
    session_id: typeof sessionId === 'string' ? sessionId : null,
    properties: typeof properties === 'object' && properties !== null ? properties : {},
  })

  if (error) {
    console.error('[ab/track] insert failed', error)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
