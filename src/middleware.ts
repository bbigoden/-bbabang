import { NextRequest, NextResponse } from 'next/server'
import { EXPERIMENTS, pickVariant, AB_COOKIE_PREFIX, AB_COOKIE_MAX_AGE } from '@/lib/ab-experiments'

/**
 * Next.js Edge Middleware.
 *
 * 역할:
 *   1. A/B 실험 variant 쿠키 자동 배정 (EXPERIMENTS[].active === true인 것만)
 *      - 이미 쿠키가 있으면 유지 (사용자 경험 일관성 보장)
 *      - 없으면 weight 기반 무작위 배정 → 쿠키 설정
 *
 * 향후 Edge Config 연동:
 *   - @vercel/edge-config 패키지로 EXPERIMENTS를 원격 Config로 교체 가능
 *   - get('ab_experiments')로 실험 정의를 동적으로 읽어올 수 있음
 */
export function middleware(req: NextRequest) {
  const res = NextResponse.next()

  const activeExperiments = EXPERIMENTS.filter(e => e.active)
  if (activeExperiments.length === 0) return res

  for (const exp of activeExperiments) {
    const cookieName = `${AB_COOKIE_PREFIX}${exp.id}`
    const existing = req.cookies.get(cookieName)?.value

    // 이미 유효한 variant가 있으면 유지
    if (existing && exp.variants.some(v => v.id === existing)) continue

    const variant = pickVariant(exp)
    res.cookies.set(cookieName, variant, {
      maxAge: AB_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,  // 클라이언트에서 analytics 이벤트 전송을 위해 readable
      secure: process.env.NODE_ENV === 'production',
    })
  }

  return res
}

export const config = {
  // 정적 파일·API·_next 제외
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|api/).*)'],
}
