'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthOptional } from '@/lib/auth-context'

/**
 * 홈 페이지(/)에 mount되어, 로그인 사용자가 bfcache로 돌아왔을 때
 * 적절한 대시보드로 자동 이동.
 * proxy.ts의 redirect는 서버 진입 시만 작동 — bfcache 우회 시 보완.
 */
export function AutoRedirectHome() {
  const router = useRouter()
  const { user, profile, loading } = useAuthOptional()

  useEffect(() => {
    if (loading) return
    if (!user) return
    const role = profile?.role
    const dest = role === 'admin' ? '/admin'
      : role === 'broker' ? '/dashboard/broker'
      : '/dashboard/user'
    router.replace(dest)
  }, [user, profile?.role, loading, router])

  // pageshow 이벤트로 bfcache 복원 시에도 트리거
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted && user) {
        const role = profile?.role
        const dest = role === 'admin' ? '/admin'
          : role === 'broker' ? '/dashboard/broker'
          : '/dashboard/user'
        router.replace(dest)
      }
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [user, profile?.role, router])

  return null
}
