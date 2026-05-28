import type { Metadata } from 'next'
import { AdminSidebar } from '@/components/admin/sidebar'

export const metadata: Metadata = {
  title: { default: '관리자', template: '%s | 빠방 관리자' },
  robots: { index: false, follow: false },
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-950 text-gray-100">
      <AdminSidebar />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
