/**
 * AdminSidebar(데스크탑)와 BottomNav 모바일 드로어가 공유하는 admin 메뉴 정의.
 */
import {
  LayoutDashboard, Users, Building2, Home, Flag,
  Megaphone, BarChart3, AlertOctagon, Activity, Film, ScrollText, Sparkles, FileText,
} from 'lucide-react'

export interface AdminItemDef {
  id: string
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

export const ADMIN_ITEMS: AdminItemDef[] = [
  { id: 'dashboard',     href: '/admin',               label: '대시보드',      icon: LayoutDashboard },
  { id: 'reports',       href: '/admin/reports',       label: '신고·문의 처리', icon: Flag },
  { id: 'announcements', href: '/admin/announcements', label: '공지 발행',     icon: Megaphone },
  { id: 'curation',      href: '/admin/curation',      label: '메인 노출',     icon: Sparkles },
  { id: 'properties',    href: '/admin/properties',    label: '매물 검수',     icon: Home },
  { id: 'requests',      href: '/admin/requests',      label: '요청 관리',     icon: FileText },
  { id: 'users',         href: '/admin/users',         label: '사용자 관리',   icon: Users },
  { id: 'brokers',       href: '/admin/brokers',       label: '사무소 검수',   icon: Building2 },
  { id: 'stats',         href: '/admin/stats',         label: '통계·분석',     icon: BarChart3 },
  { id: 'shorts',        href: '/admin/shorts',        label: '쇼츠 공장',     icon: Film },
  { id: 'audit',         href: '/admin/audit',         label: '활동 로그',     icon: ScrollText },
  { id: 'errors',        href: '/admin/errors',        label: '에러 로그',     icon: AlertOctagon },
  { id: 'health',        href: '/admin/health',        label: '시스템 상태',   icon: Activity },
]
