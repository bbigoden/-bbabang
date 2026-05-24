import { Header } from '@/components/layout/header'
import { SettingsSidebar } from '@/components/settings/sidebar'
import { BrokerSidebar } from '@/components/broker/sidebar'
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
      <div className="flex">
        {isBroker && <BrokerSidebar />}
        <div className="flex-1 min-w-0">
          <div className="mx-auto max-w-5xl px-4 py-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">설정</h1>
              <p className="text-sm text-gray-500 mt-1">계정·알림·보안 등 모든 환경을 관리해요</p>
            </div>
            {isBroker ? (
              <div className="min-w-0">{children}</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
                <SettingsSidebar isBroker={false} />
                <div className="min-w-0">{children}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
