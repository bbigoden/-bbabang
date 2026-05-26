import type { NextConfig } from "next";

// 점검16단계 7-CSP: Content Security Policy + 보안 헤더.
// - 'unsafe-inline' script는 Next.js 인라인 부트스트랩과 layout의 JSON-LD/테마 스크립트 때문에 불가피
// - Supabase·카카오 지도·HaveIBeenPwned 등 외부 도메인 화이트리스트
const SUPABASE_HOST = 'https://wovxcdfxxnsljdhrgonh.supabase.co'

const CSP = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://dapi.kakao.com https://t1.daumcdn.net https://va.vercel-scripts.com`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `img-src 'self' data: blob: ${SUPABASE_HOST} https://*.daumcdn.net https://*.daum.net`,
  `font-src 'self' data: https://fonts.gstatic.com`,
  `connect-src 'self' ${SUPABASE_HOST} wss://wovxcdfxxnsljdhrgonh.supabase.co https://dapi.kakao.com https://api.pwnedpasswords.com https://vitals.vercel-insights.com`,
  `frame-src 'self' https://*.daum.net`,
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
  // 16단계 보안 헤더 (CSP·HSTS·XFO 등)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ]
  },
};

export default nextConfig;
