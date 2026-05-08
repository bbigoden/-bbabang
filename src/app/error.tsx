'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Home, RefreshCw } from 'lucide-react'
import Link from 'next/link'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <div className="mb-6 text-6xl">😵</div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">오류가 발생했어요</h1>
      <p className="mb-2 text-gray-500">잠시 후 다시 시도해주세요.</p>
      <pre className="mb-4 max-w-xl overflow-auto rounded bg-red-50 p-3 text-left text-xs text-red-700">{error?.message}{'\n'}{error?.stack}</pre>
      <div className="flex gap-3">
        <Button variant="primary" size="lg" onClick={reset}>
          <RefreshCw className="mr-2 h-4 w-4" />
          다시 시도
        </Button>
        <Link href="/">
          <Button variant="secondary" size="lg">
            <Home className="mr-2 h-4 w-4" />
            홈으로
          </Button>
        </Link>
      </div>
    </div>
  )
}
