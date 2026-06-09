/**
 * CustomerSidebar(데스크탑)와 BottomNav 모바일 드로어가 공유할 수 있는 고객 메뉴 정의.
 * 한 곳에서만 수정하면 두 UI에 동시 반영됨 (broker 패턴과 동일).
 */
import {
  Home, Plus, Sparkles, Building2, Search, Compass,
  Heart, History, Bookmark, Star, Settings, User,
  Palette, Bell, HelpCircle, FileText,
} from 'lucide-react'

export interface CustomerSubItemDef {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export interface CustomerItemDef {
  id: string
  href?: string  // children 있으면 생략 가능
  label: string
  icon: React.ComponentType<{ className?: string }>
  children?: CustomerSubItemDef[]
}

export const CUSTOMER_ITEMS: CustomerItemDef[] = [
  { id: 'dashboard',   href: '/dashboard/user',    label: '홈',         icon: Home },
  { id: 'request-new', href: '/request/new',       label: '매물 요청',  icon: Plus },
  { id: 'recommend',   href: '/recommendations',   label: '추천 매물',  icon: Sparkles },
  { id: 'brokers',     href: '/brokers',           label: '중개사',     icon: Building2 },
  { id: 'explore',     href: '/explore/requests',  label: '실시간 요청', icon: Compass },
  { id: 'search',      href: '/search',            label: '통합 검색',  icon: Search },
  {
    id: 'my', label: '내 활동', icon: FileText,
    children: [
      { href: '/favorites',      label: '찜 목록',     icon: Heart },
      { href: '/history',        label: '최근 본',     icon: History },
      { href: '/saved-searches', label: '저장한 검색', icon: Bookmark },
      { href: '/reviews',        label: '내 리뷰',     icon: Star },
    ],
  },
  {
    id: 'settings', label: '설정', icon: Settings,
    children: [
      { href: '/settings/account',       label: '내 계정', icon: User },
      { href: '/settings/appearance',    label: '화면',    icon: Palette },
      { href: '/settings/notifications', label: '알림',    icon: Bell },
    ],
  },
  { id: 'support', href: '/support', label: '고객지원', icon: HelpCircle },
]
