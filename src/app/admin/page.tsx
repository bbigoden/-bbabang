'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatPrice } from '@/lib/utils'
import {
  Users, Building2, FileText, MessageCircle,
  CheckCircle, XCircle, Shield, LogOut, ExternalLink,
  StickyNote, MapPin, X, Phone, Mail, Star, Home, Calendar,
  Hash, ChevronRight, Table2, Flag, Megaphone, BarChart3
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'

// ── 모달 래퍼 ──────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
          <h3 className="font-bold text-white">{title}</h3>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

// ── 정보 행 ──────────────────────────────────────────
function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-800 last:border-0">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-500 mb-0.5">{label}</p>
        <div className="text-sm text-gray-200">{value}</div>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const router = useRouter()
  const supabase = createClient()
  const auth = useAuth()

  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ users: 0, brokers: 0, requests: 0, proposals: 0, openReports: 0, unverifiedBrokers: 0 })
  const [brokers, setBrokers] = useState<any[]>([])
  const [recentUsers, setRecentUsers] = useState<any[]>([])
  const [recentRequests, setRecentRequests] = useState<any[]>([])
  const [verifying, setVerifying] = useState<string | null>(null)
  const [brokerProperties, setBrokerProperties] = useState<any[]>([])

  // 행 클릭 상세 모달
  const [brokerModal, setBrokerModal] = useState<any>(null)
  const [brokerReviews, setBrokerReviews] = useState<any[]>([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  // 같은 broker 모달을 다시 열어도 reviews 재조회 안 함 (broker_id → reviews 캐시)
  const reviewsCacheRef = useRef<Map<string, any[]>>(new Map())
  const [userModal, setUserModal] = useState<any>(null)
  const [requestModal, setRequestModal] = useState<any>(null)
  const [propertyModal, setPropertyModal] = useState<any>(null)

  // 통계 카드 전체 목록 모달
  const [statModal, setStatModal] = useState<'users' | 'requests' | 'proposals' | null>(null)
  const [userFilter, setUserFilter] = useState<'all' | 'broker' | 'user'>('all')
  const [allProposals, setAllProposals] = useState<any[]>([])
  const [allUsersAll, setAllUsersAll] = useState<any[]>([])
  const [allRequestsAll, setAllRequestsAll] = useState<any[]>([])
  const [loadingModal, setLoadingModal] = useState(false)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.profile?.role])

  const init = async () => {

    try {
      await Promise.all([loadStats(), loadBrokers(), loadRecentUsers(), loadRecentRequests(), loadBrokerProperties()])
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
      { count: requests },
      { count: proposals },
      { count: openReports },
      { count: unverifiedBrokers },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      supabase.from('broker_profiles').select('*', { count: 'exact', head: true }),
      supabase.from('request_posts').select('*', { count: 'exact', head: true }),
      supabase.from('proposals').select('*', { count: 'exact', head: true }),
      supabase.from('reports').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('broker_profiles').select('*', { count: 'exact', head: true }).eq('is_verified', false).eq('is_owner', true),
    ])
    setStats({
      users: users ?? 0, brokers: brokers ?? 0, requests: requests ?? 0,
      proposals: proposals ?? 0, openReports: openReports ?? 0,
      unverifiedBrokers: unverifiedBrokers ?? 0,
    })
  }

  const loadBrokers = async () => {
    const { data } = await supabase
      .from('broker_profiles')
      .select('*, profiles(name, email, phone)')
      .order('created_at', { ascending: false })
    setBrokers(data ?? [])
  }

  const loadRecentUsers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
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

  const loadRecentRequests = async () => {
    const { data } = await supabase
      .from('request_posts')
      .select('*, profiles(name, phone)')
      .order('created_at', { ascending: false })
      .limit(20)
    setRecentRequests(data ?? [])
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
    } else {
      alert('처리에 실패했어요. 다시 시도해주세요.')
    }
    setVerifying(null)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const openStatModal = async (type: 'users' | 'requests' | 'proposals') => {
    setStatModal(type)
    if (type === 'users') setUserFilter('all')
    setLoadingModal(true)
    if (type === 'users' && allUsersAll.length === 0) {
      const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(500)
      setAllUsersAll(data ?? [])
    } else if (type === 'requests' && allRequestsAll.length === 0) {
      const { data } = await supabase
        .from('request_posts')
        .select('*, profiles(name, phone)')
        .order('created_at', { ascending: false })
        .limit(500)
      setAllRequestsAll(data ?? [])
    } else if (type === 'proposals' && allProposals.length === 0) {
      const { data } = await supabase
        .from('proposals')
        .select('*, broker_profiles(office_name, profiles(name)), request_posts(city, district, deal_type, profiles(name))')
        .order('created_at', { ascending: false })
        .limit(50)
      setAllProposals(data ?? [])
    }
    setLoadingModal(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  const unverifiedBrokers = brokers.filter(b => !b.is_verified)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* ── 헤더 ── */}
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">빠방 관리자</h1>
              <p className="text-xs text-gray-400">Admin Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/" target="_blank">
              <Button variant="outline" size="sm" className="border-gray-700 text-gray-300 hover:bg-gray-800">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                사이트 보기
              </Button>
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white transition-colors"
            >
              <LogOut className="h-4 w-4" />
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-8">

        {/* ── 운영 진입 ── */}
        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/admin/reports"
            className={`flex items-center gap-4 rounded-2xl border p-5 transition-all hover:border-gray-600 ${
              stats.openReports > 0
                ? 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
                : 'border-gray-800 bg-gray-900 hover:bg-gray-800/80'
            }`}>
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              stats.openReports > 0 ? 'bg-red-500/20 text-red-400' : 'bg-gray-800 text-gray-500'
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
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </Link>

          <Link href="/admin/announcements"
            className="flex items-center gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 hover:border-gray-600 hover:bg-gray-800/80 transition-all">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
              <Megaphone className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-white">공지 발행</p>
              <p className="text-sm text-gray-400">전체·고객·중개사 대상 알림 전송</p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/admin/properties"
            className="flex items-center gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 hover:border-gray-600 hover:bg-gray-800/80 transition-all">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <Home className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-white">매물 검수</p>
              <p className="text-sm text-gray-400">전체 매물 모니터링·강제 숨김·신고된 매물 처리</p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </Link>

          <Link href="/admin/users"
            className="flex items-center gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 hover:border-gray-600 hover:bg-gray-800/80 transition-all">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
              <Users className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-white">사용자 관리</p>
              <p className="text-sm text-gray-400">계정 정지·차단, 역할 변경, 관리자 메모</p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </Link>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Link href="/admin/brokers"
            className={`flex items-center gap-4 rounded-2xl border p-5 transition-all hover:border-gray-600 ${
              stats.unverifiedBrokers > 0
                ? 'border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10'
                : 'border-gray-800 bg-gray-900 hover:bg-gray-800/80'
            }`}>
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              stats.unverifiedBrokers > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-purple-500/20 text-purple-400'
            }`}>
              <Building2 className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-white">중개사 검수</p>
              <p className="text-sm text-gray-400">
                {stats.unverifiedBrokers > 0
                  ? <>미인증 대표 <span className="font-bold text-yellow-400">{stats.unverifiedBrokers}</span>명 검수 대기</>
                  : '자격증·사업자 정보 검토 및 인증'}
              </p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </Link>

          <Link href="/admin/stats"
            className="flex items-center gap-4 rounded-2xl border border-gray-800 bg-gray-900 p-5 hover:border-gray-600 hover:bg-gray-800/80 transition-all">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/20 text-cyan-400">
              <BarChart3 className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-white">통계·분석</p>
              <p className="text-sm text-gray-400">7·30·90일 추이, 지역별 분포, 거래유형</p>
            </div>
            <ChevronRight className="h-5 w-5 text-gray-600" />
          </Link>
        </div>

        {/* ── 통계 ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '전체 회원', value: stats.users, icon: Users, color: 'bg-blue-500/10 text-blue-400', action: () => openStatModal('users') },
            { label: '중개사', value: stats.brokers, icon: Building2, color: 'bg-purple-500/10 text-purple-400', action: () => openStatModal('users') },
            { label: '매물 요청', value: stats.requests, icon: FileText, color: 'bg-green-500/10 text-green-400', action: () => openStatModal('requests') },
            { label: '제안', value: stats.proposals, icon: MessageCircle, color: 'bg-yellow-500/10 text-yellow-400', action: () => openStatModal('proposals') },
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

        {/* ── 중개사 인증 관리 ── */}
        <div id="section-brokers">
          <div className="mb-4 flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">중개사 인증 관리</h2>
            {unverifiedBrokers.length > 0 && (
              <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-bold text-red-400">
                미인증 {unverifiedBrokers.length}명
              </span>
            )}
            <span className="ml-auto text-xs text-gray-500">행을 클릭하면 상세 정보를 볼 수 있어요</span>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">이름</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">사무소</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">자격증 번호</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">담당 지역</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">가입일</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">상태</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">액션</th>
                </tr>
              </thead>
              <tbody>
                {brokers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-gray-500">등록된 중개사가 없습니다</td>
                  </tr>
                ) : (
                  brokers.map(broker => (
                    <tr
                      key={broker.id}
                      onClick={async () => {
                        setBrokerModal(broker)
                        const cached = reviewsCacheRef.current.get(broker.id)
                        if (cached) {
                          setBrokerReviews(cached)
                          setReviewsLoading(false)
                          return
                        }
                        setBrokerReviews([])
                        setReviewsLoading(true)
                        const { data } = await supabase.from('reviews').select('*, profiles(name)').eq('broker_id', broker.id).order('created_at', { ascending: false })
                        const rows = data ?? []
                        reviewsCacheRef.current.set(broker.id, rows)
                        setBrokerReviews(rows)
                        setReviewsLoading(false)
                      }}
                      className="border-b border-gray-800/50 hover:bg-gray-800/50 transition-colors cursor-pointer"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="font-semibold text-white">{broker.profiles?.name}</div>
                          {broker.is_verified && <CheckCircle className="h-3.5 w-3.5 text-blue-400" />}
                        </div>
                        <div className="text-xs text-gray-400">{broker.profiles?.email}</div>
                      </td>
                      <td className="px-5 py-4 text-gray-300">{broker.office_name}</td>
                      <td className="px-5 py-4 text-gray-300 font-mono text-sm">{broker.license_number}</td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {(broker.district?.split(',') ?? []).slice(0, 2).map((d: string) => (
                            <span key={d} className="rounded-md bg-gray-700 px-2 py-0.5 text-xs text-gray-300">{d.trim()}</span>
                          ))}
                          {(broker.district?.split(',') ?? []).length > 2 && (
                            <span className="text-xs text-gray-500">+{(broker.district?.split(',') ?? []).length - 2}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-400">{formatDate(broker.created_at)}</td>
                      <td className="px-5 py-4">
                        {broker.is_verified ? (
                          <span className="flex items-center gap-1.5 text-sm font-medium text-green-400">
                            <CheckCircle className="h-4 w-4" /> 인증됨
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-sm font-medium text-yellow-400">
                            <XCircle className="h-4 w-4" /> 미인증
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => toggleVerify(broker.id, broker.is_verified)}
                          disabled={verifying === broker.id}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                            broker.is_verified
                              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                              : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                          } disabled:opacity-50`}
                        >
                          {verifying === broker.id ? '처리 중...' : broker.is_verified ? '인증 취소' : '인증 승인'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">

          {/* ── 최근 가입 회원 ── */}
          <div id="section-users">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">최근 가입 회원</h2>
              <span className="text-xs text-gray-500">클릭하면 상세 정보</span>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">이름</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">역할</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">가입일</th>
                  </tr>
                </thead>
                <tbody>
                  {recentUsers.length === 0 ? (
                    <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-500">회원이 없습니다</td></tr>
                  ) : (
                    recentUsers.map(u => (
                      <tr
                        key={u.id}
                        onClick={() => setUserModal(u)}
                        className="border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-white">{u.name || '(이름 없음)'}</div>
                          <div className="text-xs text-gray-400">{u.email}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            u.role === 'admin' ? 'bg-red-500/20 text-red-400' :
                            u.role === 'broker' ? 'bg-purple-500/20 text-purple-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {u.role === 'admin' ? '관리자' : u.role === 'broker' ? '중개사' : '일반'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-400">{formatDate(u.created_at)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── 최근 매물 요청 ── */}
          <div id="section-requests">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">최근 매물 요청</h2>
              <span className="text-xs text-gray-500">클릭하면 상세 정보</span>
            </div>
            <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">요청자</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">지역/유형</th>
                    <th className="px-5 py-3.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRequests.length === 0 ? (
                    <tr><td colSpan={3} className="px-5 py-8 text-center text-gray-500">요청이 없습니다</td></tr>
                  ) : (
                    recentRequests.map(req => (
                      <tr
                        key={req.id}
                        onClick={() => setRequestModal(req)}
                        className="border-b border-gray-800/50 hover:bg-gray-800/50 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <div className="font-medium text-white">{req.profiles?.name || '(알 수 없음)'}</div>
                          <div className="text-xs text-gray-400">{formatDate(req.created_at)}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="text-sm text-white">{req.city} {req.district}</div>
                          <div className="text-xs text-gray-400">{req.deal_type?.split(',')?.[0]}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            req.status === 'active' ? 'bg-green-500/20 text-green-400' :
                            
                            'bg-gray-500/20 text-gray-400'
                          }`}>
                            {req.status === 'active' ? '모집 중' :  '종료'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* ── Supabase 바로가기 ── */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
          <h3 className="mb-3 font-bold text-white">🔗 Supabase 직접 관리</h3>
          <p className="mb-4 text-sm text-gray-400">데이터 직접 수정, 삭제 등 세부 작업은 Supabase Table Editor를 사용하세요</p>
          <div className="flex flex-wrap gap-3">
            {[
              { label: 'Table Editor', url: 'https://supabase.com/dashboard/project/wovxcdfxxnsljdhrgonh/editor' },
              { label: 'Auth Users', url: 'https://supabase.com/dashboard/project/wovxcdfxxnsljdhrgonh/auth/users' },
              { label: 'SQL Editor', url: 'https://supabase.com/dashboard/project/wovxcdfxxnsljdhrgonh/sql' },
              { label: 'Logs', url: 'https://supabase.com/dashboard/project/wovxcdfxxnsljdhrgonh/logs/explorer' },
            ].map(link => (
              <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors">
                <ExternalLink className="h-3.5 w-3.5" />
                {link.label}
              </a>
            ))}
          </div>
        </div>

      </div>

      {/* ══════════════════════════════════════════════
          모달들
      ══════════════════════════════════════════════ */}

      {/* 중개사 상세 모달 */}
      {brokerModal && (
        <Modal title="중개사 상세 정보" onClose={() => setBrokerModal(null)}>
          {/* 헤더 */}
          <div className="mb-5 flex items-center gap-4">
            <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-500/20 text-2xl font-black text-blue-400">
              {brokerModal.profiles?.name?.[0]}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white">{brokerModal.profiles?.name}</span>
                {brokerModal.is_verified
                  ? <span className="flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-semibold text-blue-400"><CheckCircle className="h-3 w-3" />인증됨</span>
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
            <InfoRow icon={Star} label="평점" value={
              brokerModal.rating ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {[1,2,3,4,5].map(i => (
                      <Star key={i} className={`h-3.5 w-3.5 ${i <= Math.round(brokerModal.rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'}`} />
                    ))}
                  </div>
                  <span className="font-bold text-white">{brokerModal.rating.toFixed(1)}</span>
                  <span className="text-gray-400 text-xs">({brokerModal.review_count}개)</span>
                </div>
              ) : '리뷰 없음'
            } />
            <InfoRow icon={MessageCircle} label="성사 건수" value={`${brokerModal.deal_count ?? 0}건`} />
            <InfoRow icon={Calendar} label="가입일" value={formatDate(brokerModal.created_at)} />
          </div>

          {/* 소개글 */}
          {brokerModal.description && (
            <div className="mb-5 rounded-xl border border-gray-700 bg-gray-800/40 p-4">
              <p className="mb-1.5 text-xs font-semibold text-gray-400">소개글</p>
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{brokerModal.description}</p>
            </div>
          )}

          {/* 고객 리뷰 */}
          <div className="mb-5">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-400">
              <Star className="h-3.5 w-3.5" />
              고객 리뷰
              <span className="rounded-full bg-gray-700 px-1.5 py-0.5 text-gray-300">{brokerModal.review_count ?? 0}개</span>
            </p>
            {reviewsLoading ? (
              <div className="flex items-center justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : brokerReviews.length === 0 ? (
              <p className="rounded-xl border border-gray-800 bg-gray-800/40 py-4 text-center text-xs text-gray-500">리뷰가 없습니다</p>
            ) : (
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {brokerReviews.map(r => (
                  <div key={r.id} className="rounded-xl border border-gray-700 bg-gray-800/40 px-3.5 py-2.5">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-sm font-semibold text-white">{r.profiles?.name ?? '(알 수 없음)'}</span>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        {[1,2,3,4,5].map(i => (
                          <Star key={i} className={`h-3 w-3 ${i <= r.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-600'}`} />
                        ))}
                      </div>
                    </div>
                    {r.content && <p className="text-xs text-gray-400 leading-relaxed">{r.content}</p>}
                    <p className="mt-1 text-[10px] text-gray-600">{formatDate(r.created_at)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

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
                  <p className="rounded-xl border border-gray-800 bg-gray-800/40 py-4 text-center text-xs text-gray-500">등록된 매물이 없습니다</p>
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
                            <MapPin className="h-3 w-3 text-gray-500 flex-shrink-0" />
                            {p.address || '주소 없음'}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-400">
                            {p.deal_type} · {p.room_type}
                            {p.size_pyeong ? ` · ${p.size_pyeong}` : ''}
                            {p.price ? ` · ${formatPrice(p.price)}` : ''}
                          </div>
                        </div>
                        <span className={`flex-shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                          p.status === 'available' ? 'bg-green-500/20 text-green-400' :
                          p.status === 'contracted' ? 'bg-blue-500/20 text-blue-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {p.status === 'available' ? '매물있음' : p.status === 'contracted' ? '계약완료' : '숨김'}
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
              className="w-full rounded-xl border border-blue-500/40 bg-blue-500/10 py-2.5 text-sm font-semibold text-blue-400 hover:bg-blue-500/20 transition-colors flex items-center justify-center gap-1.5"
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
                  'bg-blue-500/20 text-blue-400'
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
            {userModal.role === 'user' && (
              <InfoRow icon={FileText} label="매물 요청" value={`${recentRequests.filter(r => r.user_id === userModal.id).length}건 (최근 20개 기준)`} />
            )}
          </div>
        </Modal>
      )}

      {/* 매물 요청 상세 모달 */}
      {requestModal && (
        <Modal title="매물 요청 상세" onClose={() => setRequestModal(null)}>
          {/* 요청자 */}
          <div className="mb-4 flex items-center gap-3 rounded-xl bg-gray-800/60 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-700 text-sm font-bold text-gray-300">
              {requestModal.profiles?.name?.[0] ?? '?'}
            </div>
            <div>
              <p className="font-semibold text-white">{requestModal.profiles?.name || '(알 수 없음)'}</p>
              {requestModal.profiles?.phone && <p className="text-xs text-gray-400">{requestModal.profiles.phone}</p>}
            </div>
            <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${
              requestModal.status === 'active' ? 'bg-green-500/20 text-green-400' :
              
              'bg-gray-500/20 text-gray-400'
            }`}>
              {requestModal.status === 'active' ? '모집 중' :  '종료'}
            </span>
          </div>

          <div className="space-y-0 rounded-xl border border-gray-800 bg-gray-800/40 px-4 py-1 mb-4">
            <InfoRow icon={MapPin} label="지역" value={`${requestModal.city} ${requestModal.district}`} />
            <InfoRow icon={Home} label="거래 유형" value={requestModal.deal_type} />
            <InfoRow icon={Building2} label="매물 유형" value={requestModal.room_type} />
            <InfoRow icon={FileText} label="가격 범위" value={
              requestModal.max_price
                ? `${formatPrice(requestModal.min_price)} ~ ${formatPrice(requestModal.max_price)}`
                : `${formatPrice(requestModal.min_price)} 이하`
            } />
            {(requestModal.min_size || requestModal.max_size) && (
              <InfoRow icon={Hash} label="평수" value={
                requestModal.min_size && requestModal.max_size
                  ? `${requestModal.min_size}평 ~ ${requestModal.max_size}평`
                  : requestModal.min_size
                    ? `${requestModal.min_size}평 이상`
                    : `${requestModal.max_size}평 이하`
              } />
            )}
            {requestModal.move_in_date && (
              <InfoRow icon={Calendar} label="입주 희망일" value={requestModal.move_in_date} />
            )}
            <InfoRow icon={MessageCircle} label="제안 수" value={`${requestModal.proposal_count ?? 0}건`} />
            <InfoRow icon={Calendar} label="등록일" value={formatDate(requestModal.created_at)} />
          </div>

          {requestModal.description && (
            <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-4">
              <p className="mb-1.5 text-xs font-semibold text-gray-400">요청 내용</p>
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{requestModal.description}</p>
            </div>
          )}

          <div className="mt-4">
            <Link href={`/request/${requestModal.id}`} target="_blank" className="w-full rounded-xl border border-gray-700 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors flex items-center justify-center gap-1.5">
              <ExternalLink className="h-3.5 w-3.5" />
              요청 페이지 열기
            </Link>
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
            <Building2 className="h-5 w-5 text-blue-400" />
            <div>
              <p className="font-semibold text-white">{propertyModal.broker_profiles?.profiles?.name}</p>
              <p className="text-xs text-gray-400">{propertyModal.broker_profiles?.office_name}</p>
            </div>
            <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${
              propertyModal.status === 'available' ? 'bg-green-500/20 text-green-400' :
              propertyModal.status === 'contracted' ? 'bg-blue-500/20 text-blue-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>
              {propertyModal.status === 'available' ? '매물 있음' : propertyModal.status === 'contracted' ? '계약 완료' : '숨김'}
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
          title={
            statModal === 'users' ? `전체 회원 (${stats.users}명)` :
            statModal === 'requests' ? `매물 요청 (${stats.requests}건)` :
            `제안 (${stats.proposals}건)`
          }
          onClose={() => setStatModal(null)}
        >
          {loadingModal ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : (
            <>
              {/* 전체 회원 (탭: 전체 / 중개사 / 고객) */}
              {statModal === 'users' && (() => {
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
                        ? <p className="py-8 text-center text-gray-500">회원이 없습니다</p>
                        : filtered.map(u => (
                          <button key={u.id} onClick={() => { setStatModal(null); setUserModal(u) }}
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
                              'bg-blue-500/20 text-blue-400'
                            }`}>
                              {u.role === 'admin' ? '관리자' : u.role === 'broker' ? '중개사' : '고객'}
                            </span>
                            <span className="text-xs text-gray-500 flex-shrink-0">{formatDate(u.created_at)}</span>
                          </button>
                        ))
                      }
                    </div>
                  </>
                )
              })()}

              {/* 매물 요청 */}
              {statModal === 'requests' && (
                <div className="space-y-2">
                  {allRequestsAll.length === 0 ? <p className="py-8 text-center text-gray-500">요청이 없습니다</p> :
                    allRequestsAll.map(req => (
                      <button key={req.id} onClick={() => { setStatModal(null); setRequestModal(req) }}
                        className="w-full flex items-center gap-3 rounded-xl border border-gray-700 bg-gray-800/50 px-4 py-3 text-left hover:bg-gray-800 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-semibold text-white">{req.profiles?.name || '(알 수 없음)'}</span>
                            <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                              req.status === 'active' ? 'bg-green-500/20 text-green-400' :
                              
                              'bg-gray-500/20 text-gray-400'
                            }`}>
                              {req.status === 'active' ? '모집 중' :  '종료'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-400">{req.city} {req.district} · {req.deal_type?.split(',')?.[0]}</div>
                        </div>
                        <span className="text-xs text-gray-500 flex-shrink-0">{formatDate(req.created_at)}</span>
                      </button>
                    ))
                  }
                </div>
              )}

              {/* 제안 */}
              {statModal === 'proposals' && (
                <div className="space-y-3">
                  {allProposals.length === 0 ? <p className="py-8 text-center text-gray-500">제안이 없습니다</p> :
                    allProposals.map(p => {
                      const req = p.request_posts
                      const broker = p.broker_profiles
                      return (
                        <div key={p.id} className="rounded-xl border border-gray-700 bg-gray-800/50 p-4">
                          <div className="flex items-start justify-between gap-3 mb-2">
                            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                              p.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                              p.status === 'accepted' ? 'bg-green-500/20 text-green-400' :
                              'bg-red-500/20 text-red-400'
                            }`}>
                              {p.status === 'pending' ? '대기 중' : p.status === 'accepted' ? '수락됨' : '거절됨'}
                            </span>
                            <span className="text-xs text-gray-500">{formatDate(p.created_at)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mb-1">
                            <Building2 className="h-3.5 w-3.5 text-purple-400 flex-shrink-0" />
                            <span className="text-sm font-semibold text-white">{broker?.profiles?.name}</span>
                            <span className="text-xs text-gray-500">({broker?.office_name})</span>
                          </div>
                          {req && (
                            <div className="flex items-center gap-1.5">
                              <MapPin className="h-3.5 w-3.5 text-gray-500 flex-shrink-0" />
                              <span className="text-xs text-gray-400">
                                {req.city} {req.district} · {req.deal_type?.split(',')?.[0]} · 요청자: {req.profiles?.name}
                              </span>
                            </div>
                          )}
                          {p.price && <div className="mt-2 text-sm font-bold text-blue-400">{formatPrice(p.price)}</div>}
                          {p.message && <p className="mt-1.5 text-xs text-gray-400 line-clamp-2">{p.message}</p>}
                        </div>
                      )
                    })
                  }
                </div>
              )}
            </>
          )}
        </Modal>
      )}

    </div>
  )
}
