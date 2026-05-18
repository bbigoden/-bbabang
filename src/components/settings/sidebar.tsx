'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { User, Bell, Building2, Lock, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ItemDef {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  brokerOnly?: boolean
}

const ITEMS: ItemDef[] = [
  { href: '/settings/account', label: '내 계정', icon: User },
  { href: '/settings/notifications', label: '알림', icon: Bell },
  { href: '/settings/office', label: '사무소', icon: Building2, brokerOnly: true },
  { href: '/settings/security', label: '보안', icon: Lock },
  { href: '/settings/appearance', label: '화면 설정', icon: Sparkles },
]

export function SettingsSidebar({ isBroker }: { isBroker: boolean }) {
  const pathname = usePathname()
  const items = ITEMS.filter(i => !i.brokerOnly || isBroker)

  return (
    <nav className="md:sticky md:top-20">
      <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
        {items.map(item => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <li key={item.href} className="flex-shrink-0 md:flex-shrink">
              <Link
                href={item.href}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
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
  )
}
