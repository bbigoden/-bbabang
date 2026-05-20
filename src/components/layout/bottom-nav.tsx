'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuthOptional } from '@/lib/auth-context'
import { useNotificationsCtx } from '@/lib/notifications-context'
import { Home, Search, Bell, Heart, User, Building2, MessageCircle, Briefcase } from 'lucide-react'

// 풀스크린이거나 자체 하단 UI가 있는 페이지는 BottomNav 숨김
const HIDDEN_PATHS = [
  '/chat/',
  '/request/', // request/[id]는 자체 하단 탭 보유, request/new·edit·propose도 풀스크린 폼
  '/admin',
  '/auth',
  '/account-suspended',
  '/broker/properties/', // 매물 편집 등 풀스크린
]

export function BottomNav() {
  const pathname = usePathname() ?? ''
  const { user, profile, loading } = useAuthOptional()
  const { unread } = useNotificationsCtx()

  // 페이지별 숨김
  if (HIDDEN_PATHS.some(p => pathname.startsWith(p))) return null
  if (loading) return null

  const role = profile?.role ?? null

  // 역할별 탭 구성
  let items: { href: string; label: string; icon: any; badge?: number }[]

  if (!user) {
    items = [
      { href: '/', label: '홈', icon: Home },
      { href: '/explore/requests', label: '요청', icon: Search },
      { href: '/brokers', label: '중개사', icon: Building2 },
      { href: '/auth/login', label: '로그인', icon: User },
    ]
  } else if (role === 'broker') {
    items = [
      { href: '/dashboard/broker', label: '대시보드', icon: Home },
      { href: '/explore/requests', label: '요청 둘러보기', icon: Search },
      { href: '/broker/chats', label: '채팅', icon: MessageCircle },
      { href: '/notifications', label: '알림', icon: Bell, badge: unread },
      { href: '/settings/account', label: '내정보', icon: User },
    ]
  } else if (role === 'admin') {
    // admin은 자체 헤더에 메뉴가 충분
    return null
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

  return (
    <>
      {/* 본문 가림 방지용 spacer */}
      <div className="md:hidden h-16" aria-hidden />

      <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-gray-200 bg-white/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <ul className="flex">
          {items.map(it => {
            const active = isActive(it.href)
            const Icon = it.icon
            return (
              <li key={it.href} className="flex-1">
                <Link href={it.href}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors ${
                    active ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  <span className="relative">
                    <Icon className={`h-5 w-5 ${active ? 'stroke-[2.5]' : ''}`} />
                    {it.badge !== undefined && it.badge > 0 && (
                      <span className="absolute -top-1.5 -right-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                        {it.badge > 9 ? '9+' : it.badge}
                      </span>
                    )}
                  </span>
                  {it.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
