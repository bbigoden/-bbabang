import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { REGIONS, fetchRecentArticles } from '@/lib/naver-land'

/**
 * 네이버부동산 신규매물 수집 — **한 번에 한 구역씩**.
 *
 * 네이버 화면에 최신순이 없어 새 매물을 손으로 찾아다녀야 했다. 여기서 최신순으로
 * 받아 `naver_articles` 에 쌓아 두면 `/broker/naver` 화면이 그것을 보여준다.
 *
 * **최근 것만 받는다.** 전수 수집은 하지 않는다 — 네이버 레이트리밋에 걸리고,
 * 새 매물을 보는 데는 필요도 없다.
 *
 * 처음에는 세 구역을 한 번에 돌렸다가 Vercel 함수 제한(60초)에 걸려 통째로
 * 잘렸다. 데이터센터 IP 라 네이버가 429 를 더 자주 던지고, 그때마다 쉬느라
 * 시간이 불어난다. **구역마다 따로 부른다** — 한 번이 15초쯤이면 잘릴 일이 없고,
 * 한 구역이 막혀도 나머지는 들어온다.
 *
 * 두 가지 방법으로 부른다.
 *   1. Vercel cron — Authorization: Bearer <CRON_SECRET> (vercel.json 에 구역별로 정의)
 *   2. 화면의 [지금 수집] — 로그인한 승인 중개사가 구역을 차례로 부른다
 *
 * 화면에서도 부를 수 있게 한 이유는 크론이 하루 한 번이라서다. 오후에 새로 올라온
 * 매물을 내일까지 기다릴 이유가 없다.
 */

/** 몇 번을 놓쳐도 메우도록 넉넉히 되돌아본다. */
const LOOKBACK_DAYS = 7

export const maxDuration = 60

/** 부른 사람이 이 수집을 돌려도 되는가. 크론이거나, 승인된 중개사여야 한다. */
async function isAllowed(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true

  const supa = await createSessionClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return false
  const { data } = await supa
    .from('broker_profiles')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_approved', true)
    .maybeSingle()
  return !!data
}

export async function GET(req: NextRequest) {
  if (!(await isAllowed(req))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[cron/naver-watch] 서버 설정 누락')
    return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  }
  const supa = createServerClient(url, serviceKey)

  // 구역을 안 적으면 첫 구역. 크론은 vercel.json 에서 구역마다 따로 부른다.
  const wanted = req.nextUrl.searchParams.get('region')
  const region = wanted ? REGIONS.find(r => r.id === wanted) : REGIONS[0]
  if (!region) {
    return NextResponse.json({ error: 'unknown_region' }, { status: 400 })
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
  const startedAt = Date.now()

  let rows: Awaited<ReturnType<typeof fetchRecentArticles>>
  try {
    rows = await fetchRecentArticles(region, since)
  } catch (e) {
    // 네이버가 막으면 이번 회차만 거른다. 다음 회차에 다시 받으면 된다.
    return NextResponse.json({
      ok: false, region: region.name, since,
      error: e instanceof Error ? e.message : '수집 실패',
    })
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, region: region.name, since, fetched: 0, added: 0 })
  }

  // 이번에 처음 보는 매물이 몇 건인지 — 화면의 '신규' 표시와 같은 기준이다.
  const { data: known } = await supa
    .from('naver_articles')
    .select('article_no')
    .in('article_no', rows.map(r => r.article_no))
  const knownSet = new Set((known ?? []).map(k => k.article_no))
  const added = rows.filter(r => !knownSet.has(r.article_no)).length

  // first_seen_at 은 일부러 payload 에서 뺀다. 넣으면 재등록 때마다 갱신돼
  // '언제 처음 본 매물인가' 를 영영 알 수 없게 된다.
  const now = new Date().toISOString()
  const { error } = await supa
    .from('naver_articles')
    .upsert(rows.map(r => ({ ...r, last_seen_at: now })), { onConflict: 'article_no' })
  if (error) {
    console.error('[cron/naver-watch] 저장 실패:', error.message)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    region: region.name,
    since,
    fetched: rows.length,
    added,
    tookMs: Date.now() - startedAt,
  })
}
