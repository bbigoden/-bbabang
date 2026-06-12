'use client'

import { useEffect, useRef, Component } from 'react'
import { createClient } from '@/lib/supabase/client'

const RECENT_KEYS = new Set<string>()
const RECENT_LIMIT_MS = 60_000 // 같은 에러 1분 내 중복 전송 차단

// Next.js 라우트 에러 바운더리(app/error.tsx, app/global-error.tsx)에서도 호출 →
// React 렌더 크래시가 error_logs에 남아 /admin/errors·이메일 알림으로 확인 가능
export function reportError(payload: {
  message: string
  stack?: string | null
  source: string
  url?: string
}) {
  const key = `${payload.source}::${payload.message.slice(0, 200)}`
  if (RECENT_KEYS.has(key)) return
  RECENT_KEYS.add(key)
  setTimeout(() => RECENT_KEYS.delete(key), RECENT_LIMIT_MS)

  const supabase = createClient()
  supabase.auth.getUser().then(({ data }) => {
    supabase.from('error_logs').insert({
      user_id: data.user?.id ?? null,
      message: payload.message.slice(0, 2000),
      stack: payload.stack?.slice(0, 5000) ?? null,
      source: payload.source,
      url: payload.url ?? (typeof window !== 'undefined' ? window.location.href : null),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null,
    }).then(() => {/* noop */}, () => {/* noop — 로그 실패도 무시 */})
  }).catch(() => {})
}

/**
 * 전역 window 에러·unhandled rejection 자동 수집.
 * root layout에 한 번만 마운트.
 */
export function GlobalErrorListener() {
  const installed = useRef(false)

  useEffect(() => {
    if (installed.current || typeof window === 'undefined') return
    installed.current = true

    const onError = (e: ErrorEvent) => {
      reportError({
        message: e.message || 'Unknown error',
        stack: e.error?.stack ?? null,
        source: 'client_error',
      })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: any = e.reason
      reportError({
        message: typeof reason === 'string' ? reason : (reason?.message ?? 'Unhandled rejection'),
        stack: reason?.stack ?? null,
        source: 'unhandled_rejection',
      })
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}

/**
 * React 컴포넌트 트리 에러 캡처.
 * children 렌더 중 throw하면 fallback 표시 + DB 로그.
 */
interface BoundaryState { hasError: boolean }
export class ErrorBoundary extends Component<{ children: React.ReactNode; fallback?: React.ReactNode }, BoundaryState> {
  constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError(): BoundaryState { return { hasError: true } }
  componentDidCatch(error: Error, info: { componentStack?: string }) {
    reportError({
      message: error.message,
      stack: error.stack ?? info.componentStack ?? null,
      source: 'react_boundary',
    })
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex min-h-screen items-center justify-center p-6 text-center">
          <div>
            <p className="text-lg font-bold text-gray-900 dark:text-white">화면을 표시할 수 없어요</p>
            <p className="mt-2 text-sm text-gray-500">잠시 후 새로고침해주세요. 문제가 계속되면 고객지원으로 알려주세요.</p>
            <button onClick={() => location.reload()}
              className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
              새로고침
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
