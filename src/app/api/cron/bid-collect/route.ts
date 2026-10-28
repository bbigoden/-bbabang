import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { collectBids } from '@/lib/bid-collect'
import { g2bKey } from '@/lib/g2b'

/**
 * 하루 3번 (Vercel cron). 나라장터 도장·방수 공고·낙찰결과를 받는다.
 *
 * 한 번에 50초만 돈다. 최근 3일치를 먼저 받고, 남는 시간엔 과거 낙찰 상세를 채운다.
 * 하루 한도(서비스마다 1,000건)를 다 쓸 때까지 과거를 채우려고 여러 번 건다.
 *
 * 인증은 다른 cron 과 같다 — Authorization: Bearer CRON_SECRET.
 */

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey || !g2bKey()) {
    console.error('[cron/bid-collect] 서버 설정 누락')
    return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  }

  const report = await collectBids(createServerClient(url, serviceKey), { timeBudgetMs: 50_000 })
  return NextResponse.json(report, { status: report.stoppedBy === 'error' ? 500 : 200 })
}
