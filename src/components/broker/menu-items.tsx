/**
 * BrokerSidebar(데스크탑)와 BottomNav 모바일 드로어가 공유하는 broker 메뉴 정의.
 * 한 곳에서만 수정하면 두 UI에 동시 반영됨.
 */
import {
  Home, Users, Building2, ClipboardList,
  FolderOpen, Calculator, UserCog, Settings, Trash2,
  User, Bell, Palette, Handshake, Compass, CalendarDays, MessagesSquare, Briefcase,
} from 'lucide-react'

export interface SubItemDef {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
}

export interface ItemDef {
  id: string
  href?: string  // children 있으면 생략 가능
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
  children?: SubItemDef[]
}

export const BROKER_ITEMS: ItemDef[] = [
  { id: 'dashboard',  href: '/dashboard/broker', label: '홈', icon: Home },
  { id: 'customers',  href: '/broker/customers', label: '고객목록', icon: Users },
  { id: 'properties', href: '/broker/properties', label: '매물목록', icon: Building2 },
  { id: 'diary',      href: '/broker/diary', label: '업무일지', icon: ClipboardList },
  { id: 'explore',    href: '/explore/requests', label: '고객요청', icon: Compass },
  { id: 'co-broker',  href: '/request/new?co_broker=true', label: '공동요청', icon: Handshake },
  { id: 'messenger',  href: '/broker/messenger', label: '대화목록', icon: MessagesSquare },
  { id: 'schedule',   href: '/broker/schedule', label: '일정관리', icon: CalendarDays },
  { id: 'resources',  href: '/broker/resources', label: '자료실', icon: FolderOpen },
  { id: 'settlement', href: '/broker/settlement', label: '정산', icon: Calculator },
  { id: 'jobs',       href: '/broker/jobs', label: '구인공고', icon: Briefcase, ownerOnly: true },
  {
    id: 'settings', label: '설정', icon: Settings,
    children: [
      { href: '/settings/account',       label: '내 계정', icon: User },
      { href: '/settings/office',        label: '사무소', icon: Building2, ownerOnly: true },
      { href: '/broker/team',            label: '직원', icon: UserCog, ownerOnly: true },
      { href: '/settings/appearance',    label: '화면',   icon: Palette },
      { href: '/settings/notifications', label: '알림',   icon: Bell },
    ],
  },
  { id: 'trash', href: '/broker/trash', label: '휴지통', icon: Trash2 },
]
