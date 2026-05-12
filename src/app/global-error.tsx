'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="ko">
      <body style={{ margin: 0, fontFamily: 'sans-serif', background: '#f9fafb' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', textAlign: 'center', padding: '1rem',
        }}>
          <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>😵</div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#111827', marginBottom: '0.5rem' }}>
            오류가 발생했어요
          </h1>
          <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
            일시적인 오류가 발생했습니다. 다시 시도해 주세요.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={() => unstable_retry()}
              style={{
                background: '#2563eb', color: '#fff', border: 'none',
                borderRadius: '0.75rem', padding: '0.875rem 1.75rem',
                fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              다시 시도
            </button>
            <button
              onClick={() => { window.location.href = '/' }}
              style={{
                background: '#f3f4f6', color: '#111827', border: 'none',
                borderRadius: '0.75rem', padding: '0.875rem 1.75rem',
                fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              홈으로
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
