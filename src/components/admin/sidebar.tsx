'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard, Users, Building2, Home, Flag,
  Megaphone, BarChart3, AlertOctagon, Activity, Shield, LogOut, ExternalLink, Film,
  Menu, X,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface ItemDef {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const ITEMS: ItemDef[] = [
  { href: '/admin', label: '대시보드', icon: LayoutDashboard },
  { href: '/admin/reports', label: '신고·문의 처리', icon: Flag },
  { href: '/admin/announcements', label: '공지 발행', icon: Megaphone },
  { href: '/admin/properties', label: '매물 검수', icon: Home },
  { href: '/admin/users', label: '사용자 관리', icon: Users },
  { href: '/admin/brokers', label: '사무소 검수', icon: Building2 },
  { href: '/admin/stats', label: '통계·분석', icon: BarChart3 },
  { href: '/admin/shorts', label: '쇼츠 공장', icon: Film },
  { href: '/admin/errors', label: '에러 로그', icon: AlertOctagon },
  { href: '/admin/health', label: '시스템 상태', icon: Activity },
]

export function AdminSidebar() {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const auth = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  // 경로 변경 시 모바일 메뉴 자동 닫기
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // 모바일 메뉴 열렸을 때 body 스크롤 잠금
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [mobileOpen])

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
  }

  // admin 권한 없으면 사이드바 자체를 렌더하지 않음 (page.tsx의 가드와 별개로 UI 노출 차단)
  if (auth.loading || auth.profile?.role !== 'admin') return null

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname === href || pathname.startsWith(href + '/')
  }

  const currentLabel = ITEMS.find(i => isActive(i.href))?.label ?? '관리자'

  const MenuBody = (
    <>
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

      <div className="border-t border-gray-800 px-3 py-3 flex flex-col gap-0.5">
        <Link
          href="/?as_visitor=1"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
        >
          <ExternalLink className="h-4 w-4 flex-shrink-0" />
          사이트 보기
        </Link>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-400 hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          로그아웃
        </button>
      </div>
    </>
  )

  return (
    <>
      {/* 데스크톱 사이드바 */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-gray-800 md:bg-gray-900 sticky top-0 h-screen">
        <div className="flex h-16 items-center gap-2.5 border-b border-gray-800 px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">빠방 관리자</p>
            <p className="truncate text-[11px] text-gray-400">Admin Dashboard</p>
          </div>
        </div>
        {MenuBody}
      </aside>

      {/* 모바일 상단 바 */}
      <div className="md:hidden sticky top-0 z-30 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-900 px-3">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="관리자 메뉴 열기"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-gray-300 hover:bg-gray-800"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <p className="text-sm font-semibold text-white">{currentLabel}</p>
        </div>
        <div className="w-10" />
      </div>

      {/* 모바일 드로어 */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-gray-900 shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-gray-800 px-5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
                  <Shield className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">빠방 관리자</p>
                  <p className="truncate text-[11px] text-gray-400">Admin Dashboard</p>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="관리자 메뉴 닫기"
                className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-400 hover:bg-gray-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {MenuBody}
          </aside>
        </div>
      )}
    </>
  )
}
