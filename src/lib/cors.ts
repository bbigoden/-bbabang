import { NextResponse } from 'next/server'

/**
 * 같은 origin 호출이 주이므로 엄격한 CORS 정책.
 * 별도 모바일 앱·외부 통합이 생기면 ALLOWED_ORIGINS 환경변수로 화이트리스트 확장.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const DEFAULT_ORIGIN = 'https://bbabang.vercel.app'

function pickOrigin(reqOrigin: string | null): string {
  if (!reqOrigin) return DEFAULT_ORIGIN
  if (ALLOWED_ORIGINS.includes(reqOrigin)) return reqOrigin
  if (reqOrigin === DEFAULT_ORIGIN) return reqOrigin
  // 프리뷰 배포 (bbabang-*.vercel.app)
  try {
    const u = new URL(reqOrigin)
    if (u.hostname.endsWith('.vercel.app') && u.hostname.startsWith('bbabang')) return reqOrigin
  } catch {/* invalid origin → 기본값 */}
  return DEFAULT_ORIGIN
}

/** API 응답에 CORS 헤더 적용. preflight 처리 별도 함수 사용. */
export function withCors(res: NextResponse, reqOrigin: string | null = null): NextResponse {
  const origin = pickOrigin(reqOrigin)
  res.headers.set('Access-Control-Allow-Origin', origin)
  res.headers.set('Vary', 'Origin')
  res.headers.set('Access-Control-Allow-Credentials', 'true')
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  return res
}

/** OPTIONS preflight 핸들러 — 각 route.ts에서 export로 재사용 */
export function corsPreflight(req: Request): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }), req.headers.get('origin'))
}
