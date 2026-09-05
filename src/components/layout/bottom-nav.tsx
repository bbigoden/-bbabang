'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuthOptional } from '@/lib/auth-context'
import { useNotificationsCtx } from '@/lib/notifications-context'
import {
  Home, Search, Bell, Heart, User, Building2, Briefcase,
  MoreHorizontal, X, ChevronDown, LogOut,
  LayoutDashboard, Flag, CalendarDays, MessagesSquare,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { BROKER_ITEMS, type ItemDef } from '@/components/broker/menu-items'
import { ADMIN_ITEMS } from '@/components/admin/menu-items'
import { useOfficeChatUnread } from '@/lib/use-office-chat-unread'

// 풀스크린이거나 자체 하단 UI가 있는 페이지는 BottomNav 숨김
const HIDDEN_PATHS = [
  // 견적서 공개 열람 — 거래처(외부인)가 보는 화면이라 부소장 껍데기를 붙이지 않는다
  '/e/',
  '/chat/',
  '/auth',
  '/account-suspended',
  '/broker/properties/', // 매물 편집 등 풀스크린
]

type NavItem = { label: string; icon: any; badge?: number } & (
  | { href: string; action?: never }
  | { href?: never; action: 'more' }
)

export function BottomNav() {
  const pathname = usePathname() ?? ''
  const { user, profile, broker, loading } = useAuthOptional()
  const { unread } = useNotificationsCtx()
  const chatUnread = useOfficeChatUnread()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  // 라우트 이동 시 드로어 자동 닫힘
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // 페이지별 숨김
  if (HIDDEN_PATHS.some(p => pathname.startsWith(p))) return null
  if (loading) return null

  const role = profile?.role ?? null

  // 역할별 탭 구성
  let items: NavItem[]

  if (!user) {
    items = [
      { href: '/', label: '홈', icon: Home },
      { href: '/explore/requests', label: '요청', icon: Search },
      { href: '/auth/login', label: '로그인', icon: User },
    ]
  } else if (role === 'broker') {
    items = [
      { href: '/dashboard/broker', label: '홈', icon: Home },
      { href: '/broker/properties', label: '매물', icon: Building2 },
      { href: '/broker/schedule', label: '일정', icon: CalendarDays },
      { href: '/broker/messenger', label: '대화', icon: MessagesSquare, badge: chatUnread },
      { action: 'more', label: '더보기', icon: MoreHorizontal, badge: unread },
    ]
  } else if (role === 'admin') {
    items = [
      { href: '/admin', label: '홈', icon: LayoutDashboard },
      { href: '/admin/reports', label: '신고', icon: Flag },
      { href: '/admin/properties', label: '매물', icon: Home },
      { href: '/admin/brokers', label: '사무소', icon: Building2 },
      { action: 'more', label: '더보기', icon: MoreHorizontal },
    ]
  } else {
    items = [
      { href: '/dashboard/user', label: '홈', icon: Home },
      { href: '/recommendations', label: '추천', icon: Briefcase },
      { href: '/favorites', label: '찜', icon: Heart },
      { href: '/notifications', label: '알림', icon: Bell, badge: unread },
      { href: '/settings/account', label: '내정보', icon: User },
    ]
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href + '/')
  }

  const isOwner = broker?.is_owner !== false
  const drawerItems: ItemDef[] = role === 'admin'
    ? ADMIN_ITEMS as ItemDef[]
    : BROKER_ITEMS.filter(i => !i.ownerOnly || isOwner)
  const toggleExpand = (id: string) => setOpenIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const handleLogout = async () => {
    try {
      const supabase = createClient()
      await supabase.auth.signOut({ scope: 'local' })  // 이 기기만 (기본 global은 전 기기 세션 삭제)
    } catch {}
    window.location.href = '/'
  }

  return (
    <>
      {/* 본문 가림 방지용 spacer */}
      <div className="md:hidden h-16" aria-hidden />

      <nav aria-label="하단 네비게이션" className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-gray-200 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="flex">
          {items.map((it, _idx) => {
            const Icon = it.icon
            const isMore = it.action === 'more'
            const active = !isMore && isActive(it.href!)

            const inner = (
              <span className="relative">
                <Icon className={`h-5 w-5 ${active ? 'stroke-[2.5]' : ''}`} />
                {it.badge !== undefined && it.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                    {it.badge > 9 ? '9+' : it.badge}
                  </span>
                )}
              </span>
            )

            const labelClass = `flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors w-full ${
              active ? 'text-blue-600' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
            }`

            return (
              <li key={isMore ? 'more' : it.href} className="flex-1">
                {isMore ? (
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    className={labelClass}
                    aria-label="더보기 메뉴 열기"
                  >
                    {inner}
                    {it.label}
                  </button>
                ) : (
                  <Link href={it.href!} className={labelClass}>
                    {inner}
                    {it.label}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* broker·admin 더보기 드로어 — 모바일 풀스크린 시트 */}
      {/* aria-label: 이름 없는 dialog는 스크린리더가 "대화상자"라고만 읽는다 */}
      {(role === 'broker' || role === 'admin') && drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="더보기 메뉴">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          {/* panel — 우측에서 슬라이드 */}
          <div className="absolute right-0 top-0 bottom-0 w-[85%] max-w-sm bg-white dark:bg-gray-900 shadow-2xl flex flex-col">
            {/* 헤더 */}
            <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-4 py-3">
              <span className="text-base font-bold text-gray-900 dark:text-white">메뉴</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-gray-800"
                aria-label="닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* 메뉴 리스트 */}
            <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="더보기 메뉴">
              <ul className="flex flex-col gap-0.5">
                {drawerItems.map((item: ItemDef) => {
                  const Icon = item.icon
                  if (item.children) {
                    const expanded = openIds.has(item.id)
                    const subItems = item.children.filter(s => !s.ownerOnly || isOwner)
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => toggleExpand(item.id)}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                          <Icon className="h-4 w-4 flex-shrink-0" />
                          <span className="flex-1 text-left">{item.label}</span>
                          <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
                        </button>
                        {expanded && (
                          <ul className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-gray-200 dark:border-gray-700 pl-2">
                            {subItems.map(sub => {
                              const SubIcon = sub.icon
                              const subActive = pathname === sub.href || pathname.startsWith(sub.href + '/')
                              return (
                                <li key={sub.href}>
                                  <Link
                                    href={sub.href}
                                    className={cn(
                                      'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium',
                                      subActive
                                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                                        : 'text-gray-600 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800',
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
                  const itemActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href + '/'))
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href!}
                        className={cn(
                          'flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold',
                          itemActive
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
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

            {/* 푸터 — 알림 + 로그아웃 */}
            <div className="border-t border-gray-200 dark:border-gray-800 p-3 flex flex-col gap-0.5">
              <Link
                href="/notifications"
                className={cn(
                  'flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold',
                  pathname === '/notifications' || pathname.startsWith('/notifications/')
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
                )}
              >
                <span className="relative">
                  <Bell className="h-4 w-4" />
                  {unread > 0 && (
                    <span className="absolute -top-1.5 -right-2 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </span>
                알림
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              >
                <LogOut className="h-4 w-4 flex-shrink-0" />
                로그아웃
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
