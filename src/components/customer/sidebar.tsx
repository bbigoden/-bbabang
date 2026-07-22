'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ChevronDown, PanelLeftClose, PanelLeftOpen, LogOut, Bell,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthOptional } from '@/lib/auth-context'
import { useNotificationsCtx } from '@/lib/notifications-context'
import { createClient } from '@/lib/supabase/client'
import { CUSTOMER_ITEMS as ITEMS, type CustomerItemDef } from './menu-items'

const COLLAPSED_KEY = 'bbabang_customer_sidebar_collapsed'

/**
 * 고객(일반 사용자) 데스크탑 사이드바.
 * - 모바일에서는 hidden md:flex로 숨김 (모바일은 BottomNav + 상단 헤더 ← 가 처리)
 * - 비로그인/중개사/관리자에게는 노출 안 됨 (자체 가드)
 * - 패턴은 BrokerSidebar와 동일 (시각 일관성)
 */
export function CustomerSidebar() {
  const pathname = usePathname() ?? ''
  const { profile, loading } = useAuthOptional()
  const { unread } = useNotificationsCtx()
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState(false)

  // localStorage에서 접힘 상태 복원
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === '1') setCollapsed(true)
    } catch {}
  }, [])

  // 현재 경로가 자식 메뉴에 속하면 부모 아코디언 자동 펼침
  useEffect(() => {
    setOpenIds(prev => {
      let changed = false
      const next = new Set(prev)
      for (const item of ITEMS) {
        if (item.children?.some(c => pathname === c.href || pathname.startsWith(c.href + '/'))) {
          if (!next.has(item.id)) { next.add(item.id); changed = true }
        }
      }
      return changed ? next : prev
    })
  }, [pathname])

  // 권한 가드: 비로그인·중개사·관리자는 노출 안 함
  if (loading) return null
  if (!profile) return null
  if (profile.role === 'broker' || profile.role === 'admin') return null

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    if (href === '/dashboard/user') return pathname === '/dashboard/user'
    return pathname === href || pathname.startsWith(href + '/')
  }

  const isExpanded = (item: CustomerItemDef) => !!item.children && openIds.has(item.id)
  const toggleExpand = (id: string) => setOpenIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const toggleCollapsed = () => {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch {}
      return next
    })
  }

  const handleLogout = async () => {
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch {}
    window.location.href = '/'
  }

  return (
    <aside
      aria-label="내 메뉴"
      className={cn(
        'hidden md:flex md:flex-col md:border-r md:border-gray-200 md:bg-white dark:md:border-gray-800 dark:md:bg-gray-900 md:sticky md:top-0 md:h-screen md:overflow-y-auto transition-[width] duration-200',
        collapsed ? 'md:w-14' : 'md:w-56',
      )}
    >
      {/* 상단: 로고 + 접기/펼치기 토글 */}
      <div className={cn(
        'flex items-center border-b border-gray-200 dark:border-gray-800 py-3',
        collapsed ? 'justify-center px-2' : 'justify-between px-3',
      )}>
        {!collapsed && (
          <Link href="/dashboard/user" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="빠방 로고" width={28} height={28} className="h-7 w-7 rounded-lg" />
            <span className="text-base font-bold text-gray-900 dark:text-white">
              빠<span className="text-blue-600">방</span>
            </span>
          </Link>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          title={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-white transition-colors"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* 메뉴 */}
      <nav className="flex-1 px-3 py-4" aria-label="고객 사이드바">
        <ul className="flex flex-col gap-0.5">
          {ITEMS.map(item => {
            const Icon = item.icon
            // 아코디언(children) — 접힘 모드에선 자식 메뉴 펼치지 않음
            if (item.children) {
              const expanded = !collapsed && isExpanded(item)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => !collapsed && toggleExpand(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl py-2.5 text-sm font-semibold transition-colors',
                      'text-gray-600 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white',
                      collapsed ? 'justify-center px-0' : 'px-3',
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-left">{item.label}</span>
                        <ChevronDown className={cn('h-4 w-4 flex-shrink-0 transition-transform', expanded && 'rotate-180')} />
                      </>
                    )}
                  </button>
                  {expanded && (
                    <ul className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-gray-200 dark:border-gray-700 pl-2">
                      {item.children.map(sub => {
                        const SubIcon = sub.icon
                        const subActive = isActive(sub.href)
                        return (
                          <li key={sub.href}>
                            <Link
                              href={sub.href}
                              className={cn(
                                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                subActive
                                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                                  : 'text-gray-500 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white',
                              )}
                            >
                              <SubIcon className="h-3.5 w-3.5 flex-shrink-0" />
                              {sub.label}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </li>
              )
            }
            const active = isActive(item.href!)
            return (
              <li key={item.id}>
                <Link
                  href={item.href!}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl py-2.5 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      : 'text-gray-600 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white',
                    collapsed ? 'justify-center px-0' : 'px-3',
                  )}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {!collapsed && item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* 하단: 알림 + 로그아웃 */}
      <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex flex-col gap-0.5">
        {/* 알림 */}
        <Link
          href="/notifications"
          title={collapsed ? `알림${unread > 0 ? ` (${unread})` : ''}` : undefined}
          className={cn(
            'flex items-center gap-2.5 rounded-xl py-2.5 text-sm font-semibold transition-colors',
            isActive('/notifications')
              ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
              : 'text-gray-600 dark:text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white',
            collapsed ? 'justify-center px-0' : 'px-3',
          )}
        >
          <span className="relative flex-shrink-0">
            <Bell className="h-4 w-4" />
            {unread > 0 && (
              <span className={cn(
                'absolute flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white',
                collapsed ? '-top-1 -right-1.5' : '-top-1.5 -right-2',
              )}>
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </span>
          {!collapsed && '알림'}
        </Link>

        {/* 로그아웃 */}
        <button
          type="button"
          onClick={handleLogout}
          title={collapsed ? '로그아웃' : undefined}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl py-2.5 text-sm font-semibold transition-colors',
            'text-gray-600 dark:text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400',
            collapsed ? 'justify-center px-0' : 'px-3',
          )}
        >
          <LogOut className="h-4 w-4 flex-shrink-0" />
          {!collapsed && '로그아웃'}
        </button>
      </div>
    </aside>
  )
}
