/**
 * BrokerSidebar(데스크탑)와 BottomNav 모바일 드로어가 공유하는 broker 메뉴 정의.
 * 한 곳에서만 수정하면 두 UI에 동시 반영됨.
 */
import { bidOf, canManageOffice } from '@/lib/office-role'
import {
  Home, Users, Building2, ClipboardList,
  FolderOpen, Calculator, UserCog, Settings, Trash2,
  User, Bell, Palette, Megaphone, Radar, LayoutDashboard, Gavel, MessagesSquare, CalendarCheck, ListChecks,
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
  /** 대표 권한(대표·이사)만 — 휴지통(11-06 사장님: "휴지통은 대표만") */
  managerOnly?: boolean
  needsOffice?: boolean
  /** 입찰을 켠 사무소(broker_profiles.bid_enabled)에만 보인다. 사장님의 건설업 일이라 다른 사무소엔 숨긴다 */
  bidOnly?: boolean
  /** 일정(예약 모으기) 시험 — 대표 + permissions.events=true 직원만(11-05 사장님: "대표와 이예리만"). 이사도 안 보인다 */
  eventsOnly?: boolean
  children?: SubItemDef[]
}

/**
 * 일정 화면을 쓸 수 있는 계정인가 — permissions.events=true 인 계정만(대표 김용유·직원 이예리, 11-05).
 * 대표에게도 표시를 요구해 다른 사무소 대표에겐 메뉴가 안 보인다. DB(office_event_can_*)는 대표를 늘 허용한다.
 */
export function canUseEvents(broker: Parameters<typeof bidOf>[0]): boolean {
  if (!broker || broker.permissions?.events !== true) return false
  return broker.is_owner !== false || broker.is_approved === true
}

/** 이 사무소에 보일 메뉴인가 — 사이드바·모바일 드로어가 같이 쓴다 */
export function showItem(i: ItemDef, broker: Parameters<typeof bidOf>[0]): boolean {
  const isOwner = broker?.is_owner !== false
  if (i.ownerOnly && !isOwner) return false
  if (i.managerOnly && !canManageOffice(broker)) return false
  // 입찰은 대표 + 이사(대표가 입찰을 켰을 때)
  if (i.bidOnly && !bidOf(broker).enabled) return false
  if (i.eventsOnly && !canUseEvents(broker)) return false
  return true
}

export const BROKER_ITEMS: ItemDef[] = [
  // 차례는 사장님이 정했다(11/03, 예약관리는 11/06 광고관리 밑으로, 부소장톡은 11/06 홈 밑으로) — 매일 쓰는 것부터, 입찰·정산·설정은 아래로.
  { id: 'dashboard',  href: '/dashboard/broker', label: '홈', icon: Home },
  // 웹사무실은 11/07 사장님이 홈 바로 밑으로(이름도 사무실 → 웹사무실)
  { id: 'office',     href: '/broker/office', label: '웹사무실', icon: LayoutDashboard, needsOffice: true },
  { id: 'messenger',  href: '/broker/messenger', label: '부소장톡', icon: MessagesSquare, needsOffice: true },
  { id: 'customers',  href: '/broker/customers', label: '고객목록', icon: Users, needsOffice: true },
  { id: 'properties', href: '/broker/properties', label: '매물목록', icon: Building2, needsOffice: true },
  // 손님 미팅에 들고 갈 매물 묶음(11-06)
  { id: 'lists',      href: '/broker/lists', label: '미팅준비', icon: ListChecks, needsOffice: true },
  { id: 'diary',      href: '/broker/diary', label: '업무일지', icon: ClipboardList, needsOffice: true },
  { id: 'naver',      href: '/broker/naver', label: '매물수집', icon: Radar, needsOffice: true },
  { id: 'ads',        href: '/broker/ads', label: '광고관리', icon: Megaphone, needsOffice: true },
  { id: 'events',     href: '/broker/events', label: '예약관리', icon: CalendarCheck, needsOffice: true, eventsOnly: true },
  { id: 'resources',  href: '/broker/resources', label: '자료실', icon: FolderOpen, needsOffice: true },
  { id: 'trash',      href: '/broker/trash', label: '휴지통', icon: Trash2, needsOffice: true, managerOnly: true },
  { id: 'bid',        href: '/broker/bid', label: '입찰', icon: Gavel, needsOffice: true, bidOnly: true },
  { id: 'settlement', href: '/broker/settlement', label: '정산', icon: Calculator, needsOffice: true },
  {
    id: 'settings', label: '설정', icon: Settings,
    children: [
      { href: '/settings/account',       label: '내 계정', icon: User },
      { href: '/settings/office',        label: '사무소', icon: Building2, ownerOnly: true, needsOffice: true },
      { href: '/broker/team',            label: '직원', icon: UserCog, ownerOnly: true, needsOffice: true },
      { href: '/settings/appearance',    label: '화면',   icon: Palette },
      { href: '/settings/notifications', label: '알림 설정', icon: Bell },  // 메뉴 아래 '알림'(받은 알림 목록)과 이름이 같아 헷갈렸다(11-06 점검)
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
