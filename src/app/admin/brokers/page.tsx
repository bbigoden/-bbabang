'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import {
  Building2, ArrowLeft, Search, X, ShieldCheck, ShieldOff,
  CheckCircle2, XCircle, Hash, MapPin,
  Users, Phone, Mail, Calendar, FileText, ChevronDown, AlertCircle
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { OfficeCard } from '@/components/office-card'
import { EmployeeRow } from '@/components/employee-row'
import { EmptyState } from '@/components/empty-state'
import { useToast } from '@/components/toast'
import { logAdminAction } from '@/lib/audit'

type StatusFilter = 'all' | 'unverified' | 'verified'

interface BrokerRow {
  id: string
  user_id: string
  office_name: string | null
  license_number: string | null
  office_reg_number: string | null
  business_reg_number: string | null
  address: string | null
  district: string | null
  is_verified: boolean | null
  is_owner: boolean | null
  is_approved: boolean | null
  parent_broker_id: string | null
  verification_info: any
  rating: number | null
  review_count: number | null
  deal_count: number | null
  created_at: string | null
  profiles: { name: string | null; email: string | null; phone: string | null } | null
}

interface OfficeGroup {
  owner: BrokerRow
  employees: BrokerRow[]
}

const PAGE_SIZE = 30

export default function AdminBrokersPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()
  const toast = useToast()

  const [offices, setOffices] = useState<OfficeGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState<StatusFilter>('unverified')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<BrokerRow | null>(null)
  const [unverifiedCount, setUnverifiedCount] = useState(0)
  const [verifiedCount, setVerifiedCount] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  const loadCounts = useCallback(async () => {
    const [u, v] = await Promise.all([
      supabase.from('broker_profiles').select('*', { count: 'exact', head: true }).eq('is_owner', true).eq('is_verified', false),
      supabase.from('broker_profiles').select('*', { count: 'exact', head: true }).eq('is_owner', true).eq('is_verified', true),
    ])
    setUnverifiedCount(u.count ?? 0)
    setVerifiedCount(v.count ?? 0)
  }, [supabase])

  const load = useCallback(async (reset = false) => {
    const targetPage = reset ? 0 : page
    if (reset) setLoading(true)
    else setLoadingMore(true)

    // 1) 대표(사무소 단위) query — admin 인증 대상은 대표뿐
    let q = supabase
      .from('broker_profiles')
      .select('*, profiles(name, email, phone)')
      .eq('is_owner', true)
      .order('created_at', { ascending: false })

    if (status === 'unverified') q = q.eq('is_verified', false)
    else if (status === 'verified') q = q.eq('is_verified', true)

    if (search.trim()) {
      const s = search.trim()
      q = q.or(`office_name.ilike.%${s}%,license_number.ilike.%${s}%,business_reg_number.ilike.%${s}%`)
    }

    q = q.range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)

    const { data: owners } = await q
    const ownerRows = (owners ?? []) as any as BrokerRow[]

    // 2) 직원(parent_broker_id가 대표 id) 일괄 조회
    const ownerIds = ownerRows.map(o => o.id)
    let employees: BrokerRow[] = []
    if (ownerIds.length > 0) {
      const { data: emps } = await supabase
        .from('broker_profiles')
        .select('*, profiles(name, email, phone)')
        .in('parent_broker_id', ownerIds)
        .order('created_at', { ascending: false })
      employees = (emps ?? []) as any as BrokerRow[]
    }

    // 3) 사무소 단위로 그룹화
    const groups: OfficeGroup[] = ownerRows.map(owner => ({
      owner,
      employees: employees.filter(e => e.parent_broker_id === owner.id)
    }))

    setOffices(prev => reset ? groups : [...prev, ...groups])
    setHasMore(ownerRows.length === PAGE_SIZE)
    setPage(targetPage + 1)
    if (reset) setLoading(false); else setLoadingMore(false)
  }, [supabase, page, status, search])

  useEffect(() => {
    if (auth.profile?.role === 'admin') {
      setPage(0); setHasMore(true)
      load(true)
      loadCounts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.profile?.role, status])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0); setHasMore(true)
    load(true)
  }

  const toggleExpand = (ownerId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(ownerId)) next.delete(ownerId)
      else next.add(ownerId)
      return next
    })
  }

  const toggleVerify = async (broker: BrokerRow) => {
    const next = !broker.is_verified
    const verification_info = next
      ? { ...(broker.verification_info ?? {}), admin_approved_at: new Date().toISOString(), admin_reject_reason: null, admin_reject_at: null }
      : broker.verification_info
    const { error } = await supabase.from('broker_profiles')
      .update({ is_verified: next, verification_info })
      .eq('id', broker.id)
    if (error) { toast.error('변경 실패: ' + error.message); return }
    setOffices(prev => prev.map(g =>
      g.owner.id === broker.id ? { ...g, owner: { ...g.owner, is_verified: next, verification_info } } : g
    ))
    if (selected?.id === broker.id) setSelected({ ...selected, is_verified: next, verification_info })
    toast.success(next ? '인증 승인됨' : '인증 취소됨')
    if (auth.user) {
      void logAdminAction(supabase, auth.user.id, {
        action: next ? 'broker.verify' : 'broker.unverify',
        targetType: 'broker',
        targetId: broker.id,
        metadata: { office_name: broker.office_name },
      })
    }
    // 중개사에게 알림
    if (broker.user_id) {
      void supabase.from('notifications').insert({
        user_id: broker.user_id,
        type: next ? 'broker_verify_approved' : 'broker_verify_revoked',
        title: next ? '사무소 인증이 승인되었어요' : '사무소 인증이 취소되었어요',
        body: next
          ? '이제 매물 등록·제안 등 모든 기능을 사용할 수 있어요.'
          : `${broker.office_name ?? '사무소'} 인증이 취소되었습니다. 자세한 사유는 고객센터로 문의해주세요.`,
        link: '/dashboard/broker',
      })
    }
    loadCounts()
  }

  // 인증 반려 (거부 사유와 함께)
  const rejectVerify = async (broker: BrokerRow, reason: string) => {
    const verification_info = {
      ...(broker.verification_info ?? {}),
      admin_reject_reason: reason,
      admin_reject_at: new Date().toISOString(),
      admin_approved_at: null,
    }
    const { error } = await supabase.from('broker_profiles')
      .update({ is_verified: false, verification_info })
      .eq('id', broker.id)
    if (error) { toast.error('반려 실패: ' + error.message); return false }
    setOffices(prev => prev.map(g =>
      g.owner.id === broker.id ? { ...g, owner: { ...g.owner, is_verified: false, verification_info } } : g
    ))
    if (selected?.id === broker.id) setSelected({ ...selected, is_verified: false, verification_info })
    toast.success('인증 반려됨')
    if (auth.user) {
      void logAdminAction(supabase, auth.user.id, {
        action: 'broker.reject',
        targetType: 'broker',
        targetId: broker.id,
        metadata: { office_name: broker.office_name, reason },
      })
    }
    if (broker.user_id) {
      void supabase.from('notifications').insert({
        user_id: broker.user_id,
        type: 'broker_verify_rejected',
        title: '사무소 인증이 반려되었어요',
        body: `사유: ${reason}\n수정 후 다시 신청해주세요.`,
        link: '/dashboard/broker',
      })
    }
    loadCounts()
    return true
  }

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link href="/admin" aria-label="관리자 대시보드" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/20">
            <Building2 className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">사무소 검수</h1>
            <p className="text-xs text-gray-500">
              미인증 <span className="font-bold text-yellow-400">{unverifiedCount}</span>곳 ·
              인증 <span className="font-bold text-blue-400">{verifiedCount}</span>곳
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-8 space-y-5">
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-[280px] flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="사무소명·자격증번호·사업자번호 검색"
                className="w-full rounded-xl border border-gray-700 bg-gray-900 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              검색
            </button>
          </form>

          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1 flex-wrap">
            {([
              { key: 'unverified', label: `미인증 (${unverifiedCount})` },
              { key: 'verified', label: `인증 (${verifiedCount})` },
              { key: 'all', label: '전체' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setStatus(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  status === t.key ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-800 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : offices.length === 0 ? (
          <EmptyState variant="full" icon={Building2} message="조건에 맞는 사무소가 없어요" darkBg />
        ) : (
          <>
            <ul className="space-y-3 list-none p-0">
              {offices.map(g => {
                const isOpen = expanded.has(g.owner.id)
                const districts = g.owner.district?.split(',').map(d => d.trim()).filter(Boolean) ?? []
                return (
                  <li key={g.owner.id}>
                    <OfficeCard
                      variant="admin"
                      onClick={() => setSelected(g.owner)}
                      office={{
                        id: g.owner.id,
                        office_name: g.owner.office_name,
                        owner_name: g.owner.profiles?.name,
                        owner_email: g.owner.profiles?.email,
                        license_number: g.owner.license_number,
                        business_reg_number: g.owner.business_reg_number,
                        office_reg_number: g.owner.office_reg_number,
                        address: g.owner.address,
                        districts,
                        is_verified: g.owner.is_verified,
                        created_at: g.owner.created_at,
                        employee_count: g.employees.length,
                      }}
                    >
                      {g.employees.length > 0 && (
                        <div className="border-t border-gray-800">
                          <button
                            onClick={() => toggleExpand(g.owner.id)}
                            className="w-full flex items-center justify-between px-5 py-2.5 text-xs font-semibold text-gray-500 hover:bg-gray-800/40 transition-colors"
                          >
                            <span className="flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5" />
                              소속 직원 {g.employees.length}명
                            </span>
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {isOpen && (
                            <ul className="border-t border-gray-800 divide-y divide-gray-800/50 list-none p-0">
                              {g.employees.map(e => (
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

            {hasMore && (
              <div className="flex justify-center">
                <button onClick={() => load(false)} disabled={loadingMore}
                  className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                  {loadingMore ? '불러오는 중...' : '더 보기'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <BrokerDetailModal
          broker={selected}
          onClose={() => setSelected(null)}
          onToggleVerify={() => toggleVerify(selected)}
          onReject={(reason) => rejectVerify(selected, reason)}
        />
      )}
    </div>
  )
}

function BrokerDetailModal({ broker, onClose, onToggleVerify, onReject }: {
  broker: BrokerRow
  onClose: () => void
  onToggleVerify: () => Promise<void>
  onReject: (reason: string) => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const handleToggle = async () => { setBusy(true); await onToggleVerify(); setBusy(false) }
  const handleReject = async () => {
    const reason = rejectReason.trim()
    if (reason.length < 5) return
    setBusy(true)
    const ok = await onReject(reason)
    setBusy(false)
    if (ok) { setRejectOpen(false); setRejectReason('') }
  }

  const districts = broker.district?.split(',').map(d => d.trim()).filter(Boolean) ?? []
  const v = (broker.verification_info ?? {}) as Record<string, any>
  const rejectReasonExisting = typeof v.admin_reject_reason === 'string' ? v.admin_reject_reason : null
  const rejectAt = typeof v.admin_reject_at === 'string' ? v.admin_reject_at : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4"
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white">사무소 상세</h3>
            {broker.is_verified ? (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-400">
                <ShieldCheck className="h-3 w-3" /> 인증됨
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-bold text-yellow-400">
                <ShieldOff className="h-3 w-3" /> 미인증
              </span>
            )}
          </div>
          <button onClick={onClose} disabled={busy} aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4">
          {/* 헤더 */}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500/20 text-2xl font-black text-purple-400">
              {broker.profiles?.name?.[0] ?? '?'}
            </div>
            <div>
              <p className="text-lg font-bold text-white">{broker.office_name ?? '—'}</p>
              <p className="text-sm text-gray-500">대표 · {broker.profiles?.name ?? '(이름 없음)'}</p>
            </div>
          </div>

          {/* 기본 정보 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/40 px-4 py-1 divide-y divide-gray-800/50">
            <Row icon={Mail} label="이메일" value={broker.profiles?.email} />
            <Row icon={Phone} label="연락처" value={broker.profiles?.phone || '미등록'} />
            <Row icon={Hash} label="자격증 번호" value={broker.license_number ? <span className="font-mono">{broker.license_number}</span> : '—'} />
            <Row icon={FileText} label="중개업등록번호" value={broker.office_reg_number ? <span className="font-mono">{broker.office_reg_number}</span> : '—'} />
            <Row icon={FileText} label="사업자등록번호" value={broker.business_reg_number ? <span className="font-mono">{broker.business_reg_number}</span> : '—'} />
            <Row icon={MapPin} label="주소" value={broker.address} />
            <Row icon={MapPin} label="담당 지역" value={
              districts.length > 0 ? (
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {districts.map(d => <span key={d} className="rounded-md bg-gray-700 px-2 py-0.5 text-xs text-gray-300">{d}</span>)}
                </div>
              ) : '—'
            } />
            <Row icon={Calendar} label="가입일" value={broker.created_at && formatDate(broker.created_at)} />
          </div>

          {/* 이전 반려 이력 */}
          {rejectReasonExisting && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
              <div className="mb-2 flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-red-400" />
                <p className="text-xs font-semibold text-red-400">이전 반려 이력</p>
                {rejectAt && <span className="ml-auto text-[11px] text-red-300/70">{formatDate(rejectAt)}</span>}
              </div>
              <p className="text-sm text-red-200 whitespace-pre-line">{rejectReasonExisting}</p>
            </div>
          )}

          {/* 검증 정보 */}
          {Object.keys(v).length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-800/40 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-500">자동 검증 결과</p>
              <pre className="overflow-x-auto rounded-lg bg-gray-950 px-3 py-2.5 text-[11px] text-gray-300 font-mono">
{JSON.stringify(v, null, 2)}
              </pre>
            </div>
          )}

          {/* 활동 */}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="평점" value={broker.rating ? Number(broker.rating).toFixed(1) : '—'} />
            <Stat label="리뷰" value={`${broker.review_count ?? 0}`} />
            <Stat label="성사" value={`${broker.deal_count ?? 0}`} />
          </div>

          {/* 액션 */}
          <div className="space-y-2">
            <button onClick={handleToggle} disabled={busy}
              className={`w-full inline-flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-50 ${
                broker.is_verified
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
              }`}>
              {broker.is_verified ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {busy ? '처리 중...' : broker.is_verified ? '인증 취소' : '인증 승인'}
            </button>

            {!broker.is_verified && (
              <button onClick={() => setRejectOpen(true)} disabled={busy}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-orange-500/40 bg-orange-500/10 py-2.5 text-sm font-semibold text-orange-300 hover:bg-orange-500/20 disabled:opacity-50">
                <AlertCircle className="h-4 w-4" />
                인증 반려 (사유 입력)
              </button>
            )}

          </div>
        </div>
      </div>

      {/* 반려 모달 */}
      {rejectOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => !busy && setRejectOpen(false)}>
          <div className="w-full max-w-md rounded-2xl border border-orange-500/40 bg-gray-900 p-6 shadow-xl"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/20">
                <AlertCircle className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">사무소 인증 반려</h3>
                <p className="text-xs text-gray-500">{broker.office_name ?? '—'}</p>
              </div>
            </div>

            <p className="mt-4 text-sm text-gray-300">반려 사유를 작성해주세요. 중개사 본인에게 알림으로 전달됩니다.</p>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="예) 자격증 번호와 사업자등록번호가 일치하지 않습니다. 자격증 사본을 다시 첨부해주세요."
              className="mt-3 w-full rounded-xl border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 resize-none"
            />
            <p className="mt-1 text-right text-xs text-gray-500">{rejectReason.length}/500 (최소 5자)</p>

            <div className="mt-4 flex gap-2">
              <button onClick={() => setRejectOpen(false)} disabled={busy}
                className="flex-1 rounded-xl border border-gray-700 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                취소
              </button>
              <button onClick={handleReject} disabled={busy || rejectReason.trim().length < 5}
                className="flex-1 rounded-xl bg-orange-600 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50">
                {busy ? '처리 중...' : '반려'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-500 mb-0.5">{label}</p>
        <div className="text-sm text-gray-200 break-all">{value || '—'}</div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-800/40 py-3 text-center">
      <p className="text-xl font-black text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">{label}</p>
    </div>
  )
}
