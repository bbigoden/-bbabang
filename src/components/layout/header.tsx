'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Home, MessageCircle, User, Menu, X, Settings } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'
import { NotificationBell } from '@/components/notification-bell'

interface HeaderProps {
  user?: { id: string; email?: string } | null
  role?: string | null
  unreadCount?: number
}

const CACHE_KEY = 'bbabang_auth_cache_v1'

function readCachedAuth(): { user: { id: string; email?: string }; role: string | null } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (!v?.user?.id) return null
    return v
  } catch { return null }
}

export function Header({ user: userProp, role: roleProp, unreadCount = 0 }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [mobileOpen, setMobileOpen] = useState(false)

  // SSR/hydration mismatch 방지를 위해 초기값은 SSR-safe하게 props 또는 null
  const [user, setUser] = useState<any>(userProp ?? null)
  const [role, setRole] = useState<string | null>(roleProp ?? null)

  // 마운트 시: 캐시 있으면 즉시 setState (round-trip 없음), 없으면 fetch 1회 후 캐시 저장
  useEffect(() => {
    if (userProp !== undefined) return
    const cached = readCachedAuth()
    if (cached) {
      setUser(cached.user)
      setRole(cached.role)
      return
    }
    ;(async () => {
      try {
        const { data } = await supabase.auth.getUser()
        if (data.user) {
          const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
          const nextUser = { id: data.user.id, email: data.user.email ?? undefined }
          const nextRole = profile?.role ?? null
          setUser(nextUser)
          setRole(nextRole)
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ user: nextUser, role: nextRole })) } catch {}
        }
      } catch {}
    })()
  }, [])

  const handleLogout = async () => {
    try { sessionStorage.removeItem(CACHE_KEY) } catch {}
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return (
    <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* 로고 — 로그인 유저는 대시보드로, 비로그인은 홈으로 */}
        <Link href={user ? (role === 'broker' ? '/dashboard/broker' : role === 'admin' ? '/admin' : '/dashboard/user') : '/'} className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
            <Home className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">
            빠<span className="text-blue-600">방</span>
          </span>
        </Link>

        {/* 데스크탑 네비 */}
        <nav className="hidden items-center gap-1 md:flex">
          {role !== 'broker' && role !== 'admin' && pathname !== '/request/new' && (
            <Link href="/request/new" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
              매물 요청하기
            </Link>
          )}
          {role === 'broker' && (
            <>
              {pathname !== '/request/new' && (
                <Link href="/request/new?co_broker=true" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                  공동중개 요청
                </Link>
              )}
              <Link href="/dashboard/broker" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">
                중개사 대시보드
              </Link>
            </>
          )}
          {user ? (
            <>
              <NotificationBell userId={user.id} />
              <Link href="/settings" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 transition-colors" title="설정">
                <Settings className="h-5 w-5 text-gray-600" />
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
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? '메뉴 닫기' : '메뉴 열기'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* 모바일 메뉴 */}
      {mobileOpen && (
        <div className="border-t border-gray-100 bg-white px-4 py-4 md:hidden">
          <div className="flex flex-col gap-2">
            {role !== 'broker' && role !== 'admin' && (
              <Link href="/request/new" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" size="md" className="w-full justify-start">매물 요청하기</Button>
              </Link>
            )}
            {role === 'broker' && (
              <>
                <Link href="/request/new?co_broker=true" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full justify-start">공동중개 요청</Button>
                </Link>
                <Link href="/dashboard/broker" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full justify-start">중개사 대시보드</Button>
                </Link>
              </>
            )}
            {user ? (
              <>
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
