'use client'

import { useEffect, useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { logAdminAction } from '@/lib/audit'
import { PROPERTY_STATUS_META, propertyStatusLabel } from '@/lib/property-status'
import { formatDate, formatPrice } from '@/lib/utils'
import {
  Users, Building2, FileText,
  CheckCircle, XCircle, ExternalLink,
  StickyNote, MapPin, X, Phone, Mail, Home, Calendar,
  Hash, ChevronRight, ChevronDown, Table2, Flag, Clock, AlertTriangle
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { OfficeCard } from '@/components/office-card'
import { EmployeeRow } from '@/components/employee-row'
import { EmptyState, EmptyTableRow } from '@/components/empty-state'
import { Spinner } from '@/components/ui/spinner'

// ── 모달 래퍼 ──────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId()
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-lg max-h-[90vh] sm:max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 sm:px-6 py-3 sm:py-4">
          <h3 id={titleId} className="font-bold text-white">{title}</h3>
          <button onClick={onClose} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  )
}

// ── 정보 행 ──────────────────────────────────────────
function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-800 last:border-0">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400 mb-0.5">{label}</p>
        <div className="text-sm text-gray-200">{value}</div>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const auth = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ users: 0, brokers: 0, openReports: 0, unverifiedBrokers: 0 })
  const [brokers, setBrokers] = useState<any[]>([])
  // 사무소별 직원 명단 (대표 broker_profiles.id → 직원 배열)
  const [employeesByOwner, setEmployeesByOwner] = useState<Map<string, any[]>>(new Map())
  const [expandedOwnerId, setExpandedOwnerId] = useState<string | null>(null)
  const [recentUsers, setRecentUsers] = useState<any[]>([])
  const [verifying, setVerifying] = useState<string | null>(null)
  const [brokerProperties, setBrokerProperties] = useState<any[]>([])

  // 적체 경보
  const [alerts, setAlerts] = useState({
    staleBrokers: 0,  // 3일+ 미인증 사무소
    staleReports: 0,  // 3일+ 미처리 신고
  })

  // 행 클릭 상세 모달
  const [brokerModal, setBrokerModal] = useState<any>(null)
  const [userModal, setUserModal] = useState<any>(null)
  const [propertyModal, setPropertyModal] = useState<any>(null)

  // 통계 카드 전체 목록 모달
  const [statModal, setStatModal] = useState(false)
  const [userFilter, setUserFilter] = useState<'all' | 'broker' | 'user'>('all')
  const [allUsersAll, setAllUsersAll] = useState<any[]>([])
  const [loadingModal, setLoadingModal] = useState(false)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.profile?.role])

  const init = async () => {

    try {
      await Promise.all([loadStats(), loadBrokers(), loadRecentUsers(), loadBrokerProperties(), loadAlerts()])
    } catch (e) {
      console.error('관리자 페이지 데이터 로드 오류:', e)
    } finally {
      setLoading(false)
    }
  }

  const loadStats = async () => {
    const [
      { count: users },
      { count: brokers },
      { count: openReports },
      { count: unverifiedBrokers },
    ] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('broker_profiles').select('*', { count: 'exact', head: true }),
      supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('broker_profiles').select('*', { count: 'exact', head: true }).eq('is_verified', false).eq('is_owner', true),
    ])
    setStats({
      users: users ?? 0, brokers: brokers ?? 0, openReports: openReports ?? 0,
      unverifiedBrokers: unverifiedBrokers ?? 0,
    })
  }

  const loadBrokers = async () => {
    // 인증 관리는 대표(is_owner=true)만 대상. 직원 승인은 대표가 /broker/team에서 처리
    const { data: owners } = await supabase
      .from('broker_profiles')
      .select('*, profiles:profiles_visible(name, email, phone)')
      .eq('is_owner', true)
      .order('created_at', { ascending: false })
    const ownerRows = owners ?? []
    setBrokers(ownerRows)

    // 소속 직원 일괄 조회
    const ownerIds = ownerRows.map(o => o.id)
    if (ownerIds.length > 0) {
      const { data: emps } = await supabase
        .from('broker_profiles')
        .select('*, profiles:profiles_visible(name, email, phone)')
        .in('parent_broker_id', ownerIds)
        .order('created_at', { ascending: false })
      const map = new Map<string, any[]>()
      for (const e of emps ?? []) {
        const arr = map.get(e.parent_broker_id) ?? []
        arr.push(e)
        map.set(e.parent_broker_id, arr)
      }
      setEmployeesByOwner(map)
    } else {
      setEmployeesByOwner(new Map())
    }
  }

  const loadAlerts = async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const [
      { count: staleBrokers },
      { count: staleReports },
    ] = await Promise.all([
      // 3일+ 미인증 대표 사무소
      supabase.from('broker_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('is_owner', true).eq('is_verified', false)
        .lt('created_at', threeDaysAgo),
      // 3일+ 미처리 신고
      supabase.from('reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .lt('created_at', threeDaysAgo),
    ])
    setAlerts({
      staleBrokers: staleBrokers ?? 0,
      staleReports: staleReports ?? 0,
    })
  }

  const loadRecentUsers = async () => {
    const { data } = await supabase
      .from('profiles_visible')
      .select('id, name, email, role, phone, created_at')
      .order('created_at', { ascending: false })
      .limit(20)
    setRecentUsers(data ?? [])
  }

  const loadBrokerProperties = async () => {
    const { data } = await supabase
      .from('broker_properties')
      .select('*, broker_profiles(office_name, profiles(name))')
      .order('created_at', { ascending: false })
      .limit(100)
    setBrokerProperties(data ?? [])
  }

  const toggleVerify = async (brokerId: string, current: boolean) => {
    setVerifying(brokerId)
    const { error } = await supabase
      .from('broker_profiles')
      .update({ is_verified: !current })
      .eq('id', brokerId)
    if (!error) {
      setBrokers(prev => prev.map(b =>
        b.id === brokerId ? { ...b, is_verified: !current } : b
      ))
      if (brokerModal?.id === brokerId) {
        setBrokerModal((prev: any) => ({ ...prev, is_verified: !current }))
      }
      if (auth.user) {
        void logAdminAction(supabase, auth.user.id, {
          action: !current ? 'broker.verify' : 'broker.unverify',
          targetType: 'broker',
          targetId: brokerId,
        })
      }
    } else {
      toast.error('처리에 실패했어요. 다시 시도해주세요.')
    }
    setVerifying(null)
  }

  const openStatModal = async (userFilterInit: 'all' | 'broker' | 'user' = 'all') => {
    setStatModal(true)
    setUserFilter(userFilterInit)
    if (allUsersAll.length > 0) return
    setLoadingModal(true)
    const { data } = await supabase.from('profiles_visible').select('id, name, email, role, phone, created_at').order('created_at', { ascending: false }).limit(500)
    setAllUsersAll(data ?? [])
    setLoadingModal(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Spinner size="lg" />
      </div>
    )
  }

  const unverifiedBrokers = brokers.filter(b => !b.is_verified)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-8 space-y-6 sm:space-y-8">
        <h1 className="sr-only">관리자 대시보드</h1>

        {/* ── 액션 필요 큐 (카운트 있는 항목만 강조) ── */}
        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/admin/reports"
            className={`flex items-center gap-4 rounded-2xl border p-5 transition-all hover:border-gray-600 ${
              stats.openReports > 0
                ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
                : 'border-gray-800 bg-gray-900 hover:bg-gray-800/80'
            }`}>
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              stats.openReports > 0 ? 'bg-red-500/20 text-red-400' : 'bg-gray-800 text-gray-400'
            }`}>
              <Flag className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-white">신고·문의 처리</p>
              <p className="text-sm text-gray-400">
                {stats.openReports > 0
                  ? <>미처리 <span className="font-bold text-red-400">{stats.openReports}</span>건이 대기 중이에요</>
                  : '대기 중인 항목이 없어요'}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </Link>

          <Link href="/admin/brokers"
            className={`flex items-center gap-4 rounded-2xl border p-5 transition-all hover:border-gray-600 ${
              stats.unverifiedBrokers > 0
                ? 'border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10'
                : 'border-gray-800 bg-gray-900 hover:bg-gray-800/80'
            }`}>
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              stats.unverifiedBrokers > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-800 text-gray-400'
            }`}>
              <Building2 className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-white">사무소 검수</p>
              <p className="text-sm text-gray-400">
                {stats.unverifiedBrokers > 0
                  ? <>미인증 사무소 <span className="font-bold text-yellow-400">{stats.unverifiedBrokers}</span>곳 대기</>
                  : '대표 자격증·사업자 정보 검토 및 인증'}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-400" />
          </Link>
        </div>

        {/* ── 적체 경보 (오래된 미처리) ── */}
        {(alerts.staleBrokers > 0 || alerts.staleReports > 0) && (
          <div className="rounded-2xl border border-orange-500/30 bg-orange-500/5 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-400" />
              <h2 className="font-bold text-white">살펴봐야 할 것</h2>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                <div className="flex items-center gap-2 text-yellow-300">
                  <Clock className="h-4 w-4" />
                  <span className="text-xs font-semibold">3일+ 미인증 사무소</span>
                </div>
                <p className="mt-1.5 text-2xl font-black text-white">{alerts.staleBrokers}<span className="ml-1 text-sm font-medium text-gray-400">곳</span></p>
                <Link href="/admin/brokers" className="text-[11px] text-blue-300 hover:underline">사무소 검수로 →</Link>
              </div>
              <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
                <div className="flex items-center gap-2 text-red-300">
                  <Flag className="h-4 w-4" />
                  <span className="text-xs font-semibold">3일+ 미처리 신고</span>
                </div>
                <p className="mt-1.5 text-2xl font-black text-white">{alerts.staleReports}<span className="ml-1 text-sm font-medium text-gray-400">건</span></p>
                <Link href="/admin/reports" className="text-[11px] text-blue-300 hover:underline">신고 처리로 →</Link>
              </div>
            </div>
          </div>
        )}


        {/* ── 통계 ── */}
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: '전체 회원', value: stats.users, icon: Users, color: 'bg-blue-500/10 text-blue-300', action: () => openStatModal('all') },
            { label: '중개사', value: stats.brokers, icon: Building2, color: 'bg-purple-500/10 text-purple-400', action: () => openStatModal('broker') },
          ].map(stat => (
            <button
              key={stat.label}
              onClick={stat.action}
              className="rounded-2xl border border-gray-800 bg-gray-900 p-5 text-left hover:border-gray-600 hover:bg-gray-800/80 transition-all group"
            >
              <div className={`mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl ${stat.color}`}>
                <stat.icon className="h-5 w-5" />
              </div>
              <div className="text-3xl font-black text-white">{stat.value}</div>
              <div className="mt-1 flex items-center gap-1 text-sm text-gray-400">
                {stat.label}
                <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </button>
          ))}
        </div>

        {/* ── 사무소 인증 대기 큐 (미인증만) ── */}
        <div id="section-brokers">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">사무소 인증 대기</h2>
            {unverifiedBrokers.length > 0 && (
              <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-bold text-red-400">
                {unverifiedBrokers.length}곳 대기
              </span>
            )}
          </div>

          {unverifiedBrokers.length === 0 ? (
            <div className="rounded-2xl border border-gray-800 bg-gray-900 py-10 text-center">
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <CheckCircle className="h-8 w-8 text-green-500/60" />
                <p className="font-semibold text-gray-400">인증 대기 중인 사무소가 없어요</p>
                <Link href="/admin/brokers" className="mt-1 text-xs text-blue-300 hover:underline">
                  전체 사무소 보러 가기 →
                </Link>
              </div>
            </div>
          ) : (
            <ul className="space-y-3 list-none p-0">
              {unverifiedBrokers.map((broker: any) => {
                const employees = employeesByOwner.get(broker.id) ?? []
                const isOpen = expandedOwnerId === broker.id
                const districts = broker.district?.split(',').map((d: string) => d.trim()).filter(Boolean) ?? []
                return (
                  <li key={broker.id}>
                    <OfficeCard
                      variant="admin"
                      onClick={() => setBrokerModal(broker)}
                      office={{
                        id: broker.id,
                        office_name: broker.office_name,
                        owner_name: broker.profiles?.name,
                        owner_email: broker.profiles?.email,
                        license_number: broker.license_number,
                        business_reg_number: broker.business_reg_number,
                        office_reg_number: broker.office_reg_number,
                        address: broker.address,
                        districts,
                        is_verified: broker.is_verified,
                        created_at: broker.created_at,
                        employee_count: employees.length,
                      }}
                      actionSlot={
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] text-gray-400">대표 정보 클릭 시 상세 모달 열림</span>
                          <button
                            onClick={() => toggleVerify(broker.id, broker.is_verified)}
                            disabled={verifying === broker.id}
                            className="rounded-lg bg-green-500/20 px-3 py-1.5 text-xs font-semibold text-green-400 transition-all hover:bg-green-500/30 disabled:opacity-50"
                          >
                            {verifying === broker.id ? '처리 중...' : '인증 승인'}
                          </button>
                        </div>
                      }
                    >
                      {employees.length > 0 && (
                        <div className="border-t border-gray-800">
                          <button
                            onClick={() => setExpandedOwnerId(isOpen ? null : broker.id)}
                            className="w-full flex items-center justify-between px-5 py-2.5 text-xs font-semibold text-gray-400 hover:bg-gray-800/40 transition-colors"
                          >
                            <span className="flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5" />
                              소속 직원 {employees.length}명 · 승인은 대표가 처리
                            </span>
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {isOpen && (
                            <ul className="border-t border-gray-800 divide-y divide-gray-800/50 list-none p-0">
                              {employees.map((e: any) => (
                                <li key={e.id}>
                                  <EmployeeRow
                                    employee={{
                                      id: e.id,
                                      name: e.profiles?.name,
                                      email: e.profiles?.email,
                                      phone: e.profiles?.phone,
                                      is_approved: e.is_approved,
                                      created_at: e.created_at,
                                    }}
                                    showStatusBadge={false}
                                  />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </OfficeCard>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div>

          {/* ── 최근 가입 회원 ── */}
          <div id="section-users">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">최근 가입 회원</h2>
              <span className="text-xs text-gray-400">클릭하면 상세 정보</span>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-3 sm:px-5 py-3 sm:py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">이름</th>
                    <th className="px-3 sm:px-5 py-3 sm:py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">역할</th>
                    <th className="px-3 sm:px-5 py-3 sm:py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">가입일</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.length === 0 ? (
                    <EmptyTableRow colSpan={3} message="회원이 없습니다" />
                  ) : (
                    recentUsers.map(u => (
                      <tr
                        key={u.id}
                        onClick={() => setUserModal(u)}
                        className="border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer transition-colors"
                      >
                        <td className="px-3 sm:px-5 py-3 sm:py-3.5">
                          <div className="font-medium text-white truncate max-w-[140px] sm:max-w-none">{u.name || '(이름 없음)'}</div>
                          <div className="text-xs text-gray-400 truncate max-w-[140px] sm:max-w-none">{u.email}</div>
                        </td>
                        <td className="px-3 sm:px-5 py-3 sm:py-3.5">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${
                            u.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                            u.role === 'broker' ? 'bg-purple-500/20 text-purple-400' :
                            'bg-blue-500/20 text-blue-300'
                          }`}>
                            {u.role === 'admin' ? '관리자' : u.role === 'broker' ? '중개사' : '일반'}
                          </span>
                        </td>
                        <td className="px-3 sm:px-5 py-3 sm:py-3.5 text-sm text-gray-400 whitespace-nowrap">{formatDate(u.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>

        </div>

        {/* ── Supabase 바로가기 ── */}
        {(() => {
          const projectId = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1]
          if (!projectId) return null
          const base = `https://supabase.com/dashboard/project/${projectId}`
          return (
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h3 className="mb-3 font-bold text-white">🔗 Supabase 직접 관리</h3>
              <p className="mb-4 text-sm text-gray-400">데이터 직접 수정, 삭제 등 세부 작업은 Supabase Table Editor를 사용하세요</p>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: 'Table Editor', url: `${base}/editor` },
                  { label: 'Auth Users', url: `${base}/auth/users` },
                  { label: 'SQL Editor', url: `${base}/sql` },
                  { label: 'Logs', url: `${base}/logs/explorer` },
                ].map(link => (
                  <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          )
        })()}

      </div>

      {/* ══════════════════════════════════════════════
          모달들
      ══════════════════════════════════════════════ */}

      {/* 중개사 상세 모달 */}
      {brokerModal && (
        <Modal title="중개사 상세 정보" onClose={() => setBrokerModal(null)}>
          {/* 헤더 */}
          <div className="mb-5 flex items-center gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-500/20 text-2xl font-black text-blue-300">
              {brokerModal.profiles?.name?.[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white">{brokerModal.profiles?.name}</span>
                {brokerModal.is_verified
                  ? <span className="flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-300"><CheckCircle className="h-3 w-3" />인증됨</span>
                  : <span className="flex items-center gap-1 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-semibold text-yellow-400"><XCircle className="h-3 w-3" />미인증</span>
                }
              </div>
              <p className="text-sm text-gray-400">{brokerModal.office_name}</p>
            </div>
          </div>

          <div className="space-y-0 rounded-xl border border-gray-800 bg-gray-800/40 px-4 py-1 mb-5">
            <InfoRow icon={Mail} label="이메일" value={brokerModal.profiles?.email} />
            <InfoRow icon={Phone} label="연락처" value={brokerModal.profiles?.phone} />
            <InfoRow icon={Hash} label="자격증 번호" value={<span className="font-mono">{brokerModal.license_number}</span>} />
            <InfoRow icon={MapPin} label="담당 지역" value={
              <div className="flex flex-wrap gap-1 mt-0.5">
                {(brokerModal.district?.split(',') ?? []).map((d: string) => (
                  <span key={d} className="rounded-md bg-gray-700 px-2 py-0.5 text-xs text-gray-300">{d.trim()}</span>
                ))}
              </div>
            } />
            <InfoRow icon={Calendar} label="가입일" value={formatDate(brokerModal.created_at)} />
          </div>

          {/* 소개글 */}
          {brokerModal.description && (
            <div className="mb-5 rounded-xl border border-gray-700 bg-gray-800/40 p-4">
              <p className="mb-1.5 text-xs font-semibold text-gray-400">소개글</p>
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{brokerModal.description}</p>
            </div>
          )}

          {/* 등록 매물 목록 */}
          {(() => {
            const props = brokerProperties.filter(p => p.broker_id === brokerModal.id)
            return (
              <div className="mb-5">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-400">
                  <Home className="h-3.5 w-3.5" />
                  등록 매물
                  <span className="rounded-full bg-gray-700 px-1.5 py-0.5 text-gray-300">{props.length}건</span>
                </p>
                {props.length === 0 ? (
                  <EmptyState variant="card" message="등록된 매물이 없습니다" darkBg />
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {props.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { setBrokerModal(null); setPropertyModal(p) }}
                        className="w-full flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-800/40 px-3.5 py-2.5 text-left hover:bg-gray-800 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-sm text-white truncate">
                            <MapPin className="h-3 w-3 text-gray-400 flex-shrink-0" />
                            {p.address || '주소 없음'}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-400">
                            {p.deal_type} · {p.room_type}
                            {p.size_pyeong ? ` · ${p.size_pyeong}` : ''}
                            {p.price ? ` · ${formatPrice(p.price)}` : ''}
                          </div>
                        </div>
                        <span className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                          PROPERTY_STATUS_META[p.status as keyof typeof PROPERTY_STATUS_META]?.pill ?? 'bg-gray-500/20 text-gray-400'
                        }`}>
                          {propertyStatusLabel(p.status)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          {/* 버튼 영역 */}
          <div className="space-y-2">
            <button
              onClick={() => toggleVerify(brokerModal.id, brokerModal.is_verified)}
              disabled={verifying === brokerModal.id}
              className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${
                brokerModal.is_verified
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
              }`}
            >
              {verifying === brokerModal.id ? '처리 중...' : brokerModal.is_verified ? '인증 취소' : '인증 승인'}
            </button>
            <Link
              href={`/broker/properties?broker_id=${brokerModal.id}`}
              target="_blank"
              className="w-full rounded-xl border border-blue-500/40 bg-blue-500/10 py-2.5 text-sm font-semibold text-blue-300 hover:bg-blue-500/20 transition-colors flex items-center justify-center gap-1.5"
            >
              <Table2 className="h-4 w-4" />
              매물장 전체 보기 (읽기 전용)
            </Link>
          </div>
        </Modal>
      )}

      {/* 회원 상세 모달 */}
      {userModal && (
        <Modal title="회원 상세 정보" onClose={() => setUserModal(null)}>
          <div className="mb-5 flex items-center gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-gray-700 text-2xl font-black text-gray-300">
              {userModal.name?.[0] ?? '?'}
            </div>
            <div>
              <span className="text-lg font-bold text-white">{userModal.name || '(이름 없음)'}</span>
              <div className="mt-1">
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                  userModal.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                  userModal.role === 'broker' ? 'bg-purple-500/20 text-purple-400' :
                  'bg-blue-500/20 text-blue-300'
                }`}>
                  {userModal.role === 'admin' ? '관리자' : userModal.role === 'broker' ? '중개사' : '일반 회원'}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-0 rounded-xl border border-gray-800 bg-gray-800/40 px-4 py-1">
            <InfoRow icon={Mail} label="이메일" value={userModal.email} />
            <InfoRow icon={Phone} label="연락처" value={userModal.phone || '미등록'} />
            <InfoRow icon={Calendar} label="가입일" value={formatDate(userModal.created_at)} />
          </div>
        </Modal>
      )}

      {/* 매물 상세 모달 */}
      {propertyModal && (
        <Modal title="매물 상세 정보" onClose={() => setPropertyModal(null)}>
          {/* 사진 */}
          {propertyModal.images && propertyModal.images.length > 0 && (
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {propertyModal.images.map((url: string, i: number) => (
                <div key={i} className="relative h-32 w-40 flex-shrink-0 overflow-hidden rounded-xl">
                  <Image src={url} alt="매물 사진" fill className="object-cover" sizes="160px" />
                </div>
              ))}
            </div>
          )}

          {/* 중개사 */}
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-gray-800/60 px-4 py-3">
            <Building2 className="h-5 w-5 text-blue-300" />
            <div>
              <p className="font-semibold text-white">{propertyModal.broker_profiles?.profiles?.name}</p>
              <p className="text-xs text-gray-400">{propertyModal.broker_profiles?.office_name}</p>
            </div>
            <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${
              PROPERTY_STATUS_META[propertyModal.status as keyof typeof PROPERTY_STATUS_META]?.pill ?? 'bg-gray-500/20 text-gray-400'
            }`}>
              {propertyStatusLabel(propertyModal.status)}
            </span>
          </div>

          <div className="space-y-0 rounded-xl border border-gray-800 bg-gray-800/40 px-4 py-1 mb-4">
            <InfoRow icon={MapPin} label="주소" value={propertyModal.address} />
            <InfoRow icon={Home} label="거래/매물 유형" value={`${propertyModal.deal_type} · ${propertyModal.room_type}`} />
            <InfoRow icon={FileText} label="가격" value={
              propertyModal.deal_type === '월세'
                ? `보증금 ${formatPrice(propertyModal.price)} / 월 ${formatPrice(propertyModal.monthly_rent ?? 0)}`
                : formatPrice(propertyModal.price)
            } />
            {propertyModal.size_pyeong && (
              <InfoRow icon={Hash} label="면적" value={`${propertyModal.size_pyeong}평`} />
            )}
            {propertyModal.floor && (
              <InfoRow icon={Building2} label="층수" value={`${propertyModal.floor}층${propertyModal.total_floors ? ` / 총 ${propertyModal.total_floors}층` : ''}`} />
            )}
            <InfoRow icon={Calendar} label="등록일" value={formatDate(propertyModal.created_at)} />
          </div>

          {propertyModal.options && propertyModal.options.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">옵션</p>
              <div className="flex flex-wrap gap-1.5">
                {propertyModal.options.map((opt: string) => (
                  <span key={opt} className="rounded-full bg-gray-700 px-3 py-1 text-xs text-gray-300">{opt}</span>
                ))}
              </div>
            </div>
          )}

          {propertyModal.description && (
            <div className="mb-4 rounded-xl border border-gray-700 bg-gray-800/40 p-4">
              <p className="mb-1.5 text-xs font-semibold text-gray-400">매물 설명</p>
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{propertyModal.description}</p>
            </div>
          )}

          {propertyModal.memo && (
            <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-orange-400">
                <StickyNote className="h-3.5 w-3.5" />🔒 중개사 메모 (관리자만 열람)
              </p>
              <p className="text-sm text-orange-200 leading-relaxed whitespace-pre-line">{propertyModal.memo}</p>
            </div>
          )}
        </Modal>
      )}

      {/* 통계 카드 전체 목록 모달 */}
      {statModal && (
        <Modal
          title={`전체 회원 (${stats.users}명)`}
          onClose={() => setStatModal(false)}
        >
          {loadingModal ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="md" />
            </div>
          ) : (
            <>
              {/* 전체 회원 (탭: 전체 / 중개사 / 고객) */}
              {(() => {
                const filtered = allUsersAll.filter(u =>
                  userFilter === 'all' ? true :
                  userFilter === 'broker' ? u.role === 'broker' :
                  u.role === 'user'
                )
                const brokerCount = allUsersAll.filter(u => u.role === 'broker').length
                const userCount = allUsersAll.filter(u => u.role === 'user').length
                return (
                  <>
                    {/* 탭 */}
                    <div className="mb-4 flex gap-2">
                      {[
                        { key: 'all', label: `전체 ${allUsersAll.length}명` },
                        { key: 'broker', label: `중개사 ${brokerCount}명` },
                        { key: 'user', label: `고객 ${userCount}명` },
                      ].map(tab => (
                        <button
                          key={tab.key}
                          onClick={() => setUserFilter(tab.key as any)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                            userFilter === tab.key
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {filtered.length === 0
                        ? <p className="py-8 text-center text-gray-400">회원이 없습니다</p>
                        : filtered.map(u => (
                          <button key={u.id} onClick={() => { setStatModal(false); setUserModal(u) }}
                            className="w-full flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-800/50 px-4 py-3 text-left hover:bg-gray-800 transition-colors">
                            <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full font-bold ${
                              u.role === 'broker' ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-700 text-gray-300'
                            }`}>
                              {u.name?.[0] ?? '?'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-white">{u.name || '(이름 없음)'}</div>
                              <div className="text-xs text-gray-400 truncate">{u.email}</div>
                            </div>
                            <span className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                              u.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                              u.role === 'broker' ? 'bg-purple-500/20 text-purple-400' :
                              'bg-blue-500/20 text-blue-300'
                            }`}>
                              {u.role === 'admin' ? '관리자' : u.role === 'broker' ? '중개사' : '고객'}
                            </span>
                            <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(u.created_at)}</span>
                          </button>
                        ))
                      }
                    </div>
                  </>
                )
              })()}

            </>
          )}
        </Modal>
      )}

    </div>
  )
}
