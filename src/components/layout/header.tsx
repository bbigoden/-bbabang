'use client'

import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Menu, X, Settings, ArrowLeft } from 'lucide-react'
import { useState, useEffect } from 'react'
import { NotificationBell } from '@/components/notification-bell'
import { useAuthOptional, signOutAndLeave } from '@/lib/auth-context'
import { homePath } from '@/lib/home-path'

interface HeaderProps {
  user?: { id: string; email?: string } | null
  role?: string | null
  unreadCount?: number
}

export function Header({ user: userProp, role: roleProp, unreadCount: _unreadCount = 0 }: HeaderProps) {
  const router = useRouter()
  const pathname = usePathname()
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
  // 단, 사무소 등록 전 중개사가 보는 등록 화면은 예외 — 모바일엔 사이드바가 없어 나갈 길(로고·뒤로·
  // 로그아웃)이 하단 탭바뿐이었다. 데스크탑은 사이드바가 맡으니 다른 화면처럼 모바일에서만 보인다.
  // '등록 전'의 기준은 등록 화면의 existing 과 같다 — 사무소를 탈퇴한 직원은 broker 행이 남아 있어도
  // (대표 아님·parent 없음) 양식을 다시 보므로, 그들에게도 헤더가 있어야 한다.
  const noOffice = !auth.broker || (auth.broker.is_owner === false && !auth.broker.parent_broker_id)
  const preOfficeRegister = isBrokerSidebarArea && !auth.loading && noOffice
    && (pathname === '/broker/register' || !!pathname?.startsWith('/broker/register/'))
  if (isBrokerSidebarArea && !preOfficeRegister) return null

  // 고객(로그인 user)은 데스크탑에 사이드바가 있으므로 데스크탑에선 헤더 숨김.
  // 모바일(< md)에선 헤더 그대로 보임 (사이드바는 hidden md:flex).
  const isCustomerSidebarArea = !!user && role !== 'broker' && role !== 'admin'

  // 이 기기만 로그아웃(scope local)·캐시·푸시 구독 정리·이동은 공용 함수가 한다
  const handleLogout = () => { signOutAndLeave() }

  // 뒤로가기 버튼 노출 조건 — 모바일·PWA에서 서브 페이지에 있을 때.
  // 루트 페이지(홈/대시보드 등)는 "뒤로 갈 곳"이 없으므로 제외.
  const ROOT_PATHS = new Set(['/', '/dashboard/broker', '/admin'])
  const NO_RETURN_PATHS = new Set(['/support', '/terms', '/privacy'])
  const isRootPage = ROOT_PATHS.has(pathname ?? '/')
  const showBack = mounted && !isRootPage
  const homeHref = user
    ? homePath(role)
    : '/'
  // 손님의 [로그인]엔 보던 화면을 redirect 로 싣는다 — 새 제안 메일을 로그아웃된 기기에서 연
  // 요청자가 헤더 [로그인]을 누르면 대시보드에 떨어져 요청을 다시 찾아 들어와야 했다.
  // - 경로만 싣는다. 쿼리까지 보려고 useSearchParams 를 헤더에 쓰면 이 헤더를 그리는 정적
  //   페이지가 Suspense 경계 없이는 클라이언트 렌더로 빠진다.
  // - 뒤로가기 버튼처럼 mount 뒤에만 붙인다(위 hydration 함정). 서버가 어긋난 경로로 그린
  //   href 가 hydration 에선 고쳐지지 않고 남는다.
  // - 홈('/')·/auth/* 는 돌아올 곳이 아니다(로그인 화면이 로그인 화면으로 돌아오는 고리).
  //   소개·고객지원·약관도 다시 볼 화면이 아니라, 역할별 첫 화면(대시보드)으로 가게 둔다.
  const loginHref = mounted && pathname && pathname !== '/' && !pathname.startsWith('/auth')
    && !NO_RETURN_PATHS.has(pathname)
    ? `/auth/login?redirect=${encodeURIComponent(pathname)}`
    : '/auth/login'
  const handleBack = () => {
    // 히스토리가 있으면 한 단계 뒤로, 없으면(직접 URL 진입·PWA 첫 화면) 역할별 홈으로
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.push(homeHref)
    }
  }

  return (
    <header className={`sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 ${isCustomerSidebarArea || preOfficeRegister ? 'md:hidden' : ''}`}>
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
                부소<span className="text-blue-600">장</span>
              </span>
            </Link>
          </div>
        ) : (
          <Link href={homeHref} className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="부소장 로고" width={36} height={36} className="h-9 w-9 rounded-xl" />
            <span className="text-xl font-bold text-gray-900 dark:text-white">
              부소<span className="text-blue-600">장</span>
            </span>
          </Link>
        )}

        {/* 데스크탑 네비 */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="주 네비게이션">
          {role === 'broker' && (
            <Link href="/dashboard/broker" className="rounded-xl px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-100 dark:bg-gray-800 transition-colors dark:text-gray-300 dark:hover:bg-gray-800">
              중개사 대시보드
            </Link>
          )}
          {user ? (
            <>
              {!isBrokerSidebarArea && <NotificationBell userId={user.id} />}
              {/* /settings 는 /settings/account 로 넘기기만 하는 페이지다. 그 주소를 미리 불러오면(prefetch)
                  넘겨진 요청이 끝나지 않고 매달려, 데스크톱 화면마다 요청 하나가 계속 열려 있었다 */}
              <Link href="/settings/account" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors" title="설정">
                <Settings className="h-5 w-5 text-gray-600 dark:text-gray-500" />
              </Link>
              <Button variant="outline" size="sm" onClick={handleLogout}>로그아웃</Button>
            </>
          ) : (
            <>
              <Link href={loginHref}>
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
            {role === 'broker' && (
              <Link href="/dashboard/broker" onClick={() => setMobileOpen(false)}>
                <Button variant="ghost" size="md" className="w-full justify-start">중개사 대시보드</Button>
              </Link>
            )}
            {user ? (
              <>
                <Link href="/settings/account" onClick={() => setMobileOpen(false)}>
                  <Button variant="ghost" size="md" className="w-full justify-start">설정</Button>
                </Link>
                <Button variant="outline" size="md" className="w-full" onClick={handleLogout}>로그아웃</Button>
              </>
            ) : (
              <>
                <Link href={loginHref} onClick={() => setMobileOpen(false)}>
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
