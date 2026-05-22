'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Home, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 dark:bg-gray-950 px-4 text-center">
      <div className="mb-6 text-8xl font-black text-gray-100">404</div>
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600">
        <Home className="h-8 w-8 text-white" />
      </div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">페이지를 찾을 수 없어요</h1>
      <p className="mb-8 text-gray-500">요청하신 페이지가 없거나 이동되었습니다.</p>
      <div className="flex gap-3">
        <Link href="/">
          <Button variant="primary" size="lg">
            <Home className="mr-2 h-4 w-4" />
            홈으로
          </Button>
        </Link>
        <Button variant="secondary" size="lg" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          뒤로가기
        </Button>
      </div>
    </div>
  )
}
