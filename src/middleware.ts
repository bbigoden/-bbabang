import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED = ['/dashboard', '/request/new', '/broker/register', '/broker/properties', '/chat', '/admin']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Supabase 미설정 시 미들웨어 스킵 (개발 중)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return NextResponse.next()

  // 동적 import로 edge 환경에서 안전하게 로드
  const { createServerClient } = await import('@supabase/ssr')

  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()

  // 보호된 경로: 로그인 필요
  const isProtected = PROTECTED.some(p => pathname.startsWith(p))
  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
