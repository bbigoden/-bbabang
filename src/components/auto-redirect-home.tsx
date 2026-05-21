'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthOptional } from '@/lib/auth-context'

/**
 * 홈 페이지(/)에 mount되어, 로그인 사용자가 bfcache로 돌아왔을 때
 * 적절한 대시보드로 자동 이동.
 * proxy.ts의 redirect는 서버 진입 시만 작동 — bfcache 우회 시 보완.
 * ?as_visitor=1 — 어드민이 일반 사용자 화면 미리보기 시 redirect 우회.
 */
export function AutoRedirectHome() {
  const router = useRouter()
  const [asVisitor, setAsVisitor] = useState(false)
  const { user, profile, loading } = useAuthOptional()

  useEffect(() => {
    if (typeof window === 'undefined') return
    setAsVisitor(new URLSearchParams(window.location.search).get('as_visitor') === '1')
  }, [])

  useEffect(() => {
    if (loading || asVisitor) return
    if (!user) return
    const role = profile?.role
    const dest = role === 'admin' ? '/admin'
      : role === 'broker' ? '/dashboard/broker'
      : '/dashboard/user'
    router.replace(dest)
  }, [user, profile?.role, loading, router, asVisitor])

  // pageshow 이벤트로 bfcache 복원 시에도 트리거
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && user && !asVisitor) {
        const role = profile?.role
        const dest = role === 'admin' ? '/admin'
          : role === 'broker' ? '/dashboard/broker'
          : '/dashboard/user'
        router.replace(dest)
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [user, profile?.role, router, asVisitor])

  return null
}
