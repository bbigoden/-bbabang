'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Lock } from 'lucide-react'
import { useAuthOptional } from '@/lib/auth-context'
import { EmptyState } from '@/components/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Footer } from '@/components/layout/footer'
import { BrokerSidebar } from './sidebar'
import { officeLockedLabel } from './menu-items'

/**
 * 로그인 사용자에게 역할별 사이드바를 보여주는 글로벌 래퍼.
 * - broker: 좌측에 BrokerSidebar (h-screen flex, 헤더 숨김 — header.tsx 내부 가드)
 *   사무소 등록 전이면 사무소 메뉴 화면 대신 잠김 안내(OfficeLocked)를 그린다.
 * - 그 밖(비로그인·admin·예전 고객 계정): children 그대로
 */
export function BrokerGlobalLayout({ children }: { children: React.ReactNode }) {
  const { profile, broker, loading } = useAuthOptional()
  const pathname = usePathname() ?? ''

  if (loading) return <>{children}</>

  // 중개사 — 모든 viewport에서 사이드바 영역 (헤더는 별도 가드로 숨김)
  if (profile?.role === 'broker') {
    // 사무소가 없는데 사무소 메뉴를 열었으면 그 화면을 아예 띄우지 않는다. 화면이 뜨면 제 가드가
    // 말없이 등록 양식(휴지통은 홈)으로 보내 '왜 여기로 왔지'가 됐다. loading 이 끝난 뒤라
    // broker 는 새로 받은 값이다(auth-context 가 '사무소 없음' 캐시로는 loading 을 풀지 않는다).
    const locked = broker ? null : officeLockedLabel(pathname)
    // 바깥 칸에 relative — 없으면 표 안의 sr-only 같은 absolute 요소가 이 칸 밖(페이지 기준)으로 삐져나가
    // 폰에서 페이지가 4배 넓게 잡히고 화면이 통째로 축소됐다.
    return (
      <div className="relative flex h-screen overflow-hidden">
        <BrokerSidebar />
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto bg-gray-50 dark:bg-gray-950">
          {locked ? <OfficeLocked label={locked} /> : children}
        </div>
      </div>
    )
  }

  // 비로그인·admin·예전 고객 계정
  return <>{children}</>
}

// children(루트 layout 의 <main id="main"> + Footer) 자리를 통째로 대신하므로 같은 뼈대로 그린다
function OfficeLocked({ label }: { label: string }) {
  const { refresh } = useAuthOptional()
  // 화면에 든 broker=null 을 그대로 믿고 잠그지 않는다. 다른 탭에서 막 등록했거나(이 탭 메모리는 옛값),
  // 첫 로드에 캐시 없이 broker 조회만 실패했으면 멀쩡한 대표가 잠김 안내를 봤다. 떠 있는 동안 한 번만
  // 다시 읽고(잠긴 메뉴 사이를 오가도 안 내려가니 한 번이다), 사무소가 오면 부모가 바로 본문을 그린다.
  const [settled, setSettled] = useState(false)
  const refreshed = useRef(false)
  useEffect(() => {
    if (refreshed.current) return
    refreshed.current = true
    refresh().catch(() => {}).finally(() => setSettled(true))
  }, [refresh])

  if (!settled) {
    return (
      <>
        <main id="main" className="flex-1">
          <div className="flex items-center justify-center py-20"><Spinner size="md" /></div>
        </main>
        <Footer />
      </>
    )
  }
  return (
    <>
      <main id="main" className="flex-1">
        <div className="mx-auto w-full max-w-md px-4 py-10">
          <EmptyState
            className="px-4"
            icon={Lock}
            message={`'${label}' 메뉴는 사무소를 등록한 뒤에 쓸 수 있어요`}
            description="사무소 대표는 새 사무소를 개설하고, 직원은 대표에게 받은 사무소 코드로 합류해요."
            cta={{ label: '사무소 등록하기', href: '/broker/register' }}
          />
        </div>
      </main>
      <Footer />
    </>
  )
}
