'use client'

import { useEffect, useState } from 'react'

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  const [count, setCount] = useState(5)

  useEffect(() => {
    console.error(error)
  }, [error])

  useEffect(() => {
    if (count <= 0) { window.location.reload(); return }
    const t = setTimeout(() => setCount(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [count])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <div className="mb-6 text-6xl">😵</div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">오류가 발생했어요</h1>
      <p className="mb-6 text-gray-500">일시적인 오류가 발생했습니다. 다시 시도해 주세요.</p>
      <p className="mb-4 text-sm text-gray-400">{count}초 후 자동으로 새로고침됩니다</p>
      <div className="flex gap-3">
        <button
          onClick={() => unstable_retry()}
          className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-7 py-3.5 text-base font-semibold text-white hover:bg-blue-700 transition-colors"
        >
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          다시 시도
        </button>
        <button
          onClick={() => { window.location.href = '/' }}
          className="inline-flex items-center justify-center rounded-xl bg-gray-100 px-7 py-3.5 text-base font-semibold text-gray-900 hover:bg-gray-200 transition-colors"
        >
          <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          홈으로
        </button>
      </div>
    </div>
  )
}
