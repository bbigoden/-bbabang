import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'
import { fetchAllPaged } from '@/lib/fetch-all-paged'

const BASE_URL = 'https://bbabang.vercel.app'

// lastModified는 실제 바뀐 날을 알 때만 붙인다(매물 created_at). 요청마다 '지금'을
// 찍으면 검색엔진이 이 사이트의 lastmod 전체를 못 믿게 되어 매물 날짜까지 무시한다.
//
// 넣지 않는 것: 로그인 보호 경로(/request/new — 크롤러는 307로 로그인에 튕긴다),
// redirect만 하는 스텁(/explore, /regions). 둘 다 서치 콘솔 '리디렉션 페이지' 경고만 쌓인다.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/auth/login`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/auth/signup`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/explore/requests`, changeFrequency: 'hourly', priority: 0.95 },
    { url: `${BASE_URL}/office-intro`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/jobs`, changeFrequency: 'daily', priority: 0.7 },
    { url: `${BASE_URL}/support`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ]

  // 동적: 활성 요청이 있는 (sido, sigungu, dong) unique 조합 → /regions/.../.../...
  try {
    const supabase = await createClient()
    const { data } = await supabase.rpc('get_public_request_feed', {
      p_city: null, p_district: null, p_dong: null, p_deal_type: null,
      p_limit: 100, p_offset: 0,
    })
    const sidoSet = new Set<string>()
    const sigunguSet = new Set<string>()      // key: "city|district"
    const dongSet = new Set<string>()         // key: "city|district|dong"
    const entries: MetadataRoute.Sitemap = []

    for (const r of (data ?? []) as Array<{ city: string; district: string; dong: string | null }>) {
      if (!r.city) continue
      if (!sidoSet.has(r.city)) {
        sidoSet.add(r.city)
        entries.push({
          url: `${BASE_URL}/regions/${encodeURIComponent(r.city)}`,
          changeFrequency: 'daily', priority: 0.75,
        })
      }
      if (r.district) {
        const sk = `${r.city}|${r.district}`
        if (!sigunguSet.has(sk)) {
          sigunguSet.add(sk)
          entries.push({
            url: `${BASE_URL}/regions/${encodeURIComponent(r.city)}/${encodeURIComponent(r.district)}`,
            changeFrequency: 'daily', priority: 0.72,
          })
        }
        if (r.dong) {
          const dk = `${r.city}|${r.district}|${r.dong}`
          if (!dongSet.has(dk)) {
            dongSet.add(dk)
            entries.push({
              url: `${BASE_URL}/regions/${encodeURIComponent(r.city)}/${encodeURIComponent(r.district)}/${encodeURIComponent(r.dong)}`,
              changeFrequency: 'daily', priority: 0.7,
            })
          }
        }
      }
    }

    // 매물 상세 — 공개 안전 뷰에서 최신순으로 '전건' 제출한다.
    // 예전엔 .limit(500)이라 1,600건 중 1,100여 건이 빠졌고, limit만 키워도 PostgREST가
    // 1000행에서 조용히 자르므로 페이지로 이어받는다. 같은 시각 생성분이 페이지 경계에서
    // 겹치거나 빠지지 않게 id로 순서를 고정한다. 5만 URL에 가까워지면 generateSitemaps로 나눌 것.
    // 매물 쪽만 실패해도 지역 항목은 살리려고 따로 감싼다.
    try {
      const props = await fetchAllPaged<{ id: string; created_at: string | null }>((from, to) =>
        supabase
          .from('public_properties')
          .select('id, created_at')
          .eq('status', 'available')
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to))
      for (const p of props) {
        entries.push({
          url: `${BASE_URL}/property/${p.id}`,
          ...(p.created_at ? { lastModified: new Date(p.created_at) } : {}),
          changeFrequency: 'weekly', priority: 0.6,
        })
      }
    } catch {
      // 매물 조회 실패 — 정적·지역 항목만 제출
    }

    return [...staticEntries, ...entries]
  } catch {
    return staticEntries
  }
}
