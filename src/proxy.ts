import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// /broker/[id]는 공개 중개사 프로필이라 제외. 나머지 broker 하위는 모두 보호.
const PROTECTED = [
  '/dashboard', '/request/new',
  '/broker/register', '/broker/properties', '/broker/customers', '/broker/diary',
  '/broker/team', '/broker/settings', '/broker/resources', '/broker/stats',
  '/broker/card', '/broker/chats', '/broker/trash', '/broker/archive',
  '/chat', '/admin', '/profile', '/settings',
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return NextResponse.next()

  // 비로그인 + 비보호 경로면 auth 호출 없이 통과 (홈 등 공개 페이지 CDN 캐시 가능)
  const isProtected = PROTECTED.some(p => pathname.startsWith(p))
  const isRoot = pathname === '/'
  const hasSessionCookie = request.cookies.getAll().some(c => c.name.startsWith('sb-') && c.name.endsWith('-auth-token'))
  if (!isProtected && !isRoot && !hasSessionCookie) {
    return NextResponse.next()
  }

  let response = NextResponse.next({ request })

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
  let user: any = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    return response
  }

  // 보호된 경로: 로그인 필요
  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  // 홈(/): 로그인된 사용자는 적절한 대시보드로 redirect (page.tsx가 정적 캐시 가능하도록)
  // ?as_visitor=1 — 어드민이 일반 사용자 화면 미리보기 시 redirect 우회
  const asVisitor = request.nextUrl.searchParams.get('as_visitor') === '1'
  if (isRoot && user && !asVisitor) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const role = profile?.role
    const url = request.nextUrl.clone()
    url.pathname = role === 'admin' ? '/admin' : role === 'broker' ? '/dashboard/broker' : '/dashboard/user'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
