import type { MetadataRoute } from 'next'

const BASE_URL = 'https://bbabang.vercel.app'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // /request/new는 따로 열지 않는다 — 로그인 보호 경로(src/lib/protected-paths.ts 의
        // isProtectedPath, proxy 가 본다)라 크롤러는 로그인 화면으로 307만 받는다.
        // 색인시키려면 비로그인 안내 랜딩부터 만들어야 한다.
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
          '/property/',    // 매물 상세 — 로그인해야 보인다
          '/review/',      // /review/[proposalId]
          '/notifications',
          '/favorites',
          '/reviews',
          '/history',
          '/recommendations',
          '/account-suspended',
          // 비로그인에겐 로그인으로 넘기는 빈 껍데기가 기본 제목·index로 200 응답된다
          '/my/',          // /my/proposals, /my/requests
          '/saved-searches',
          '/search',       // 임의 검색어 무한 크롤 방지
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
