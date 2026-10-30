import { SignupForm } from './signup-form'
import { safeRedirectPath } from '@/lib/validation'

/**
 * 서버 컴포넌트: SSR로 외곽 마크업·h1 → SSR HTML에 폼이 즉시 노출.
 * client form은 분리된 'signup-form.tsx'에서 hydration.
 *
 * redirect — 로그인 화면이 원래 가려던 곳을 실어 보낸다(가입 화면의 [로그인] 링크가 이어 받는다).
 * 로그인 화면과 같은 검사(safeRedirectPath)로 같은 사이트 경로만 받는다.
 *
 * Next.js 16: searchParams는 Promise. await로 받음.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>
}) {
  const sp = await searchParams
  const redirectTo = safeRedirectPath(sp.redirect)

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4 py-12">
      <div className="w-full max-w-md">
        {/* SSR h1 — a11y page-has-heading-one */}
        <h1 className="sr-only">부소장 회원가입</h1>
        <SignupForm redirectTo={redirectTo} />
      </div>
    </div>
  )
}
