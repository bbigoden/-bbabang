import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/consent/signup
 * 신규 가입 직후 호출 — 현재 유효한 모든 약관 버전에 동의 기록.
 * body: { userId: string, marketing?: boolean }
 *
 * 예전엔 userId 가 문자열인지만 보고 service_role 로 덮어써서, 남의 uuid 만 알면
 * (request_posts.user_id 등으로 얻을 수 있다) 그 사람의 약관·마케팅 동의 기록을
 * 위조하거나 바꿀 수 있었다. 이제 세션의 사용자가 userId 와 같을 때만 쓴다 — 이메일 자동
 * 인증이라 signUp 직후 브라우저 쿠키에 세션이 있어 정상 가입은 늘 이 경로다(가입 2~4초 뒤
 * 기록되는 것을 운영 데이터로 확인). 이메일 인증을 켜게 되면 그때 경로를 다시 만든다.
 * 이미 있는 행은 절대 덮어쓰지 않는다 — 동의 기록은 법적 증빙이다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  // Rate limit: IP당 분당 5회 (가입 후 호출이라 매우 드물어야 함)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const allowed = await checkRateLimit(`ip:${ip}:consent-signup`, 5, 60)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  let body: { userId?: unknown; marketing?: unknown }
  try { body = await req.json() } catch { body = {} }

  const userId = body?.userId
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: 'invalid_user_id' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ error: 'config' }, { status: 500 })

  const supa = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  // 세션 주인이 곧 userId 인가. 깨진 토큰이면 getClaims 가 던진다 — 세션 없음으로 본다.
  const supabase = await createClient()
  const sessionUserId = await supabase.auth.getClaims().then(r => r.data?.claims?.sub, () => undefined)
  if (sessionUserId !== userId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 현재 유효한 모든 약관 버전 조회
  const { data: versions, error: verErr } = await supa
    .from('terms_versions')
    .select('id')
    .lte('effective_at', new Date().toISOString())
  if (verErr) {
    console.error('[consent/signup] terms_versions failed', verErr)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  if (!versions || versions.length === 0) return NextResponse.json({ ok: true, count: 0 })

  const marketing = body?.marketing === true
  const rows = versions.map(v => ({
    user_id: userId,
    terms_version_id: v.id,
    marketing,
  }))

  // ignoreDuplicates — ON CONFLICT DO NOTHING. 이미 남은 동의(마케팅 값 포함)는 바꾸지 않는다.
  const { error } = await supa
    .from('user_term_consents')
    .upsert(rows, { onConflict: 'user_id,terms_version_id', ignoreDuplicates: true })
  if (error) {
    console.error('[consent/signup] insert failed', error)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: rows.length })
}
