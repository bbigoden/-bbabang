import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { collectBids } from '@/lib/bid-collect'
import { collectD2b } from '@/lib/d2b-collect'
import { g2bKey } from '@/lib/g2b'

/**
 * 1시간마다 (Vercel cron). 나라장터와 국방전자조달(D2B)의 도장·방수 공고·낙찰결과를 받는다.
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

  const supa = createServerClient(url, serviceKey)
  // 국방(D2B) 공사를 먼저 — 하루 수십 건이라 금방 끝나고, 남는 시간은 나라장터 과거 채움이 다 쓴다
  const d2b = await collectD2b(supa, { timeBudgetMs: 60_000 })
  const report = await collectBids(supa, { timeBudgetMs: 220_000 })
  return NextResponse.json({ ...report, d2b }, { status: report.stoppedBy === 'error' && d2b.stoppedBy === 'error' ? 500 : 200 })
}
