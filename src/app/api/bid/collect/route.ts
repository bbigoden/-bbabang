import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { collectBids } from '@/lib/bid-collect'
import { g2bKey } from '@/lib/g2b'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 입찰 화면의 [가져오기]. cron 과 같은 일을 지금 한 번 돈다.
 *
 * 아침 cron 을 기다리지 않고 방금 올라온 공고를 보고 싶을 때 쓴다. 입찰을 켠
 * 사무소(bid_enabled)의 대표만 부를 수 있다. 쓰기는 service_role 로 한다.
 */

export const maxDuration = 60

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: bp } = await supabase.from('broker_profiles')
    .select('bid_enabled, is_owner').eq('user_id', user.id).maybeSingle()
  if (!bp?.bid_enabled || bp.is_owner === false) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || !g2bKey()) {
    return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  }

  // 두 번 눌러 겹쳐 돌면 같은 상세를 두 번 받아 한도만 먹는다
  const allowed = await checkRateLimit(`user:${user.id}:bid-collect`, 1, 60)
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const report = await collectBids(createAdminClient(url, serviceKey), { timeBudgetMs: 50_000 })
  return NextResponse.json(report, { status: report.stoppedBy === 'error' ? 500 : 200 })
}
