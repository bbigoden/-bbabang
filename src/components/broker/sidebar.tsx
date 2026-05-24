'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Building2, ClipboardList, MessageCircle,
  FolderOpen, BarChart2, Calculator, UserCog, Settings, Trash2,
  User, Bell, Palette, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthOptional } from '@/lib/auth-context'

interface SubItemDef {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
}

interface ItemDef {
  id: string
  href?: string  // children 있으면 생략 가능
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
  children?: SubItemDef[]
}

// 대시보드 빠른 메뉴 4×3 그리드 순서와 일치
const ITEMS: ItemDef[] = [
  { id: 'dashboard',  href: '/dashboard/broker', label: '대시보드', icon: LayoutDashboard },
  { id: 'customers',  href: '/broker/customers', label: '고객목록', icon: Users },
  { id: 'properties', href: '/broker/properties', label: '매물목록', icon: Building2 },
  { id: 'diary',      href: '/broker/diary', label: '업무일지', icon: ClipboardList },
  { id: 'chats',      href: '/broker/chats', label: '대화목록', icon: MessageCircle },
  { id: 'resources',  href: '/broker/resources', label: '자료실', icon: FolderOpen },
  { id: 'stats',      href: '/broker/stats', label: '실적 분석', icon: BarChart2 },
  { id: 'settlement', href: '/broker/settlement', label: '정산', icon: Calculator },
  { id: 'team',       href: '/broker/team', label: '팀 관리', icon: UserCog, ownerOnly: true },
  {
    id: 'settings', label: '설정', icon: Settings,
    children: [
      { href: '/settings/account',       label: '내 계정', icon: User },
      { href: '/settings/notifications', label: '알림',   icon: Bell },
      { href: '/settings/appearance',    label: '화면',   icon: Palette },
      { href: '/settings/office',        label: '사무소', icon: Building2, ownerOnly: true },
    ],
  },
  { id: 'trash', href: '/broker/trash', label: '휴지통', icon: Trash2 },
]

export function BrokerSidebar() {
  const pathname = usePathname() ?? ''
  const { profile, broker, loading } = useAuthOptional()
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())

  // settings 경로 진입 시 '설정' 아코디언 자동 펼침 (사용자가 접으면 다시 안 펼침)
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

  // 권한 가드: 중개사 본인만 노출
  if (loading) return null
  if (profile?.role !== 'broker') return null

  // /broker/[id] 패턴(중개사 프로필 페이지)에서는 숨김
  const knownTopLevel = new Set([
    'customers', 'properties', 'diary', 'chats', 'resources',
    'stats', 'settlement', 'team', 'trash',
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

  // 아코디언 펼침/접힘: 사용자 토글 우선, settings 진입 시 위 useEffect가 자동 펼침
  const isExpanded = (item: ItemDef) => !!item.children && openIds.has(item.id)
  const toggleExpand = (id: string) => setOpenIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <aside className="hidden md:flex md:w-56 md:flex-col md:border-r md:border-gray-200 md:bg-white dark:md:border-gray-800 dark:md:bg-gray-900 md:sticky md:top-0 md:h-screen md:overflow-y-auto">
      <nav className="flex-1 px-3 py-4">
        <ul className="flex flex-col gap-0.5">
          {items.map(item => {
            const Icon = item.icon
            if (item.children) {
              const expanded = isExpanded(item)
              const subItems = item.children.filter(s => !s.ownerOnly || isOwner)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(item.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                      'text-gray-600 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    <span className="flex-1 text-left">{item.label}</span>
                    <ChevronDown className={cn('h-4 w-4 flex-shrink-0 transition-transform', expanded && 'rotate-180')} />
                  </button>
                  {expanded && (
                    <ul className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-gray-200 dark:border-gray-700 pl-2">
                      {subItems.map(sub => {
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
                                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white',
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
