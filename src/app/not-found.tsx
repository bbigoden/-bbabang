import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Home } from 'lucide-react'
import { GoBackButton } from '@/components/go-back-button'

/**
 * 서버 컴포넌트로 유지 → Next.js가 HTTP 404 status를 정확히 응답.
 * 뒤로가기 버튼은 client component(GoBackButton)로 분리.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 px-4 text-center">
      <div className="mb-6 text-8xl font-black text-gray-100">404</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="부소장 로고" width={64} height={64} className="mb-4 h-16 w-16 rounded-2xl" />
      <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">페이지를 찾을 수 없어요</h1>
      <p className="mb-8 text-gray-500">요청하신 페이지가 없거나 이동되었습니다.</p>
      <div className="flex gap-3">
        <Link href="/">
          <Button variant="primary" size="lg">
            <Home className="mr-2 h-4 w-4" />
            홈으로
          </Button>
        </Link>
        <GoBackButton />
      </div>
    </div>
  )
}
