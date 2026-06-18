import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import { EXPERIMENTS, pickVariant, AB_COOKIE_PREFIX, AB_COOKIE_MAX_AGE } from '@/lib/ab-experiments'

// /broker/[id]는 공개 중개사 프로필이라 제외. 나머지 broker 하위는 모두 보호.
const PROTECTED = [
  '/dashboard', '/request/new',
  '/broker/register', '/broker/properties', '/broker/customers', '/broker/diary',
  '/broker/team', '/broker/settings', '/broker/resources',
  '/broker/chats', '/broker/trash',
  '/chat', '/admin', '/profile', '/settings',
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // A/B 실험 쿠키 자동 배정 (active 실험이 있을 때만 동작).
  // 미들웨어는 경로별로 서로 다른 응답을 반환하므로, 여기선 "배정해야 할 쿠키"만
  // 모아두고 applyAb()로 실제 반환 응답에 싣는다. (예전엔 별도 abResponse에만 set 하고
  // 그 응답을 반환하지 않아 active 실험이 켜져도 쿠키가 전송되지 않는 버그가 있었음.)
  const abAssignments: Array<{ name: string; value: string }> = []
  for (const exp of EXPERIMENTS) {
    if (!exp.active) continue
    const cookieName = `${AB_COOKIE_PREFIX}${exp.id}`
    const existing = request.cookies.get(cookieName)?.value
    if (!existing || !exp.variants.some(v => v.id === existing)) {
      abAssignments.push({ name: cookieName, value: pickVariant(exp) })
    }
  }
  // 반환 직전 모든 응답에 A/B 쿠키를 싣는 헬퍼. 배정이 없으면 no-op이라
  // 기존 동작(Set-Cookie 없음 → 공개 페이지 CDN 캐시 가능)을 그대로 보존한다.
  const applyAb = <T extends NextResponse>(res: T): T => {
    for (const { name, value } of abAssignments) {
      res.cookies.set(name, value, {
        maxAge: AB_COOKIE_MAX_AGE,
        path: '/',
        sameSite: 'lax',
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
      })
    }
    return res
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return applyAb(NextResponse.next())

  // 비로그인 + 비보호 경로면 auth 호출 없이 통과 (홈 등 공개 페이지 CDN 캐시 가능)
  const isProtected = PROTECTED.some(p => pathname.startsWith(p))
  const isRoot = pathname === '/'
  // 세션 쿠키 감지 — 세션이 크면 @supabase/ssr이 'sb-...-auth-token.0/.1'로 쪼개므로 둘 다 인식
  const hasSessionCookie = request.cookies.getAll().some(
    c => c.name.startsWith('sb-') && /-auth-token(\.\d+)?$/.test(c.name)
  )
  if (!isProtected && !isRoot && !hasSessionCookie) {
    return applyAb(NextResponse.next())
  }

  // Next.js 링크 prefetch 요청은 토큰 갱신(getUser)을 건너뛴다.
  // 링크가 많은 페이지는 prefetch가 한꺼번에 미들웨어를 수십 번 때리는데, 각 요청이
  // 만료된 토큰을 동시에 refresh하면 Supabase refresh token rotation 탓에 먼저 회전된
  // 쪽이 나머지 토큰을 무효화한다 → 'refresh_token_not_found'/'session_not_found' →
  // 모바일에서 로그인이 자꾸 풀림. prefetch는 화면에 안 보이고 실제 클릭 시 미들웨어가
  // 다시 정식 검증하므로, 여기선 네트워크 호출 없이 쿠키 유무로만 보호 경로를 막는다.
  const isPrefetch =
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch' ||
    (request.headers.get('sec-purpose')?.includes('prefetch') ?? false)
  if (isPrefetch) {
    if (isProtected && !hasSessionCookie) {
      const url = request.nextUrl.clone()
      url.pathname = '/auth/login'
      url.searchParams.set('redirect', pathname)
      return applyAb(NextResponse.redirect(url))
    }
    return applyAb(NextResponse.next({ request }))
  }

  const response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => {
          request.cookies.set(name, value)
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  // 세션 갱신 (토큰 만료 시 자동 재발급)
  let user: User | null = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    return applyAb(response)
  }

  // 보호된 경로: 로그인 필요
  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirect', pathname)
    return applyAb(NextResponse.redirect(url))
  }

  // 홈(/): 로그인된 사용자는 적절한 대시보드로 redirect (page.tsx가 정적 캐시 가능하도록)
  // ?as_visitor=1 — 어드민이 일반 사용자 화면 미리보기 시 redirect 우회
  const asVisitor = request.nextUrl.searchParams.get('as_visitor') === '1'
  if (isRoot && user && !asVisitor) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = profile?.role
    const url = request.nextUrl.clone()
    url.pathname = role === 'admin' ? '/admin' : role === 'broker' ? '/dashboard/broker' : '/dashboard/user'
    return applyAb(NextResponse.redirect(url))
  }

  return applyAb(response)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
