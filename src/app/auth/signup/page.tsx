import { SignupForm } from './signup-form'

/**
 * 서버 컴포넌트: SSR로 외곽 마크업·h1·역할 결정 → SSR HTML에 폼이 즉시 노출.
 * client form은 분리된 'signup-form.tsx'에서 hydration.
 *
 * Next.js 16: searchParams는 Promise. await로 받음.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>
}) {
  const sp = await searchParams
  const defaultRole = sp.role === 'broker' ? 'broker' : 'user'

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4 py-12">
      <div className="w-full max-w-md">
        {/* SSR h1 — a11y page-has-heading-one */}
        <h1 className="sr-only">부소장 회원가입</h1>
        <SignupForm defaultRole={defaultRole} />
      </div>
    </div>
  )
}
