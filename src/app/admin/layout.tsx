import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/admin/sidebar'

export const metadata: Metadata = {
  title: { default: '관리자', template: '%s | 부소장 관리자' },
  robots: { index: false, follow: false },
}

// 관리자 화면은 지금까지 role 검증이 각 페이지의 클라이언트 훅에만 있었다
// (admin/requests 한 곳만 서버 검증). 실제 데이터는 RLS가 막고 있었지만,
// 관리자 화면 구조와 번들이 아무에게나 노출되고 RLS에 구멍이 하나 생기는 순간
// 그대로 관리자 기능이 된다. 서버에서 한 번에 막는다.
export default async function Layout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/admin')
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profile?.role !== 'admin') redirect('/')

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-950 text-gray-100">
      <AdminSidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
