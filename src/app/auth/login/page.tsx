import { LoginForm } from './login-form'

/**
 * redirect 는 같은 사이트 경로만 받는다. '/' 로 시작하고 '//' 가 아니어도
 * '/\evil.example' 은 브라우저가 https://evil.example 로 읽어서, 로그인된 사람이
 * 링크만 열어도 마운트 effect 가 바로 외부로 보냈다. 실제로 풀어 본 주소가
 * 같은 출처일 때만 그 경로를 쓴다(가짜 출처로 풀어 보고 출처가 바뀌면 거절).
 * 쿼리(?focus=…, ?date=…)는 그대로 살려 돌려준다 — proxy 가 쿼리까지 담아 보낸다.
 *
 * 풀어 본 결과도 '//' 로 시작하면 거절한다. '/.//evil.example'·'/a/..//evil.example' 은
 * 앞 검사를 지나고 출처도 그대로인데, 점 구간이 정리되며 경로가 '//evil.example' 이 된다.
 * 그걸 router.replace 에 넘기면 브라우저가 외부 주소로 읽어 그쪽으로 나간다.
 */
function safeRedirect(raw: unknown): string | null {
  // ?redirect=a&redirect=b 처럼 겹치면 배열로 온다 — 문자열 하나일 때만 받는다
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  const base = 'http://same-origin.invalid'
  try {
    const u = new URL(raw, base)
    const path = u.pathname + u.search + u.hash
    return u.origin === base && !path.startsWith('//') ? path : null
  } catch {
    return null
  }
}

/**
 * 서버 컴포넌트: SSR에 폼이 즉시 노출되도록 wrapper만 server.
 * redirect 경로는 client 컴포넌트가 useSearchParams 없이 props로 받음.
 *
 * Next.js 16: searchParams는 Promise.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; expired?: string }>
}) {
  const sp = await searchParams
  const redirectTo = safeRedirect(sp.redirect)
  const expired = sp.expired === '1'

  return (
    <>
      <h1 className="sr-only">부소장 로그인</h1>
      <LoginForm redirectTo={redirectTo} expired={expired} />
    </>
  )
}
