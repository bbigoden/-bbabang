import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

// /broker/[id]는 공개 중개사 프로필이라 제외. 나머지 broker 하위는 모두 보호.
const PROTECTED = [
  '/dashboard', '/request/new',
  '/broker/register', '/broker/properties', '/broker/customers', '/broker/diary',
  '/broker/team', '/broker/settings', '/broker/resources',
  '/broker/chats', '/broker/trash',
  // 아래 4개는 목록에서 빠져 있어 미들웨어 방어층 없이 각 페이지의 클라이언트
  // 훅에만 의존했다 — 미인증 상태로 화면이 한 번 그려졌다 튕기는 깜빡임이 생긴다
  '/broker/messenger', '/broker/schedule', '/broker/settlement', '/broker/jobs',
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
  // 세션 쿠키 감지 — 세션이 크면 @supabase/ssr이 'sb-...-auth-token.0/.1'로 쪼개므로 둘 다 인식
  const hasSessionCookie = request.cookies.getAll().some(
    c => c.name.startsWith('sb-') && /-auth-token(\.\d+)?$/.test(c.name)
  )
  if (!isProtected && !isRoot && !hasSessionCookie) {
    return NextResponse.next()
  }

  // Next.js 링크 prefetch 요청은 토큰 갱신(getClaims)을 건너뛴다.
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
      return NextResponse.redirect(url)
    }
    return NextResponse.next({ request })
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
  // getUser는 화면 이동·API 호출마다 Supabase Auth에 한 번씩 물으러 갔다(하루 ~2,800번,
  // 번당 ~100ms). getClaims는 만료된 토큰을 getSession으로 똑같이 갱신한 뒤, 서명(ES256)은
  // 캐시된 공개키(JWKS)로 여기서 확인한다. 대신 강제 로그아웃된 세션도 JWT가 끝날 때까지
  // (최대 1시간) 여기를 통과한다. 그 1시간은 브라우저도 같은 JWT로 DB를 직접 읽을 수 있어
  // 서버 확인이 따로 막아 주던 것이 아니다. 정지 계정은 auth-context가 처리한다.
  let userId: string | null = null
  try {
    const { data } = await supabase.auth.getClaims()
    userId = data?.claims?.sub ?? null
  } catch {
    // 네트워크·인증 실패는 error 로 돌아온다. 던지는 것은 깨진 토큰(exp 없음, 알 수 없는
    // 알고리즘 등)뿐이라 로그인 안 된 것으로 보고 아래 로그인 이동을 탄다.
    userId = null
  }

  // 보호된 경로: 로그인 필요
  if (isProtected && !userId) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  // 홈(/): 로그인된 사용자는 적절한 대시보드로 redirect (page.tsx가 정적 캐시 가능하도록)
  // ?as_visitor=1 — 어드민이 일반 사용자 화면 미리보기 시 redirect 우회
  const asVisitor = request.nextUrl.searchParams.get('as_visitor') === '1'
  if (isRoot && userId && !asVisitor) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).single()
    const role = profile?.role
    const url = request.nextUrl.clone()
    url.pathname = role === 'admin' ? '/admin' : role === 'broker' ? '/dashboard/broker' : '/dashboard/user'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    // sw.js·매니페스트·오프라인 페이지·robots·sitemap·글꼴은 로그인과 무관한데,
    // 세션 쿠키가 있으면 매번 인증 확인까지 거쳐 갔다
    '/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|offline.html|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff|woff2)$).*)',
  ],
}
