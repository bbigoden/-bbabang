'use client'

import { useAuthOptional } from '@/lib/auth-context'
import { BrokerSidebar } from './sidebar'
import { CustomerSidebar } from '@/components/customer/sidebar'

/**
 * 로그인 사용자에게 역할별 사이드바를 보여주는 글로벌 래퍼.
 * - broker: 좌측에 BrokerSidebar (h-screen flex, 헤더 숨김 — header.tsx 내부 가드)
 * - 고객(role !== broker/admin, 로그인): 데스크탑(md+)에 CustomerSidebar.
 *   모바일에서는 사이드바 hidden이라 상단 헤더 + 하단 BottomNav가 그대로 동작.
 * - 비로그인·admin: children 그대로 (변화 없음)
 *
 * 이름은 호환을 위해 BrokerGlobalLayout 유지. 내부적으로 양쪽 다 처리.
 */
export function BrokerGlobalLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuthOptional()

  if (loading) return <>{children}</>

  // 중개사 — 모든 viewport에서 사이드바 영역 (헤더는 별도 가드로 숨김)
  if (profile?.role === 'broker') {
    return (
      <div className="flex h-screen overflow-hidden">
        <BrokerSidebar />
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto bg-gray-50 dark:bg-gray-950">{children}</div>
      </div>
    )
  }

  // 고객 — 데스크탑에만 사이드바 (md+), 모바일은 기존 레이아웃 그대로
  if (profile && profile.role !== 'admin') {
    return (
      <div className="md:flex md:h-screen md:overflow-hidden">
        <CustomerSidebar />
        <div className="md:flex-1 md:min-w-0 md:flex md:flex-col md:overflow-y-auto md:bg-gray-50 dark:md:bg-gray-950">
          {children}
        </div>
      </div>
    )
  }

  // 비로그인·admin
  return <>{children}</>
}
