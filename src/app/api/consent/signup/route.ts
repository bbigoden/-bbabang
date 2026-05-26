import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'

/**
 * POST /api/consent/signup
 * 신규 가입 직후 호출 — 현재 유효한 모든 약관 버전에 동의 기록.
 * 이메일 인증 전이라 session이 없으므로 service_role key 사용.
 * body: { userId: string, marketing?: boolean }
 */
export async function POST(req: NextRequest) {
  let body: { userId?: unknown; marketing?: unknown }
  try { body = await req.json() } catch { body = {} }

  const userId = body?.userId
  if (typeof userId !== 'string' || !userId) {
    return NextResponse.json({ error: 'invalid_user_id' }, { status: 400 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ error: 'config' }, { status: 500 })

  const supa = createServerClient(url, serviceKey)

  // 현재 유효한 모든 약관 버전 조회
  const { data: versions } = await supa
    .from('terms_versions')
    .select('id')
    .lte('effective_at', new Date().toISOString())

  if (!versions || versions.length === 0) return NextResponse.json({ ok: true, count: 0 })

  const marketing = body?.marketing === true
  const rows = versions.map(v => ({
    user_id: userId,
    terms_version_id: v.id,
    marketing,
  }))

  await supa
    .from('user_term_consents')
    .upsert(rows, { onConflict: 'user_id,terms_version_id' })

  return NextResponse.json({ ok: true, count: rows.length })
}
