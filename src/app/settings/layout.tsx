import { Header } from '@/components/layout/header'
import { SettingsSidebar } from '@/components/settings/sidebar'
import { PageHeader } from '@/components/layout/page-header'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = { title: '설정' }

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isBroker = profile?.role === 'broker'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          title="설정"
          description="계정·알림·보안 등 모든 환경을 관리해요"
        />
        {isBroker ? (
          // broker는 root layout의 BrokerGlobalLayout이 좌측 사이드바를 표시 → settings 자체 사이드바 생략
          <div className="min-w-0">{children}</div>
        ) : (
          <>
            {/* 모바일만: 글로벌 사이드바가 없으니 가로 스크롤 탭 표시 */}
            <div className="md:hidden mb-4">
              <SettingsSidebar isBroker={false} />
            </div>
            {/* 데스크톱: 글로벌 CustomerSidebar가 이미 설정 자식 메뉴를 처리 → 중복 제거 */}
            <div className="min-w-0">{children}</div>
          </>
        )}
      </div>
    </div>
  )
}
