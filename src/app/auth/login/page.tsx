import { LoginForm } from './login-form'

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
  const raw = sp.redirect ?? null
  const redirectTo = raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null
  const expired = sp.expired === '1'

  return (
    <>
      <h1 className="sr-only">빠방 로그인</h1>
      <LoginForm redirectTo={redirectTo} expired={expired} />
    </>
  )
}
