/**
 * 로그인해야 들어갈 수 있는 경로 — proxy(엣지)와 auth-context(브라우저)가 같은 목록을 본다.
 *
 * next·supabase 를 import 하지 않는다. 엣지 런타임과 클라이언트 번들 양쪽에서 불러야 하고,
 * 두 곳이 따로 목록을 들고 있다가 어긋나서, 비로그인이면 빈 화면·끝없는 스피너에 갇히거나 토큰이
 * 만료된 손님까지 로그인 화면으로 보낸 일이 있었다.
 *
 * 앞부분 일치(startsWith)라 끝 '/' 가 뜻을 가진다.
 * - '/broker/' — 하위 페이지는 전부 중개사 전용. 구 공개 프로필 /broker/<id> 는 next.config 가
 *   proxy 보다 먼저 '/' 로 돌린다. '/brokers'·'/broker' 는 안 걸린다.
 * '/r' 처럼 짧은 앞부분은 절대 넣지 말 것 — 공유 보고서(/r/<id>)는 손님이 연다.
 */
const PROTECTED_PREFIXES = [
  '/dashboard', '/admin', '/settings', '/broker/', '/notifications',
]

function matches(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(p => pathname.startsWith(p))
}

/**
 * 받은 그대로(퍼센트 인코딩 상태)와 풀어 본 것 둘 중 하나라도 걸리면 보호 경로다.
 * proxy 의 nextUrl.pathname 은 인코딩된 채라 '/%62roker/ads' 가
 * 목록을 비껴 갔다. 라우팅이 풀린 경로로 같은 화면을 찾으면 proxy 만 건너뛴 셈이다 —
 * 페이지가 스스로 로그인을 확인해 새는 건 없지만 빈 껍데기·늦은 튕김이 다시 생긴다.
 * 깨진 인코딩('%E0%A4%A')은 decodeURI 가 던진다 — 그땐 받은 그대로만 본다.
 */
export function isProtectedPath(pathname: string): boolean {
  let decoded = pathname
  try { decoded = decodeURI(pathname) } catch { /* 깨진 인코딩 — 받은 그대로만 본다 */ }
  return matches(pathname) || (decoded !== pathname && matches(decoded))
}
