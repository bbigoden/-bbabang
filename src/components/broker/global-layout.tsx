'use client'

import { useAuthOptional } from '@/lib/auth-context'
import { BrokerSidebar } from './sidebar'

/**
 * broker 사용자에게 모든 페이지에서 BrokerSidebar를 일관되게 보여주는 글로벌 래퍼.
 * - broker가 아니면 children 그대로 (변화 없음)
 * - broker면 좌측에 사이드바 + 본문 flex 레이아웃
 * - 사이드바 표시 여부는 BrokerSidebar 내부 가드가 결정 (hidden md:flex 등)
 */
export function BrokerGlobalLayout({ children }: { children: React.ReactNode }) {
  const { profile, loading } = useAuthOptional()

  // 로딩 중·broker가 아닌 사용자는 사이드바 없이 그대로
  if (loading || profile?.role !== 'broker') return <>{children}</>

  return (
    <div className="flex min-h-screen">
      <BrokerSidebar />
      <div className="flex-1 min-w-0 flex flex-col bg-gray-50 dark:bg-gray-950">{children}</div>
    </div>
  )
}
