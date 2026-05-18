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
    { url: `${BASE_URL}/brokers`, lastModified: now, changeFrequency: 'daily', priority: 0.85 },
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
    const seen = new Set<string>()
    const regionEntries: MetadataRoute.Sitemap = []
    for (const r of (data ?? []) as Array<{ city: string; district: string; dong: string | null }>) {
      if (!r.city || !r.district || !r.dong) continue
      const key = `${r.city}|${r.district}|${r.dong}`
      if (seen.has(key)) continue
      seen.add(key)
      regionEntries.push({
        url: `${BASE_URL}/regions/${encodeURIComponent(r.city)}/${encodeURIComponent(r.district)}/${encodeURIComponent(r.dong)}`,
        lastModified: now,
        changeFrequency: 'daily',
        priority: 0.7,
      })
    }
    return [...staticEntries, ...regionEntries]
  } catch {
    return staticEntries
  }
}
