'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Home, Menu, X, Settings, Heart, Search } from 'lucide-react'
import { useState, useRef } from 'react'
import { NotificationBell } from '@/components/notification-bell'
import { useAuthOptional } from '@/lib/auth-context'

interface HeaderProps {
  user?: { id: string; email?: string } | null
  role?: string | null
  unreadCount?: number
}

export function Header({ user: userProp, role: roleProp, unreadCount: _unreadCount = 0 }: HeaderProps) {
  const _router = useRouter()
  const pathname = usePathname()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [mobileOpen, setMobileOpen] = useState(false)

  // 1순위: props (점진적 마이그레이션을 위해 기존 호출 호환)
  // 2순위: AuthContext — 페이지가 props 안 주면 root provider 값 사용
  const auth = useAuthOptional()
  const user = userProp !== undefined ? userProp : auth.user
  const role = roleProp !== undefined ? roleProp : (auth.profile?.role ?? null)

  // broker는 BrokerGlobalLayout이 모든 페이지에 사이드바를 표시하므로 헤더 항상 숨김
  // (사이드바가 홈/대시보드/공동요청/알림/로그아웃 모두 처리)
  const isBrokerSidebarArea = role === 'broker'
  if (isBrokerSidebarArea) return null

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* 로고 — 로그인 유저는 대시보드로, 비로그인은 홈으로 */}
        <Link href={user ? (role === 'broker' ? '/dashboard/broker' : role === 'admin' ? '/admin' : '/dashboard/user') : '/'} className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <Home className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900 dark:text-white">
            빠<span className="text-blue-600">방</span>
          </span>
        </Link>

        {/* 데스크탑 네비 */}
        <nav className="hidden items-center gap-1 md:flex">
          {role !== 'broker' && role !== 'admin' && pathname !== '/request/new' && (
            <Link href="/request/new" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:bg-gray-800 transition-colors dark:text-gray-300 dark:hover:bg-gray-800">
              매물 요청하기
            </Link>
          )}
          {role === 'broker' && (
            <>
              {!isBrokerSidebarArea && pathname !== '/request/new' && (
                <Link href="/request/new?co_broker=true" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:bg-gray-800 transition-colors dark:text-gray-300 dark:hover:bg-gray-800">
                  공동요청
                </Link>
              )}
              <Link href="/dashboard/broker" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:bg-gray-800 transition-colors dark:text-gray-300 dark:hover:bg-gray-800">
                중개사 대시보드
              </Link>
            </>
          )}
          {user ? (
            <>
              <Link href="/search" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors" title="통합 검색">
                <Search className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </Link>
              {role !== 'admin' && (
                <Link href="/favorites" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors" title="찜 목록">
                  <Heart className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                </Link>
              )}
              {!isBrokerSidebarArea && <NotificationBell userId={user.id} />}
              <Link href="/settings" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors" title="설정">
                <Settings className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              </Link>
              <Button variant="outline" size="sm" onClick={handleLogout}>로그아웃</Button>
            </>
          ) : (
            <>
              <Link href="/auth/login">
                <Button variant="ghost" size="sm">로그인</Button>
              </Link>
              <Link href="/auth/signup">
                <Button variant="primary" size="sm">시작하기</Button>
              </Link>
            </>
          )}
        </nav>

        {/* 모바일 메뉴 버튼 */}
        <div className="flex items-center gap-2 md:hidden">
          <Link href="/search" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors" title="검색">
            <Search className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          </Link>
          {user && <NotificationBell userId={user.id} />}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
            aria-expanded={mobileOpen}
            className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* 모바일 메뉴 */}
      {mobileOpen && (
        <div className="border-t border-gray-100 bg-white px-4 py-4 md:hidden dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-col gap-2">
            {role !== 'broker' && role !== 'admin' && (
              <Link href="/request/new" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" size="md" className="w-full justify-start">매물 요청하기</Button>
              </Link>
            )}
            {role === 'broker' && (
              <>
                <Link href="/request/new?co_broker=true" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full justify-start">공동요청</Button>
                </Link>
                <Link href="/dashboard/broker" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full justify-start">중개사 대시보드</Button>
                </Link>
              </>
            )}
            {user ? (
              <>
                {role !== 'admin' && (
                  <>
                    <Link href="/favorites" onClick={() => setMobileOpen(false)}>
                      <Button variant="ghost" size="md" className="w-full justify-start">찜 목록</Button>
                    </Link>
                    <Link href="/reviews" onClick={() => setMobileOpen(false)}>
                      <Button variant="ghost" size="md" className="w-full justify-start">내 리뷰</Button>
                    </Link>
                  </>
                )}
                <Link href="/settings" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full justify-start">설정</Button>
                </Link>
                <Button variant="outline" size="md" className="w-full" onClick={handleLogout}>로그아웃</Button>
              </>
            ) : (
              <>
                <Link href="/auth/login" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full">로그인</Button>
                </Link>
                <Link href="/auth/signup" onClick={() => setMobileOpen(false)}>
                  <Button variant="primary" size="md" className="w-full">시작하기</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
