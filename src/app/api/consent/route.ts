import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * POST /api/consent
 * 로그인 사용자의 약관 동의를 user_term_consents에 기록.
 * body: { termIds: number[], marketing?: boolean }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { termIds?: unknown; marketing?: unknown }
  try { body = await req.json() } catch { body = {} }

  const termIds = body?.termIds
  if (!Array.isArray(termIds) || termIds.length === 0) {
    return NextResponse.json({ error: 'invalid_term_ids' }, { status: 400 })
  }

  const marketing = body?.marketing === true
  const rows = (termIds as unknown[])
    .filter(id => typeof id === 'number' && Number.isInteger(id))
    .map(id => ({
      user_id: user.id,
      terms_version_id: id as number,
      marketing,
    }))

  if (rows.length === 0) return NextResponse.json({ error: 'no_valid_ids' }, { status: 400 })

  const { error } = await supabase
    .from('user_term_consents')
    .upsert(rows, { onConflict: 'user_id,terms_version_id' })

  if (error) {
    console.error('[consent] upsert failed', error)
    return NextResponse.json({ error: 'db_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: rows.length })
}
