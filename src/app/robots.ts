import type { MetadataRoute } from 'next'

const BASE_URL = 'https://bbabang.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        // 로그인·중개사 영역·API 는 색인 제외
        disallow: [
          '/api/',
          '/dashboard/',
          '/broker/',
          '/settings/',
          '/admin',
          '/admin/',
          '/notifications',
          '/account-suspended',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
