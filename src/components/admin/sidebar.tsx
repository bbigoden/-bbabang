'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Building2, Home, Flag,
  Megaphone, BarChart3, AlertOctagon, Activity, Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ItemDef {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const ITEMS: ItemDef[] = [
  { href: '/admin', label: '대시보드', icon: LayoutDashboard },
  { href: '/admin/users', label: '사용자', icon: Users },
  { href: '/admin/brokers', label: '중개사', icon: Building2 },
  { href: '/admin/properties', label: '매물', icon: Home },
  { href: '/admin/reports', label: '신고·문의', icon: Flag },
  { href: '/admin/announcements', label: '공지', icon: Megaphone },
  { href: '/admin/stats', label: '통계', icon: BarChart3 },
  { href: '/admin/errors', label: '에러 로그', icon: AlertOctagon },
  { href: '/admin/health', label: '시스템 상태', icon: Activity },
]

export function AdminSidebar() {
  const pathname = usePathname() ?? ''

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-gray-800 md:bg-gray-900">
      {/* 브랜드 */}
      <div className="flex h-16 items-center gap-2.5 border-b border-gray-800 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
          <Shield className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">빠방 관리자</p>
          <p className="truncate text-[11px] text-gray-400">Admin Dashboard</p>
        </div>
      </div>

      {/* 메뉴 */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="flex flex-col gap-1">
          {ITEMS.map(item => {
            const active = isActive(item.href)
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-blue-500/15 text-blue-300'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </aside>
  )
}
