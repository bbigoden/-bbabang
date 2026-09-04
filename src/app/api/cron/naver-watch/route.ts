import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { REGIONS, REGION_GAP_MS, fetchRecentArticles } from '@/lib/naver-land'

/**
 * 네이버부동산 신규매물 수집.
 *
 * 네이버 화면에 최신순이 없어 새 매물을 손으로 찾아다녀야 했다. 여기서 최신순으로
 * 받아 `naver_articles` 에 쌓아 두면 `/broker/naver` 화면이 그것을 보여준다.
 *
 * **최근 것만 받는다.** 전수 수집은 하지 않는다 — 네이버 레이트리밋에 걸리고,
 * 새 매물을 보는 데는 필요도 없다.
 *
 * 두 가지 방법으로 부른다.
 *   1. Vercel cron — Authorization: Bearer <CRON_SECRET> (vercel.json 에 정의)
 *   2. 화면의 [지금 수집] — 로그인한 승인 중개사
 *
 * 화면에서도 부를 수 있게 한 이유는 크론이 하루 한 번이라서다. 오후에 새로 올라온
 * 매물을 내일까지 기다릴 이유가 없다.
 */

/** 몇 번을 놓쳐도 메우도록 넉넉히 되돌아본다. */
const LOOKBACK_DAYS = 7

/**
 * 네이버를 그만 부르는 시각.
 *
 * Vercel 함수는 maxDuration 에서 잘린다. 잘리면 그때까지 받은 것도 저장되지 않아
 * 한 회차를 통째로 버리게 된다. 시간이 모자라면 남은 구역을 다음 회차로 넘기고
 * 받아 둔 것부터 저장한다.
 */
const FETCH_BUDGET_MS = 40_000

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

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10)
  const startedAt = Date.now()
  const perRegion: Record<string, number | string> = {}
  const collected = new Map<string, Awaited<ReturnType<typeof fetchRecentArticles>>[number]>()

  for (const region of REGIONS) {
    if (Date.now() - startedAt > FETCH_BUDGET_MS) {
      perRegion[region.name] = '시간 부족 — 다음 회차'
      continue
    }
    try {
      const rows = await fetchRecentArticles(region, since)
      // 구역 사각형이 겹쳐 같은 매물이 두 번 올 수 있다. 매물번호로 하나만 남긴다.
      for (const r of rows) collected.set(r.article_no, r)
      perRegion[region.name] = rows.length
    } catch (e) {
      // 한 구역이 막혀도 나머지는 받는다.
      perRegion[region.name] = e instanceof Error ? e.message : '수집 실패'
    }
    await new Promise(r => setTimeout(r, REGION_GAP_MS))
  }

  const rows = [...collected.values()]
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, since, regions: perRegion, fetched: 0, added: 0 })
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
    since,
    regions: perRegion,
    fetched: rows.length,
    added,
    tookMs: Date.now() - startedAt,
  })
}
