'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, ExternalLink } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { ADMIN_ITEMS } from './menu-items'

export function AdminSidebar() {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const auth = useAuth()

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut({ scope: 'local' })  // 이 기기만 (기본 global은 전 기기 세션 삭제)
    router.push('/')
  }

  // admin 권한 없으면 사이드바 자체를 렌더하지 않음 (page.tsx의 가드와 별개로 UI 노출 차단)
  if (auth.loading || auth.profile?.role !== 'admin') return null

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin'
    return pathname === href || pathname.startsWith(href + '/')
  }

  // 데스크톱 사이드바만 — 모바일은 BottomNav로 이동 (broker와 패턴 통일)
  return (
    <aside aria-label="관리자 메뉴" className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-gray-800 md:bg-gray-900 sticky top-0 h-screen">
      {/* CustomerSidebar/BrokerSidebar와 동일 패턴: 로고 PNG + 빠방 텍스트 + 권한 부제 */}
      <div className="flex items-center gap-2 border-b border-gray-800 px-3 py-3">
        <Link href="/admin" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="빠방 로고" width={28} height={28} className="h-7 w-7 rounded-lg" />
          <div className="min-w-0">
            <p className="text-base font-bold text-white">
              빠<span className="text-blue-400">방</span>
              <span className="ml-1.5 text-[11px] font-medium text-gray-400">관리자</span>
            </p>
          </div>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="관리자 사이드바">
        <ul className="flex flex-col gap-1">
          {ADMIN_ITEMS.map(item => {
            const active = isActive(item.href)
            const Icon = item.icon
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-blue-500/15 text-blue-300'
                      : 'text-gray-300 hover:bg-gray-800 hover:text-white',
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
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
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
    </aside>
  )
}
