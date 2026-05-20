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
          '/admin/',
          '/profile',
          '/request/',     // /request/[id] 등 사용자 데이터 포함
          '/review/',      // /review/[proposalId]
          '/notifications',
          '/favorites',
          '/reviews',
          '/history',
          '/recommendations',
          '/account-suspended',
          '/search',       // 임의 검색어 무한 크롤 방지
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
