import type { MetadataRoute } from 'next'

const BASE_URL = 'https://bbabang.vercel.app'

// lastModified 는 실제 바뀐 날을 알 때만 붙인다. 요청마다 '지금'을 찍으면 검색엔진이
// 이 사이트의 lastmod 전체를 못 믿게 된다.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, changeFrequency: 'monthly', priority: 1 },
    { url: `${BASE_URL}/auth/login`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/auth/signup`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${BASE_URL}/support`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${BASE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ]
}
