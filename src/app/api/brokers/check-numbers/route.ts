import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * POST /api/brokers/check-numbers
 * body: { license_number: string, business_reg_number: string }
 *  → { taken: Array<'license_number' | 'business_reg_number'> }
 *
 * 사무소 등록 전에 두 번호가 다른 사무소에 이미 있는지 한꺼번에 본다. 등록(insert)은 겹치는
 * 첫 고유 인덱스 하나만 409 로 알려 줘서, 사업자번호를 고쳐 다시 내야 그제야 자격증 번호가 걸렸다.
 * 남의 사무소 행은 RLS 로 안 보이니 service_role 로 '있다/없다'만 답한다 — 409 문구가 이미
 * 알려 주는 것 이상은 내보내지 않는다. 비교는 고유 인덱스와 같이 값 그대로.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const userId = await supabase.auth.getClaims().then(r => r.data?.claims?.sub, () => undefined)
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const allowed = await checkRateLimit(`user:${userId}:check-numbers`, 20, 3600)
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { license_number?: unknown; business_reg_number?: unknown }
  try { body = await req.json() } catch { body = {} }
  const fields = {
    license_number: typeof body.license_number === 'string' ? body.license_number.trim() : '',
    business_reg_number: typeof body.business_reg_number === 'string' ? body.business_reg_number.trim() : '',
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ error: 'config' }, { status: 500 })
  const supa = createServiceClient(url, serviceKey, { auth: { persistSession: false } })

  const taken: Array<keyof typeof fields> = []
  for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
    const value = fields[key]
    if (!value) continue
    const { data, error } = await supa.from('broker_profiles').select('id')
      .eq(key, value).neq('user_id', userId).limit(1)
    if (error) return NextResponse.json({ error: 'db' }, { status: 500 })
    if (data?.length) taken.push(key)
  }
  return NextResponse.json({ taken })
}
