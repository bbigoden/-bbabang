import type { MetadataRoute } from 'next'

const BASE_URL = 'https://bbabang.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // /request/는 사용자 데이터라 통째로 막는데, /request/new는 조건 등록
        // 랜딩이라 색인돼야 한다(sitemap에도 priority 0.9로 제출 중이었다).
        // 더 긴 규칙이 우선하므로 명시적으로 열어준다.
        allow: ['/', '/request/new'],
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
