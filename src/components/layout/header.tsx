'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Menu, X, Settings, Heart, Search, ArrowLeft } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { NotificationBell } from '@/components/notification-bell'
import { useAuthOptional } from '@/lib/auth-context'

interface HeaderProps {
  user?: { id: string; email?: string } | null
  role?: string | null
  unreadCount?: number
}

export function Header({ user: userProp, role: roleProp, unreadCount: _unreadCount = 0 }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [mobileOpen, setMobileOpen] = useState(false)
  // 정적 프리렌더 페이지(홈)가 rewrite/Proxy 경유 요청으로 ISR 재생성되면 usePathname()이
  // 브라우저 실제 경로와 어긋난 값으로 렌더돼 hydration mismatch(#418)가 난다 —
  // use-pathname.md가 명시한 함정. 경로 의존 UI(뒤로가기)는 서버·첫 클라이언트 렌더에서
  // 항상 로고로 고정하고 mount 후에만 분기한다 (문서 권고 완화책).
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // 1순위: props (점진적 마이그레이션을 위해 기존 호출 호환)
  // 2순위: AuthContext — 페이지가 props 안 주면 root provider 값 사용
  const auth = useAuthOptional()
  const user = userProp !== undefined ? userProp : auth.user
  const role = roleProp !== undefined ? roleProp : (auth.profile?.role ?? null)

  // broker는 BrokerGlobalLayout이 모든 viewport에서 사이드바를 표시하므로 헤더 항상 숨김
  // (사이드바가 홈/대시보드/공동요청/알림/로그아웃 모두 처리)
  const isBrokerSidebarArea = role === 'broker'
  if (isBrokerSidebarArea) return null

  // 고객(로그인 user)은 데스크탑에 사이드바가 있으므로 데스크탑에선 헤더 숨김.
  // 모바일(< md)에선 헤더 그대로 보임 (사이드바는 hidden md:flex).
  const isCustomerSidebarArea = !!user && role !== 'broker' && role !== 'admin'

  const handleLogout = async () => {
    // scope:'local' — 이 기기만 로그아웃. 기본값 'global'은 서버에서 그 계정의
    // 모든 세션을 지워서, PC에서 로그아웃하면 폰 PWA까지 같이 풀린다.
    await supabase.auth.signOut({ scope: 'local' })
    window.location.href = '/'
  }

  // 뒤로가기 버튼 노출 조건 — 모바일·PWA에서 서브 페이지에 있을 때.
  // 루트 페이지(홈/대시보드 등)는 "뒤로 갈 곳"이 없으므로 제외.
  const ROOT_PATHS = new Set(['/', '/dashboard/user', '/dashboard/broker', '/admin'])
  const isRootPage = ROOT_PATHS.has(pathname ?? '/')
  const showBack = mounted && !isRootPage
  const homeHref = user
    ? (role === 'broker' ? '/dashboard/broker' : role === 'admin' ? '/admin' : '/dashboard/user')
    : '/'
  const handleBack = () => {
    // 히스토리가 있으면 한 단계 뒤로, 없으면(직접 URL 진입·PWA 첫 화면) 역할별 홈으로
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(homeHref)
    }
  }

  return (
    <header className={`sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 ${isCustomerSidebarArea ? 'md:hidden' : ''}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* 좌측: 모바일 서브 페이지엔 ← 뒤로 (PWA에서 브라우저 뒤로가 없음). 그 외엔 로고. */}
        {showBack ? (
          <div className="flex items-center gap-1 md:gap-2">
            <button
              type="button"
              onClick={handleBack}
              className="md:hidden flex h-10 w-10 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors -ml-1"
              aria-label="뒤로 가기"
            >
              <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-gray-300" />
            </button>
            <Link href={homeHref} className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="부소장 로고" width={36} height={36} className="h-9 w-9 rounded-xl" />
              <span className="text-xl font-bold text-gray-900 dark:text-white">
                빠<span className="text-blue-600">방</span>
              </span>
            </Link>
          </div>
        ) : (
          <Link href={homeHref} className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="부소장 로고" width={36} height={36} className="h-9 w-9 rounded-xl" />
            <span className="text-xl font-bold text-gray-900 dark:text-white">
              빠<span className="text-blue-600">방</span>
            </span>
          </Link>
        )}

        {/* 데스크탑 네비 */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="주 네비게이션">
          {role !== 'broker' && role !== 'admin' && pathname !== '/request/new' && (
            <Link href="/request/new" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-100 dark:bg-gray-800 transition-colors dark:text-gray-300 dark:hover:bg-gray-800">
              매물 요청하기
            </Link>
          )}
          {role === 'broker' && (
            <>
              {!isBrokerSidebarArea && pathname !== '/request/new' && (
                <Link href="/request/new?co_broker=true" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-100 dark:bg-gray-800 transition-colors dark:text-gray-300 dark:hover:bg-gray-800">
                  공동요청
                </Link>
              )}
              <Link href="/dashboard/broker" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-100 dark:bg-gray-800 transition-colors dark:text-gray-300 dark:hover:bg-gray-800">
                중개사 대시보드
              </Link>
            </>
          )}
          {user ? (
            <>
              <Link href="/search" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors" title="통합 검색">
                <Search className="h-5 w-5 text-gray-600 dark:text-gray-500" />
              </Link>
              {role !== 'admin' && (
                <Link href="/favorites" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors" title="찜 목록">
                  <Heart className="h-5 w-5 text-gray-600 dark:text-gray-500" />
                </Link>
              )}
              {!isBrokerSidebarArea && <NotificationBell userId={user.id} />}
              <Link href="/settings" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors" title="설정">
                <Settings className="h-5 w-5 text-gray-600 dark:text-gray-500" />
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
            <Search className="h-5 w-5 text-gray-600 dark:text-gray-500" />
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
