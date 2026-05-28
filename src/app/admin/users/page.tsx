'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import {
  Users, ArrowLeft, Search, X, Shield, Ban,
  CheckCircle2, AlertCircle, Mail, Phone, Calendar, Building2,
  Pencil, Save, FileText, ChevronDown
} from 'lucide-react'
import { OfficeCard } from '@/components/office-card'
import { EmployeeRow } from '@/components/employee-row'
import { logAdminAction } from '@/lib/audit'

type AccountStatus = 'active' | 'suspended' | 'banned'
type Role = 'user' | 'broker' | 'admin'
// 표시·필터용 세분화 역할 (broker → owner/employee로 분리)
type DisplayRole = 'user' | 'owner' | 'employee' | 'admin'
type RoleFilter = 'all' | DisplayRole
type StatusFilter = 'all' | AccountStatus

interface UserRow {
  id: string
  email: string | null
  name: string | null
  phone: string | null
  role: Role
  account_status: AccountStatus
  suspended_until: string | null
  admin_note: string | null
  created_at: string | null
  // join된 broker_profiles 정보 (broker일 때만)
  broker_profiles?: { id: string; is_owner: boolean | null; office_name: string | null; parent_broker_id: string | null }[] | null
}

interface OfficeGroup {
  key: string                     // 사무소 식별자 (대표의 broker_profile.id)
  officeName: string | null
  owner: UserRow | null           // 대표가 결과에 포함되지 않을 수도 있어 null 허용
  employees: UserRow[]
}

const STATUS_META: Record<AccountStatus, { label: string; color: string; icon: any }> = {
  active: { label: '활성', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle2 },
  suspended: { label: '일시 정지', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: AlertCircle },
  banned: { label: '영구 차단', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: Ban },
}

const DISPLAY_ROLE_META: Record<DisplayRole, { label: string; color: string }> = {
  user: { label: '고객', color: 'bg-blue-500/20 text-blue-400' },
  owner: { label: '대표', color: 'bg-purple-500/20 text-purple-400' },
  employee: { label: '직원', color: 'bg-indigo-500/20 text-indigo-300' },
  admin: { label: '관리자', color: 'bg-red-500/20 text-red-400' },
}

// 역할 변경 모달에서 쓰는 raw role meta (profiles.role 단위)
const ROLE_META: Record<Role, { label: string; color: string }> = {
  user: { label: '고객', color: 'bg-blue-500/20 text-blue-400' },
  broker: { label: '중개사', color: 'bg-purple-500/20 text-purple-400' },
  admin: { label: '관리자', color: 'bg-red-500/20 text-red-400' },
}

// 사용자 row → 표시용 역할 (broker는 is_owner에 따라 분기)
function getDisplayRole(u: UserRow): DisplayRole {
  if (u.role === 'broker') {
    const bp = u.broker_profiles?.[0]
    return bp?.is_owner ? 'owner' : 'employee'
  }
  return u.role as DisplayRole
}

const PAGE_SIZE = 50

export default function AdminUsersPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  // 고객·관리자 (페이지네이션)
  const [items, setItems] = useState<UserRow[]>([])
  // broker — 대표 단위 페이지네이션 (각 대표에 대해 직원은 한 번에 fetch)
  const [brokerItems, setBrokerItems] = useState<UserRow[]>([])
  const [brokerPage, setBrokerPage] = useState(0)
  const [brokerHasMore, setBrokerHasMore] = useState(true)
  const [brokerLoadingMore, setBrokerLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [role, setRole] = useState<RoleFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<UserRow | null>(null)
  const [expandedOfficeKey, setExpandedOfficeKey] = useState<string | null>(null)

  // 사무소 섹션 표시 여부
  const showOffices = role === 'all' || role === 'owner' || role === 'employee'
  // 고객·관리자 섹션 표시 여부
  const showFlatList = role === 'all' || role === 'user' || role === 'admin'

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  // 고객·관리자만 페이지네이션으로 fetch
  const load = useCallback(async (reset = false) => {
    if (!showFlatList) {
      setItems([])
      setHasMore(false)
      if (reset) setLoading(false)
      return
    }
    const targetPage = reset ? 0 : page
    if (reset) setLoading(true)
    else setLoadingMore(true)

    let q = supabase
      .from('profiles')
      .select('id, email, name, phone, role, account_status, suspended_until, admin_note, created_at')
      .order('created_at', { ascending: false })

    // role 필터: 고객/관리자 단일 또는 전체 시 둘 다
    if (role === 'user' || role === 'admin') q = q.eq('role', role)
    else q = q.in('role', ['user', 'admin'])

    if (status !== 'all') q = q.eq('account_status', status)
    if (search.trim()) {
      const s = search.trim()
      q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
    }

    q = q.range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)

    const { data } = await q
    const rows = (data ?? []) as any as UserRow[]
    setItems(prev => reset ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setPage(targetPage + 1)
    if (reset) setLoading(false); else setLoadingMore(false)
  }, [supabase, page, role, status, search, showFlatList])

  // broker 페이지네이션 — 대표를 PAGE_SIZE씩 가져온 뒤 해당 사무소의 직원들을 batch fetch
  // 검색이 있으면: profiles에서 검색 매칭 후 그들의 사무소(대표 기준) 일괄 가져옴
  const loadBrokers = useCallback(async (reset = false) => {
    if (!showOffices) {
      setBrokerItems([])
      setBrokerHasMore(false)
      return
    }
    const targetPage = reset ? 0 : brokerPage
    if (!reset) setBrokerLoadingMore(true)

    const mapBPRow = (bp: any): UserRow => ({
      ...(bp.profiles as any),
      broker_profiles: [{
        id: bp.id,
        is_owner: bp.is_owner,
        office_name: bp.office_name,
        parent_broker_id: bp.parent_broker_id,
      }],
    })

    const s = search.trim()
    let ownerIds: string[] = []
    let pageHasMore = false

    if (s) {
      // 1) 검색어 매칭 profiles (broker 한정) 페이지네이션
      let pq = supabase.from('profiles')
        .select('id')
        .eq('role', 'broker')
        .or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`)
        .order('created_at', { ascending: false })
        .range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)
      if (status !== 'all') pq = pq.eq('account_status', status)
      const { data: profs } = await pq
      pageHasMore = (profs?.length ?? 0) === PAGE_SIZE

      const matchedUserIds = (profs ?? []).map((p: any) => p.id)
      if (matchedUserIds.length === 0) {
        setBrokerItems(reset ? [] : brokerItems)
        setBrokerHasMore(false)
        setBrokerPage(targetPage + 1)
        if (!reset) setBrokerLoadingMore(false)
        return
      }
      // 2) 매칭된 사용자들의 broker_profile → 사무소 식별자 모으기
      const { data: matchedBPs } = await supabase
        .from('broker_profiles')
        .select('id, is_owner, parent_broker_id')
        .in('user_id', matchedUserIds)
      const ownerSet = new Set<string>()
      ;(matchedBPs ?? []).forEach((bp: any) => {
        const oid = bp.is_owner ? bp.id : bp.parent_broker_id
        if (oid) ownerSet.add(oid)
      })
      ownerIds = Array.from(ownerSet)
    } else {
      // 검색어 없음: 대표만 페이지네이션
      const { data: owners } = await supabase
        .from('broker_profiles')
        .select('id, is_owner, office_name, parent_broker_id, profiles!inner(id, email, name, phone, role, account_status, suspended_until, admin_note, created_at)')
        .eq('is_owner', true)
        .order('created_at', { ascending: false })
        .range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)
      pageHasMore = (owners?.length ?? 0) === PAGE_SIZE
      ownerIds = (owners ?? []).map((o: any) => o.id)
      // 검색 없을 때는 대표 row도 그대로 사용 (재조회 피함)
      let ownerRows: UserRow[] = (owners ?? []).map(mapBPRow)
      if (status !== 'all') ownerRows = ownerRows.filter(u => u.account_status === status)

      // 해당 사무소들의 직원 fetch
      let employees: UserRow[] = []
      if (ownerIds.length > 0) {
        const { data: emps } = await supabase
          .from('broker_profiles')
          .select('id, is_owner, office_name, parent_broker_id, profiles!inner(id, email, name, phone, role, account_status, suspended_until, admin_note, created_at)')
          .in('parent_broker_id', ownerIds)
        let empRows: UserRow[] = (emps ?? []).map(mapBPRow)
        if (status !== 'all') empRows = empRows.filter(u => u.account_status === status)
        employees = empRows
      }
      const combined = [...ownerRows, ...employees]
      setBrokerItems(reset ? combined : [...brokerItems, ...combined])
      setBrokerHasMore(pageHasMore)
      setBrokerPage(targetPage + 1)
      if (!reset) setBrokerLoadingMore(false)
      return
    }

    // 검색 모드: ownerIds로 사무소 멤버 전체 fetch
    if (ownerIds.length === 0) {
      setBrokerItems(reset ? [] : brokerItems)
      setBrokerHasMore(pageHasMore)
      setBrokerPage(targetPage + 1)
      if (!reset) setBrokerLoadingMore(false)
      return
    }
    const ownerInList = ownerIds.join(',')
    const { data: fullBPs } = await supabase
      .from('broker_profiles')
      .select('id, is_owner, office_name, parent_broker_id, profiles!inner(id, email, name, phone, role, account_status, suspended_until, admin_note, created_at)')
      .or(`id.in.(${ownerInList}),parent_broker_id.in.(${ownerInList})`)

    let rows: UserRow[] = (fullBPs ?? []).map(mapBPRow)
    if (status !== 'all') rows = rows.filter(u => u.account_status === status)

    setBrokerItems(reset ? rows : [...brokerItems, ...rows])
    setBrokerHasMore(pageHasMore)
    setBrokerPage(targetPage + 1)
    if (!reset) setBrokerLoadingMore(false)
  }, [supabase, status, search, showOffices, brokerPage, brokerItems])

  // brokerItems → 사무소별 그룹화
  const officeGroups: OfficeGroup[] = (() => {
    const map = new Map<string, OfficeGroup>()
    for (const u of brokerItems) {
      const bp = u.broker_profiles?.[0]
      if (!bp) continue
      const key = bp.is_owner ? bp.id : (bp.parent_broker_id ?? bp.id)
      const g = map.get(key) ?? { key, officeName: bp.office_name, owner: null, employees: [] }
      if (bp.is_owner) {
        g.owner = u
        g.officeName = bp.office_name ?? g.officeName
      } else {
        g.employees.push(u)
        if (!g.officeName) g.officeName = bp.office_name
      }
      map.set(key, g)
    }
    // 대표 가입일 기준 정렬, 대표 없으면 첫 직원 기준
    return Array.from(map.values()).sort((a, b) => {
      const ad = a.owner?.created_at ?? a.employees[0]?.created_at ?? ''
      const bd = b.owner?.created_at ?? b.employees[0]?.created_at ?? ''
      return bd.localeCompare(ad)
    })
  })()

  // 대표/직원 필터용 평면 목록
  const flatOwners = role === 'owner'
    ? officeGroups.flatMap(g => g.owner ? [{ u: g.owner, officeName: g.officeName }] : [])
    : []
  const _flatEmployees = role === 'employee'
    ? officeGroups.flatMap(g => g.employees.map(e => ({ u: e, officeName: g.officeName })))
    : []

  useEffect(() => {
    if (auth.profile?.role === 'admin') {
      setPage(0); setHasMore(true)
      setBrokerPage(0); setBrokerHasMore(true)
      load(true)
      loadBrokers(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.profile?.role, role, status])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0); setHasMore(true)
    setBrokerPage(0); setBrokerHasMore(true)
    load(true)
    loadBrokers(true)
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
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/20">
            <Users className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">사용자 관리</h1>
            <p className="text-xs text-gray-400">계정 상태·역할 변경, 관리자 메모</p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-5">
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-[280px] flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="이름·이메일·전화번호 검색"
                className="w-full rounded-xl border border-gray-700 bg-gray-900 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              검색
            </button>
          </form>

          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1 flex-wrap">
            {([
              { key: 'all', label: '전체' },
              { key: 'user', label: '고객' },
              { key: 'owner', label: '대표' },
              { key: 'employee', label: '직원' },
              { key: 'admin', label: '관리자' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setRole(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  role === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1">
            {([
              { key: 'all', label: '상태 전체' },
              { key: 'active', label: '활성' },
              { key: 'suspended', label: '정지' },
              { key: 'banned', label: '차단' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setStatus(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  status === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── 사무소별 중개사 ── */}
        {showOffices && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-purple-400" />
              <h2 className="text-sm font-bold text-white">
                {role === 'owner' ? '대표' : role === 'employee' ? '직원' : '사무소별 중개사'}
              </h2>
              <span className="text-xs text-gray-500">
                {role === 'owner' ? `${flatOwners.length}명`
                  : `${officeGroups.length}곳`}
              </span>
            </div>

            {/* 대표 필터: 대표만 평면 목록 */}
            {role === 'owner' && (
              flatOwners.length === 0 ? (
                <div className="rounded-2xl border border-gray-800 bg-gray-900 py-10 text-center">
                  <Building2 className="mx-auto mb-2 h-10 w-10 text-gray-700" />
                  <p className="text-sm font-semibold text-gray-400">조건에 맞는 대표가 없어요</p>
                </div>
              ) : (
                <ul className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden divide-y divide-gray-800 list-none p-0">
                  {flatOwners.map(({ u, officeName }) => {
                    const sm = STATUS_META[u.account_status]
                    const SIcon = sm.icon
                    return (
                      <li key={u.id}>
                        <button onClick={() => setSelected(u)}
                          className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-800/60 transition-colors">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-400 text-sm font-bold">
                            {(u.name || u.email || '?')[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-white truncate">{u.name || '(이름 없음)'}</p>
                              <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold bg-purple-500/20 text-purple-400">대표</span>
                              {u.account_status !== 'active' && (
                                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${sm.color}`}>
                                  <SIcon className="h-3 w-3" /> {sm.label}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate">{u.email}</p>
                            {officeName && <p className="text-xs text-gray-500 truncate">{officeName}</p>}
                          </div>
                          <span className="text-xs text-gray-500 flex-shrink-0">{u.created_at && formatDate(u.created_at)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )
            )}

            {/* 직원/전체 필터: 사무소 그룹 카드 */}
            {(role === 'employee' || role === 'all') && (
              officeGroups.length === 0 ? (
                <div className="rounded-2xl border border-gray-800 bg-gray-900 py-10 text-center">
                  <Building2 className="mx-auto mb-2 h-10 w-10 text-gray-700" />
                  <p className="text-sm font-semibold text-gray-400">조건에 맞는 사무소가 없어요</p>
                </div>
              ) : (
                <ul className="space-y-3 list-none p-0">
                  {officeGroups.map(g => {
                    // 직원 필터: 항상 펼침 / 전체: 토글
                    const isOpen = role === 'employee' || expandedOfficeKey === g.key
                    return (
                      <li key={g.key}>
                        <OfficeCard
                          variant="admin"
                          onClick={g.owner ? () => setSelected(g.owner!) : undefined}
                          office={{
                            id: g.key,
                            office_name: g.officeName,
                            owner_name: g.owner?.name,
                            owner_email: g.owner?.email,
                            created_at: g.owner?.created_at,
                            employee_count: g.employees.length,
                          }}
                        >
                          {!g.owner && (
                            <div className="border-t border-gray-800 px-5 py-2.5 text-xs text-gray-500">
                              대표 정보 없음 · 직원 {g.employees.length}명
                            </div>
                          )}
                          {g.employees.length > 0 && (
                            <div className="border-t border-gray-800">
                              {role !== 'employee' && (
                                <button
                                  onClick={() => setExpandedOfficeKey(isOpen ? null : g.key)}
                                  className="w-full flex items-center justify-between px-5 py-2.5 text-xs font-semibold text-gray-400 hover:bg-gray-800/40 transition-colors"
                                >
                                  <span className="flex items-center gap-1.5">
                                    <Users className="h-3.5 w-3.5" />
                                    소속 직원 {g.employees.length}명
                                  </span>
                                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                </button>
                              )}
                              {isOpen && (
                                <ul className={`${role !== 'employee' ? 'border-t border-gray-800' : ''} divide-y divide-gray-800/50 list-none p-0`}>
                                  {g.employees.map(e => (
                                    <li key={e.id}>
                                      <EmployeeRow
                                        employee={{
                                          id: e.id,
                                          name: e.name,
                                          email: e.email,
                                          phone: e.phone,
                                          account_status: e.account_status,
                                          created_at: e.created_at,
                                        }}
                                        onClick={() => setSelected(e)}
                                        showApprovalBadge={false}
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
              )
            )}

            {brokerHasMore && (
              <div className="flex justify-center">
                <button
                  onClick={() => loadBrokers(false)}
                  disabled={brokerLoadingMore}
                  className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-2.5 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                >
                  {brokerLoadingMore ? '불러오는 중...' : '사무소 더 보기'}
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── 고객·관리자 ── */}
        {showFlatList && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-400" />
              <h2 className="text-sm font-bold text-white">고객·관리자</h2>
            </div>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-gray-800 bg-gray-900 py-10 text-center">
                <Users className="mx-auto mb-2 h-10 w-10 text-gray-700 dark:text-gray-300" />
                <p className="text-sm font-semibold text-gray-400">조건에 맞는 사용자가 없어요</p>
              </div>
            ) : (
              <>
                <ul className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden divide-y divide-gray-800">
                  {items.map(u => {
                    const sm = STATUS_META[u.account_status]
                    const dr = getDisplayRole(u)
                    const rm = DISPLAY_ROLE_META[dr]
                    const SIcon = sm.icon
                    return (
                      <li key={u.id}>
                        <button onClick={() => setSelected(u)}
                          className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-gray-800/60 transition-colors">
                          <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                            dr === 'admin' ? 'bg-red-500/20 text-red-400'
                              : 'bg-gray-700 text-gray-300'
                          }`}>
                            {(u.name || u.email || '?')[0]?.toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-semibold text-white truncate">{u.name || '(이름 없음)'}</p>
                              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${rm.color}`}>{rm.label}</span>
                              {u.account_status !== 'active' && (
                                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${sm.color}`}>
                                  <SIcon className="h-3 w-3" /> {sm.label}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400 truncate">{u.email}</p>
                          </div>
                          <span className="text-xs text-gray-500 flex-shrink-0">{u.created_at && formatDate(u.created_at)}</span>
                        </button>
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
          </section>
        )}
      </div>

      {selected && (
        <UserDetailModal
          user={selected}
          adminId={auth.user!.id}
          onClose={() => setSelected(null)}
          onUpdated={async (updated) => {
            setItems(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p))
            setBrokerItems(prev => prev.map(p => p.id === updated.id
              ? { ...updated, broker_profiles: p.broker_profiles }
              : p
            ))
            setSelected(prev => prev ? { ...updated, broker_profiles: prev.broker_profiles } : updated)
          }}
        />
      )}
    </div>
  )
}

function UserDetailModal({ user, adminId, onClose, onUpdated }: {
  user: UserRow
  adminId: string
  onClose: () => void
  onUpdated: (u: UserRow) => Promise<void>
}) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState(false)
  const [note, setNote] = useState(user.admin_note ?? '')
  const [suspendDays, setSuspendDays] = useState(7)

  const isSelf = user.id === adminId

  const update = async (patch: Partial<UserRow>) => {
    if (busy) return
    setBusy(true); setErr(null); setOkMsg(null)
    const { data, error } = await supabase
      .from('profiles')
      .update(patch as any)
      .eq('id', user.id)
      .select('id, email, name, phone, role, account_status, suspended_until, admin_note, created_at')
      .single()
    setBusy(false)
    if (error || !data) {
      setErr('변경 실패: ' + (error?.message ?? 'unknown'))
      return
    }
    await onUpdated(data as any as UserRow)
    setOkMsg('저장됐어요')
    setTimeout(() => setOkMsg(null), 2500)
  }

  const setStatus = (s: AccountStatus) => {
    if (isSelf && s !== 'active') { setErr('본인 계정의 상태는 변경할 수 없어요'); return }
    const targetLabel = user.name || user.email || '이 사용자'
    if (s === 'suspended') {
      if (!window.confirm(`${targetLabel} 계정을 ${suspendDays}일 동안 정지할까요?`)) return
    } else if (s === 'banned') {
      if (!window.confirm(`${targetLabel} 계정을 영구 차단할까요?\n로그인이 차단되며 되돌리려면 다시 상태를 변경해야 합니다.`)) return
    }
    const patch: Partial<UserRow> = { account_status: s }
    if (s === 'suspended') {
      const until = new Date(Date.now() + suspendDays * 24 * 60 * 60 * 1000).toISOString()
      patch.suspended_until = until
    } else {
      patch.suspended_until = null
    }
    update(patch)
    void logAdminAction(supabase, adminId, {
      action: s === 'suspended' ? 'user.suspend' : s === 'banned' ? 'user.ban' : 'user.unsuspend',
      targetType: 'user',
      targetId: user.id,
      metadata: { prev: user.account_status, next: s, suspend_days: s === 'suspended' ? suspendDays : undefined },
    })
  }

  const setRole = (r: Role) => {
    if (isSelf && r !== 'admin') { setErr('본인의 admin 권한은 해제할 수 없어요'); return }
    const targetLabel = user.name || user.email || '이 사용자'
    const roleLabel = r === 'admin' ? '관리자' : r === 'broker' ? '중개사' : '일반 사용자'
    if (!window.confirm(`${targetLabel}의 역할을 "${roleLabel}"(으)로 변경할까요?`)) return
    update({ role: r })
    void logAdminAction(supabase, adminId, {
      action: 'user.role_change',
      targetType: 'user',
      targetId: user.id,
      metadata: { prev: user.role, next: r },
    })
  }

  const saveNote = () => {
    update({ admin_note: note || null }).then(() => setEditingNote(false))
  }

  const sm = STATUS_META[user.account_status]
  const dr = getDisplayRole(user)
  const rm = DISPLAY_ROLE_META[dr]
  const officeName = user.broker_profiles?.[0]?.office_name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => !busy && onClose()}>
      <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white">사용자 상세</h3>
            {isSelf && <span className="rounded-md bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-bold text-yellow-400">본인</span>}
          </div>
          <button onClick={onClose} disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 헤더 */}
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-black ${
              dr === 'admin' ? 'bg-red-500/20 text-red-400'
                : dr === 'owner' ? 'bg-purple-500/20 text-purple-400'
                : dr === 'employee' ? 'bg-indigo-500/20 text-indigo-300'
                : 'bg-gray-700 text-gray-200'
            }`}>
              {(user.name || user.email || '?')[0]?.toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-bold text-white">{user.name || '(이름 없음)'}</p>
              {officeName && <p className="text-xs text-gray-400">{officeName}</p>}
              <div className="mt-1 flex items-center gap-1.5">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${rm.color}`}>{rm.label}</span>
                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${sm.color}`}>
                  <sm.icon className="h-3 w-3" /> {sm.label}
                </span>
              </div>
            </div>
          </div>

          {/* 기본 정보 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/40 px-4 py-1 divide-y divide-gray-800/50">
            <InfoRow icon={Mail} label="이메일" value={user.email} />
            <InfoRow icon={Phone} label="연락처" value={user.phone || '미등록'} />
            <InfoRow icon={Calendar} label="가입일" value={user.created_at ? formatDate(user.created_at) : '—'} />
            {user.suspended_until && (
              <InfoRow icon={AlertCircle} label="정지 해제일" value={
                <span className="text-yellow-400">{new Date(user.suspended_until).toLocaleString('ko-KR')}</span>
              } />
            )}
          </div>

          {/* 상태 변경 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-3 text-xs font-semibold text-gray-400">계정 상태</p>
            <div className="grid grid-cols-3 gap-2">
              {(['active', 'suspended', 'banned'] as const).map(s => {
                const m = STATUS_META[s]
                const active = user.account_status === s
                return (
                  <button key={s} onClick={() => setStatus(s)} disabled={busy || active}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-semibold transition-all ${
                      active ? `${m.color} border-current` : 'border-gray-700 bg-transparent text-gray-400 hover:bg-gray-700'
                    } disabled:opacity-50`}>
                    <m.icon className="h-4 w-4" />
                    {m.label}
                  </button>
                )
              })}
            </div>

            {user.account_status !== 'suspended' && (
              <div className="mt-3">
                <p className="mb-1.5 text-[11px] font-semibold text-gray-500">정지 기간 (일)</p>
                <div className="flex items-center gap-2">
                  {[1, 7, 30, 90].map(d => (
                    <button key={d} onClick={() => setSuspendDays(d)}
                      className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                        suspendDays === d ? 'bg-yellow-500/20 text-yellow-400' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                      }`}>
                      {d}일
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-gray-500">&apos;일시 정지&apos; 클릭 시 위에서 선택한 기간만큼 정지됩니다</p>
              </div>
            )}
          </div>

          {/* 역할 변경 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-3 text-xs font-semibold text-gray-400">역할</p>
            <div className="grid grid-cols-3 gap-2">
              {(['user', 'broker', 'admin'] as const).map(r => {
                const m = ROLE_META[r]
                const active = user.role === r
                return (
                  <button key={r} onClick={() => setRole(r)} disabled={busy || active}
                    className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all ${
                      active ? `${m.color} border-current` : 'border-gray-700 bg-transparent text-gray-400 hover:bg-gray-700'
                    } disabled:opacity-50`}>
                    {r === 'admin' && <Shield className="h-3 w-3" />}
                    {r === 'broker' && <Building2 className="h-3 w-3" />}
                    {r === 'user' && <Users className="h-3 w-3" />}
                    {m.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              ⚠️ 여기서는 고객·중개사·관리자 전환만. 중개사 내부의 대표↔직원 구분은 사무소 검수 페이지에서 처리해요.
            </p>
          </div>

          {/* 관리자 메모 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-400">
                <FileText className="h-3.5 w-3.5" /> 관리자 메모 (내부용)
              </p>
              {!editingNote ? (
                <button onClick={() => { setEditingNote(true); setNote(user.admin_note ?? '') }}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300">
                  <Pencil className="h-3 w-3" /> 수정
                </button>
              ) : (
                <button onClick={saveNote} disabled={busy}
                  className="inline-flex items-center gap-1 text-[11px] text-green-400 hover:text-green-300">
                  <Save className="h-3 w-3" /> 저장
                </button>
              )}
            </div>
            {editingNote ? (
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                placeholder="제재 사유·관찰 사항 등"
                className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
              />
            ) : user.admin_note ? (
              <p className="text-sm text-gray-200 whitespace-pre-line">{user.admin_note}</p>
            ) : (
              <p className="text-xs text-gray-500">메모 없음</p>
            )}
          </div>

          {err && (
            <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
              <AlertCircle className="h-4 w-4 flex-shrink-0" /> {err}
            </div>
          )}
          {okMsg && (
            <div className="flex items-center gap-2 rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" /> {okMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-gray-500 mb-0.5">{label}</p>
        <div className="text-sm text-gray-200">{value}</div>
      </div>
    </div>
  )
}
