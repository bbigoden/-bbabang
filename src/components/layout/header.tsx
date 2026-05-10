'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Home, MessageCircle, User, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { NotificationBell } from '@/components/notification-bell'

interface HeaderProps {
  user?: { id: string; email?: string } | null
  role?: string | null
  unreadCount?: number
}

export function Header({ user, role, unreadCount = 0 }: HeaderProps) {
  const router = useRouter()
  const supabase = createClient()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* 로고 */}
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <Home className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">
            빠<span className="text-blue-600">방</span>
          </span>
        </Link>

        {/* 데스크탑 네비 */}
        <nav className="hidden items-center gap-1 md:flex">
          <Link href="/request/new" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
            매물 요청하기
          </Link>
          {role === 'broker' && (
            <Link href="/dashboard/broker" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
              중개사 대시보드
            </Link>
          )}
          {user ? (
            <>
              <Link href="/chat" className="relative flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                <MessageCircle className="h-5 w-5 text-gray-600" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Link>
              <NotificationBell userId={user.id} />
              <Link href="/dashboard/user" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
                <User className="h-5 w-5 text-gray-600" />
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
          {user && <NotificationBell userId={user.id} />}
          <button onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* 모바일 메뉴 */}
      {mobileOpen && (
        <div className="border-t border-gray-100 bg-white px-4 py-4 md:hidden">
          <div className="flex flex-col gap-2">
            <Link href="/request/new" onClick={() => setMobileOpen(false)}>
              <Button variant="ghost" size="md" className="w-full justify-start">매물 요청하기</Button>
            </Link>
            {role === 'broker' && (
              <Link href="/dashboard/broker" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" size="md" className="w-full justify-start">중개사 대시보드</Button>
              </Link>
            )}
            {user ? (
              <>
                <Link href="/chat" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full justify-start">
                    채팅
                    {unreadCount > 0 && (
                      <span className="ml-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {unreadCount}
                      </span>
                    )}
                  </Button>
                </Link>
                <Link href="/dashboard/user" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full justify-start">내 요청 관리</Button>
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
