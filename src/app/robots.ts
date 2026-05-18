import type { MetadataRoute } from 'next'

const BASE_URL = 'https://bbabang.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        // 로그인·중개사 영역·API·사용자별 상세 페이지는 색인 제외
        disallow: [
          '/api/',
          '/dashboard/',
          '/broker/',
          '/chat/',
          '/settings/',
          '/admin',
          '/profile',
          '/request/',     // /request/[id] 등 사용자 데이터 포함
          '/review/',      // /review/[proposalId]
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
