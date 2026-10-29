import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { collectBids } from '@/lib/bid-collect'
import { g2bKey } from '@/lib/g2b'

/**
 * 하루 8번 (Vercel cron, 3시간마다). 나라장터 도장·방수 공고·낙찰결과를 받는다.
 *
 * 한 번에 280초 돈다. 최근 것을 먼저 받고, 남는 시간엔 과거 낙찰 상세를 채운다.
 * 운영계정으로 한도가 늘어 이젠 시간이 병목이다 — 50초엔 상세 100~190건밖에 못 채웠다.
 *
 * 인증은 다른 cron 과 같다 — Authorization: Bearer CRON_SECRET.
 */

export const maxDuration = 300

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

  const report = await collectBids(createServerClient(url, serviceKey), { timeBudgetMs: 280_000 })
  return NextResponse.json(report, { status: report.stoppedBy === 'error' ? 500 : 200 })
}
