import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'

const BASE_URL = 'https://bbabang.vercel.app'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const staticEntries: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/auth/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/auth/signup`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/explore/requests`, lastModified: now, changeFrequency: 'hourly', priority: 0.95 },
    { url: `${BASE_URL}/request/new`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE_URL}/support`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
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
          lastModified: now, changeFrequency: 'daily', priority: 0.75,
        })
      }
      if (r.district) {
        const sk = `${r.city}|${r.district}`
        if (!sigunguSet.has(sk)) {
          sigunguSet.add(sk)
          entries.push({
            url: `${BASE_URL}/regions/${encodeURIComponent(r.city)}/${encodeURIComponent(r.district)}`,
            lastModified: now, changeFrequency: 'daily', priority: 0.72,
          })
        }
        if (r.dong) {
          const dk = `${r.city}|${r.district}|${r.dong}`
          if (!dongSet.has(dk)) {
            dongSet.add(dk)
            entries.push({
              url: `${BASE_URL}/regions/${encodeURIComponent(r.city)}/${encodeURIComponent(r.district)}/${encodeURIComponent(r.dong)}`,
              lastModified: now, changeFrequency: 'daily', priority: 0.7,
            })
          }
        }
      }
    }
    // 매물 상세 — robots에서 허용돼 있고 canonical·OG도 있는데 sitemap에만 빠져
    // 있었다. 공개 안전 뷰에서 최신순으로 제출한다.
    const { data: props } = await supabase
      .from('public_properties')
      .select('id, created_at')
      .eq('status', 'available')
      .order('created_at', { ascending: false })
      .limit(500)
    for (const p of (props ?? []) as Array<{ id: string; created_at: string }>) {
      entries.push({
        url: `${BASE_URL}/property/${p.id}`,
        lastModified: p.created_at ? new Date(p.created_at) : now,
        changeFrequency: 'weekly', priority: 0.6,
      })
    }

    return [...staticEntries, ...entries]
  } catch {
    return staticEntries
  }
}
