'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import {
  Building2, ArrowLeft, Search, X, ShieldCheck, ShieldOff,
  CheckCircle2, XCircle, AlertCircle, Hash, MapPin, ExternalLink,
  Users, Phone, Mail, Calendar, FileText, ChevronDown
} from 'lucide-react'
import { OfficeCard } from '@/components/office-card'
import { EmployeeRow } from '@/components/employee-row'
import { useToast } from '@/components/toast'
import { logAdminAction } from '@/lib/audit'

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
  }, [supabase, page, search])

  useEffect(() => {
    if (auth.profile?.role === 'admin') {
      setPage(0); setHasMore(true)
      load(true)
      loadCounts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.profile?.role])

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
    const { error } = await supabase.from('broker_profiles').update({ is_verified: next }).eq('id', broker.id)
    if (error) { toast.error('변경 실패: ' + error.message); return }
    setOffices(prev => prev.map(g =>
      g.owner.id === broker.id ? { ...g, owner: { ...g.owner, is_verified: next } } : g
    ))
    if (selected?.id === broker.id) setSelected({ ...selected, is_verified: next })
    toast.success(next ? '인증 승인됨' : '인증 취소됨')
    if (auth.user) {
      void logAdminAction(supabase, auth.user.id, {
        action: next ? 'broker.verify' : 'broker.unverify',
        targetType: 'broker',
        targetId: broker.id,
        metadata: { office_name: broker.office_name },
      })
    }
    loadCounts()
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
          <Link href="/admin" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/20">
            <Building2 className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">사무소 검수</h1>
            <p className="text-xs text-gray-400">
              미인증 <span className="font-bold text-yellow-400">{unverifiedCount}</span>곳 ·
              인증 <span className="font-bold text-blue-400">{verifiedCount}</span>곳
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-5">
        <form onSubmit={handleSearch} className="flex gap-2">
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

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : offices.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 py-20 text-center">
            <Building2 className="mx-auto mb-3 h-12 w-12 text-gray-700 dark:text-gray-300" />
            <p className="font-semibold text-gray-400">조건에 맞는 사무소가 없어요</p>
          </div>
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
                            className="w-full flex items-center justify-between px-5 py-2.5 text-xs font-semibold text-gray-400 hover:bg-gray-800/40 transition-colors"
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
        />
      )}
    </div>
  )
}

function BrokerDetailModal({ broker, onClose, onToggleVerify }: {
  broker: BrokerRow
  onClose: () => void
  onToggleVerify: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)

  const handleToggle = async () => { setBusy(true); await onToggleVerify(); setBusy(false) }

  const districts = broker.district?.split(',').map(d => d.trim()).filter(Boolean) ?? []
  const v = (broker.verification_info ?? {}) as Record<string, any>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
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
          <button onClick={onClose} disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 헤더 */}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500/20 text-2xl font-black text-purple-400">
              {broker.profiles?.name?.[0] ?? '?'}
            </div>
            <div>
              <p className="text-lg font-bold text-white">{broker.office_name ?? '—'}</p>
              <p className="text-sm text-gray-400">대표 · {broker.profiles?.name ?? '(이름 없음)'}</p>
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

          {/* 검증 정보 */}
          {Object.keys(v).length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-800/40 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">자동 검증 결과</p>
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

            <Link href={`/broker/${broker.id}`} target="_blank"
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-700 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800">
              <ExternalLink className="h-4 w-4" />
              공개 프로필 보기
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
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
