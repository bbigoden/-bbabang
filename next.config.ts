import type { NextConfig } from "next";
import { readdirSync } from "fs";
import { join } from "path";

// 점검16단계 7-CSP: Content Security Policy + 보안 헤더.
// - 'unsafe-inline' script는 Next.js 인라인 부트스트랩과 layout의 JSON-LD/테마 스크립트 때문에 불가피
// - Supabase·카카오 지도·HaveIBeenPwned 등 외부 도메인 화이트리스트
const SUPABASE_HOST = 'https://wovxcdfxxnsljdhrgonh.supabase.co'

const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://dapi.kakao.com https://t1.daumcdn.net https://va.vercel-scripts.com`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  // Pexels: 자료화면 썸네일/포스터 이미지 / Creatomate: 영상 스냅샷
  `img-src 'self' data: blob: ${SUPABASE_HOST} https://*.daumcdn.net https://*.daum.net https://*.kakao.com https://images.pexels.com https://cdn.creatomate.com`,
  `font-src 'self' data: https://fonts.gstatic.com`,
  // Pexels API (자료화면 검색) + Creatomate API (영상 합성 polling) + blob: (음성 MP3 blob fetch)
  `connect-src 'self' blob: ${SUPABASE_HOST} wss://wovxcdfxxnsljdhrgonh.supabase.co https://dapi.kakao.com https://postcode.map.kakao.com https://api.pwnedpasswords.com https://vitals.vercel-insights.com https://api.pexels.com https://api.creatomate.com https://cdn.creatomate.com`,
  // Creatomate CDN: 완성된 mp4 video element src
  `media-src 'self' blob: ${SUPABASE_HOST} https://cdn.creatomate.com`,
  // blob: 은 견적서 미리보기 — 저장하지 않고 받은 PDF 를 iframe 에 바로 건다
  `frame-src 'self' blob: https://*.daum.net https://*.kakao.com`,
  `worker-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
].join('; ')

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
]

const nextConfig: NextConfig = {
  compress: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'wovxcdfxxnsljdhrgonh.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    formats: ['image/webp', 'image/avif'],
  },
  // P1-4: 운영 빌드에서 console.log/debug/warn 제거 (error는 유지 — error_logs로 수집 가능)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },
  // 제거된 중개사 공개 페이지 → 홈 (직원 노출 금지 정책)
  //
  // 페이지 안에서 redirect()를 호출하면 스트리밍 컨텍스트라 HTTP 리다이렉트가
  // 아니라 "클라이언트에서 이동하는 meta 태그"가 나간다(Next 문서 명시).
  // 그래서 실제로는 200 + 홈과 같은 내용이 응답돼 검색엔진엔 중복 콘텐츠였고,
  // 서버 HTML과 클라이언트 렌더가 어긋나 hydration 오류(React #418)도 났다.
  // 문서 권고대로 렌더 이전 단계(라우팅)에서 처리한다.
  async redirects() {
    // /broker/* 는 중개사 업무 화면이라 실제 경로를 제외하고 나머지 한 세그먼트만
    // 옛 공개 프로필로 간주한다.
    //
    // 예외 목록을 손으로 관리하다 두 번(jobs 01dace0, cafe-post edd9114) 새 페이지가
    // 홈으로 튕기는 사고가 나서, src/app/broker 폴더를 읽어 자동 생성한다.
    // 새 /broker/xxx 페이지를 만들면 별도 등록 없이 자동으로 예외에 포함됨.
    const BROKER_ROUTES = readdirSync(join(process.cwd(), 'src', 'app', 'broker'), { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .join('|')
    return [
      { source: '/brokers', destination: '/', permanent: true },
      {
        source: `/broker/:id((?!${BROKER_ROUTES}$)[^/]+)`,
        destination: '/',
        permanent: true,
      },
    ]
  },
  // 16단계 보안 헤더 (CSP·HSTS·XFO 등)
  // 견적서 PDF는 서버(@react-pdf/renderer)에서 한글 폰트를 파일로 읽어 렌더한다.
  // public/fonts 는 서버 함수 번들에 자동 포함되지 않으므로 명시적으로 챙긴다.
  outputFileTracingIncludes: {
    '/api/estimates/**': ['./public/fonts/**'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
      {
        // 견적서 PDF는 작성 화면에서 same-origin iframe으로 미리보기한다.
        // 전역 X-Frame-Options: DENY / frame-ancestors 'none' 은 자기 사이트도 막으므로
        // 이 경로에 한해 SAMEORIGIN 으로 완화한다 (뒤에 오는 규칙이 앞을 덮어씀).
        source: '/api/estimates/:path*',
        headers: [
          ...SECURITY_HEADERS.filter(h => h.key !== 'X-Frame-Options' && h.key !== 'Content-Security-Policy'),
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: CSP.replace(`frame-ancestors 'none'`, `frame-ancestors 'self'`) },
        ],
      },
    ]
  },
};

export default nextConfig;
