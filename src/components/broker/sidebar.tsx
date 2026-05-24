'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Building2, ClipboardList, MessageCircle,
  FolderOpen, BarChart2, Calculator, UserCog, Settings, Trash2, Archive,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthOptional } from '@/lib/auth-context'

interface ItemDef {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
}

// 대시보드 빠른 메뉴 4×3 그리드 순서와 일치
const ITEMS: ItemDef[] = [
  { href: '/dashboard/broker', label: '대시보드', icon: LayoutDashboard },
  { href: '/broker/customers', label: '고객목록', icon: Users },
  { href: '/broker/properties', label: '매물목록', icon: Building2 },
  { href: '/broker/diary', label: '업무일지', icon: ClipboardList },
  { href: '/broker/chats', label: '대화목록', icon: MessageCircle },
  { href: '/broker/resources', label: '자료실', icon: FolderOpen },
  { href: '/broker/stats', label: '실적 분석', icon: BarChart2 },
  { href: '/broker/settlement', label: '정산', icon: Calculator },
  { href: '/broker/team', label: '팀 관리', icon: UserCog, ownerOnly: true },
  { href: '/settings/office', label: '사무소 설정', icon: Settings, ownerOnly: true },
  { href: '/broker/trash', label: '휴지통', icon: Trash2 },
  { href: '/broker/archive', label: '퇴사자 일지', icon: Archive, ownerOnly: true },
]

export function BrokerSidebar() {
  const pathname = usePathname() ?? ''
  const { profile, broker, loading } = useAuthOptional()

  // 권한 가드: 중개사 본인만 노출
  // - 로딩 중이거나 비-broker → 사이드바 숨김 (일반 사용자가 보는 /broker/[id] 보호)
  if (loading) return null
  if (profile?.role !== 'broker') return null

  // /broker/[id] 패턴(중개사 프로필 페이지)에서는 숨김
  // - /broker/customers 같은 영역 페이지는 'customers' 등 정해진 단어
  // - /broker/abc-uuid 처럼 알 수 없는 슬러그면 [id] 페이지로 간주
  const knownTopLevel = new Set([
    'customers', 'properties', 'diary', 'chats', 'resources',
    'stats', 'settlement', 'team', 'trash', 'archive',
    'register', 'settings',
  ])
  const brokerSeg = pathname.startsWith('/broker/') ? pathname.split('/')[2] : null
  if (brokerSeg && !knownTopLevel.has(brokerSeg)) return null

  const isOwner = broker?.is_owner !== false
  const items = ITEMS.filter(i => !i.ownerOnly || isOwner)

  const isActive = (href: string) => {
    if (href === '/dashboard/broker') return pathname === '/dashboard/broker'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <aside className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-gray-200 md:bg-white dark:md:border-gray-800 dark:md:bg-gray-900 md:sticky md:top-0 md:h-screen md:overflow-y-auto">
      {/* 메뉴 */}
      <nav className="flex-1 px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {items.map(item => {
            const active = isActive(item.href)
            const Icon = item.icon
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white',
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
    </aside>
  )
}
