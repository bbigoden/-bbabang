/**
 * BrokerSidebar(데스크탑)와 BottomNav 모바일 드로어가 공유하는 broker 메뉴 정의.
 * 한 곳에서만 수정하면 두 UI에 동시 반영됨.
 */
import {
  Home, Users, Building2, ClipboardList,
  FolderOpen, Calculator, UserCog, Settings, Trash2,
  User, Bell, Palette, Handshake, Compass, CalendarDays, MessagesSquare, Briefcase,
  Megaphone, Construction, Radar, FileText, LayoutDashboard,
} from 'lucide-react'

export interface SubItemDef {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
  /** 사무소(broker_profiles)가 있어야 열리는 화면 — 등록 전엔 잠김 안내(officeLockedLabel) */
  needsOffice?: boolean
}

export interface ItemDef {
  id: string
  href?: string  // children 있으면 생략 가능
  label: string
  icon: React.ComponentType<{ className?: string }>
  ownerOnly?: boolean
  needsOffice?: boolean
  children?: SubItemDef[]
}

export const BROKER_ITEMS: ItemDef[] = [
  { id: 'dashboard',  href: '/dashboard/broker', label: '홈', icon: Home },
  { id: 'office',     href: '/broker/office', label: '사무실', icon: LayoutDashboard, needsOffice: true },
  { id: 'customers',  href: '/broker/customers', label: '고객목록', icon: Users, needsOffice: true },
  { id: 'properties', href: '/broker/properties', label: '매물목록', icon: Building2, needsOffice: true },
  { id: 'diary',      href: '/broker/diary', label: '업무일지', icon: ClipboardList, needsOffice: true },
  { id: 'ads',        href: '/broker/ads', label: '광고관리', icon: Megaphone, needsOffice: true },
  { id: 'naver',      href: '/broker/naver', label: '매물수집', icon: Radar, needsOffice: true },
  { id: 'estimates',  href: '/broker/estimates', label: '견적서', icon: FileText, ownerOnly: true, needsOffice: true },
  { id: 'resources',  href: '/broker/resources', label: '자료실', icon: FolderOpen, needsOffice: true },
  { id: 'settlement', href: '/broker/settlement', label: '정산', icon: Calculator, needsOffice: true },
  {
    id: 'settings', label: '설정', icon: Settings,
    children: [
      { href: '/settings/account',       label: '내 계정', icon: User },
      { href: '/settings/office',        label: '사무소', icon: Building2, ownerOnly: true, needsOffice: true },
      { href: '/broker/team',            label: '직원', icon: UserCog, ownerOnly: true, needsOffice: true },
      { href: '/settings/appearance',    label: '화면',   icon: Palette },
      { href: '/settings/notifications', label: '알림',   icon: Bell },
    ],
  },
  { id: 'trash', href: '/broker/trash', label: '휴지통', icon: Trash2, needsOffice: true },
  {
    id: 'wip', label: '준비중', icon: Construction,
    children: [
      { href: '/explore/requests', label: '고객요청', icon: Compass },
      { href: '/request/new?co_broker=true', label: '공동요청', icon: Handshake },
      { href: '/broker/messenger', label: '대화목록', icon: MessagesSquare, needsOffice: true },
      { href: '/broker/schedule',  label: '일정관리', icon: CalendarDays, needsOffice: true },
      { href: '/broker/jobs',      label: '구인구직', icon: Briefcase, ownerOnly: true, needsOffice: true },
    ],
  },
]

/**
 * 지금 주소가 사무소가 있어야 열리는 메뉴면 그 메뉴 이름, 아니면 null.
 * 사무소 등록 전 중개사가 이 메뉴들을 누르면 화면마다 말없이 등록 양식(휴지통은 홈)으로 보냈다 —
 * BrokerGlobalLayout 이 이 이름으로 '사무소 등록 후 쓸 수 있어요' 잠김 안내를 대신 띄운다.
 */
export function officeLockedLabel(pathname: string): string | null {
  for (const item of BROKER_ITEMS) {
    for (const m of [item, ...(item.children ?? [])]) {
      if (!m.needsOffice || !m.href) continue
      const base = m.href.split('?')[0]
      if (pathname === base || pathname.startsWith(base + '/')) return m.label
    }
  }
  return null
}
