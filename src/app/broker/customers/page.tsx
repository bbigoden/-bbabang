'use client'

import { useEscape } from '@/lib/use-escape'
import { SearchBox, SELECT_BOX } from '@/components/ui/controls'
import { useEffect, useState, useRef, useCallback, useId, useMemo, useDeferredValue } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { AddColBtn } from '@/components/sheet/add-col-button'
import { ColVisibility } from '@/components/sheet/col-visibility'
import { getOfficeMembers } from '@/lib/office-members'
import { canManageOffice } from '@/lib/office-role'
import { Header } from '@/components/layout/header'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Users } from 'lucide-react'
import { Pagination, usePageSize } from '@/components/sheet/pagination'
import { EmptyRow } from '@/components/sheet/empty-row'
import { cn } from '@/lib/utils'
import { useColSettings, ColSettings } from '@/lib/use-col-settings'
import { useSheetDirection } from '@/lib/use-sheet-direction'
import { useToast } from '@/components/toast'
import { ColumnHeader } from '@/components/sheet/column-header'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { findDuplicateCustomers } from '@/lib/dup-check'
import { SheetActionCell, SheetActionHeader } from '@/components/sheet/action-cell'
import { TextCell } from '@/components/sheet/cells/text-cell'
import { SelectCell } from '@/components/sheet/cells/select-cell'
import { DateCell } from '@/components/sheet/cells/date-cell'
import { todayKST } from '@/lib/date-kst'
import { SOURCE_OPTIONS, SOURCE_COLORS } from '@/lib/customer-sources'
import { useOfficeSources } from '@/lib/use-office-sources'
import { formatPhoneKR, looksLikePhone } from '@/lib/validation'
import { checkYmdField } from '@/lib/property-field-check'

// ── 컬럼 정의 ──────────────────────────────────────────
interface ColDef {
  key: string; label: string; fixed?: boolean; minWidth?: number
  hasOptions?: boolean; defaultOpts?: string[]
}

const CUST_COLS: ColDef[] = [
  { key: 'request',        label: '요청사항', fixed: true, minWidth: 160 },
  { key: 'received_date',  label: '접수일자', fixed: true, minWidth: 100 },
  { key: 'contact',        label: '연락처',   fixed: true, minWidth: 130 },
  { key: 'assignee',       label: '담당자',   fixed: true, minWidth: 90, hasOptions: true },
  { key: 'category',       label: '구분',     fixed: true, minWidth: 80, hasOptions: true, defaultOpts: ['비주거', '주거용'] },
  { key: 'source',         label: '유입',     fixed: true, minWidth: 90, hasOptions: true, defaultOpts: SOURCE_OPTIONS },
]

const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(CUST_COLS.map(c => [c.key, c.minWidth ?? 100]))

const DEFAULT_COL_SETTINGS: ColSettings = {
  visible:    CUST_COLS.map(c => c.key),
  order:      CUST_COLS.map(c => c.key),
  widths:     DEFAULT_WIDTHS,
  customCols: [],
  options:    Object.fromEntries(CUST_COLS.filter(c => c.hasOptions).map(c => [c.key, c.defaultOpts!])),
  colTypes:   {},
  multi:      {},
}

const STATUS_COLORS: Record<string, string> = {
  '잠재': 'bg-gray-100 text-gray-600', '진행중': 'bg-blue-100 text-blue-700',
  '종료': 'bg-red-100 text-red-600', '계약완료': 'bg-green-100 text-green-700',
}
const CATEGORY_COLORS: Record<string, string> = {
  '비주거': 'bg-amber-100 text-amber-700', '주거용': 'bg-sky-100 text-sky-700',
}
const COL_COLORS: Record<string, Record<string, string>> = {
  source: SOURCE_COLORS, status: STATUS_COLORS, category: CATEGORY_COLORS,
}

// 표에 쓰는 칸만 받는다 — 상담내용·관심물건(일지 칸)·assignee_ids·updated_at 등까지 '*' 로 900명분을 받아
// 폰 3G 에서 늘어졌다(11-06 점검). [복사] 는 원본 한 줄을 따로 통째로 받아 넣는다.
const CUST_LIST_COLS = 'id, broker_id, client_name, contact, received_date, assignee, category, source, status, request, created_at, custom_fields'

interface Customer {
  id: string; client_name: string; contact: string | null; received_date: string | null
  assignee: string | null; category: string; source: string | null; status: string
  request: string | null; created_at: string; custom_fields: Record<string, string> | null
}




// ── DonutChart ─────────────────────────────────────────
function DonutChart({ data, colors, total }: { data: [string, number][]; colors: string[]; total: number }) {
  const r = 15.9155
  let cumulative = 0
  return (
    <svg viewBox="0 0 36 36" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
      <circle cx="18" cy="18" r={r} fill="none" stroke="#f3f4f6" strokeWidth="3.8" />
      {data.map(([, value], i) => {
        const pct = (value / total) * 100
        const dashoffset = -cumulative
        cumulative += pct
        return (
          <circle key={i} cx="18" cy="18" r={r} fill="none"
            stroke={colors[i % colors.length]}
            strokeWidth="3.8"
            strokeDasharray={`${pct - 0.5} ${100 - pct + 0.5}`}
            strokeDashoffset={dashoffset} />
        )
      })}
    </svg>
  )
}

/** 이 탭에서 마지막으로 다 받은 고객 목록 — 화면을 떠났다 와도 남는다(모듈 변수). 새로고침하면 없다 */
let custCache: { key: string; rows: Customer[] } | null = null

// ── 메인 페이지 ──────────────────────────────────────
export default function BrokerCustomersPage() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const auth = useAuth()
  const toast = useToast()

  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [teamMembers, setTeamMembers] = useState<string[]>([])
  const [canEdit] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  // 저장 함수(useCallback deps 없음)가 최신 행을 읽는 통로.
  // setCustomers updater 안에서 바깥 변수를 채우면 안 된다 — React 는 대기 중인 갱신이 있으면
  // updater 를 다음 렌더로 미뤄서, 바로 다음 줄의 DB 저장에는 빈 값이 나갔다(커스텀 칸이 통째로 덮여 다른 칸이 지워짐).
  const customersRef = useRef(customers)
  customersRef.current = customers
  const [loading, setLoading] = useState(true)
  // 첫 200명만 먼저 그리고 나머지는 뒤에서 받는다 — 다 받기 전에 '전체 200명' 으로 보여 폰 3G 에서 틀린 숫자로 읽혔다(10-30 점검)
  const [allLoaded, setAllLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [monthFilter, setMonthFilter] = useState('전체')
  const [assigneeFilter, setAssigneeFilter] = useState('전체')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('customers')

  // 불러오기 모달
  const deleteTitleId = useId()

  // 칼럼 드래그
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const wasDragRef = useRef(false)
  const officeIdRef = useRef<string>('')  // saveField(useCallback deps 없음)에서 최신 사무소 범위 참조용

  // 칼럼 설정 (DB)
  const { settings, update, loaded } = useColSettings('customers', broker?.id ?? null, DEFAULT_COL_SETTINGS)
  // 유입 선택지는 사무실 공통 — 대표만 머리글에서 고친다(use-office-sources.ts)
  const { sourceOptions, saveSourceOptions } = useOfficeSources(broker ? (broker.is_owner !== false ? broker.id : (broker.parent_broker_id ?? broker.id)) : null, isOwner)
  const { direction } = useSheetDirection(broker?.id ?? null, 'customers')

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id])

  const init = async () => {
    const u = auth.user!
    const b = auth.broker!
    const prof = auth.profile
    setUser(u)
    setProfile(prof); setBroker(b)
    const owner = b.is_owner !== false
    // 보는 범위·담당자 목록은 대표 권한(대표·이사) — 이사도 대표와 같게(11-07 사장님). DB(my_visible_broker_ids)도 이사에게 사무소 전체를 준다
    const manager = canManageOffice(b)
    setIsOwner(manager)

    // ── 권한 체크 (직원만) ──────────────────────────────
    if (!owner) {
      if (b.is_approved === false) { setAccessDenied(true); setLoading(false); return }
    }

    // ── 팀원 이름 목록 구성 ────────────────────────────
    const myName = prof?.name
    const office = owner ? b.id : (b.parent_broker_id ?? b.id)
    if (manager) {
      // 직원 이름은 고객 조회와 함께 보낸다 — 기다렸다가 고객을 부르면 폰 3G 에서 왕복 하나(약 2초)가 더 쌓였다(10-30)
      // 사무소 사람 목록은 화면끼리 같이 쓴다(office-members) — 매물·일지에서 넘어오면 다시 묻지 않는다. 대표가 맨 앞
      void getOfficeMembers(office)
        .then(ms => {
          setTeamMembers(ms.filter(m => m.approved).map(m => m.name).filter(Boolean) as string[])
        }, () => setTeamMembers(myName ? [myName] : []))
    } else {
      setTeamMembers(myName ? [myName] : [])
    }

    // ── 데이터 범위 결정 ───────────────────────────────
    // 룰: 대표=사무소 전체. 직원=사무소 전체 중 본인 작성(broker_id) 또는 본인 담당(assignee=본인이름).
    // (대표가 추가하고 직원을 담당자로 배정한 행도 직원에게 보여야 함 — 업무일지와 일치)
    // 스코프는 office_broker_id 단일 컬럼 — 직원 목록 조립 왕복이 없다.
    // 중복 연락처 경고용 — 직원도 사무소 전체를 대상으로 검사해야 함 (남의 담당 고객과 겹쳐도 알림)
    officeIdRef.current = office

    // 직원 시점: 본인 작성(broker_id) 또는 본인이 담당자에 포함된 행만 노출.
    // 공동담당("오혜진, 권세현")도 콤마 분리 후 매칭해야 각 직원에게 잡힘.
    const visibleRows = (rows: any[]) => manager
      ? rows
      : rows.filter((c: any) => {
          if (c.broker_id === b.id) return true
          if (!myName || !c.assignee) return false
          return c.assignee.split(',').map((s: string) => s.trim()).includes(myName)
        })

    // 첫 묶음만 먼저 받아 즉시 렌더 → 나머지는 백그라운드로 이어 붙임.
    // (전건을 다 받은 뒤에야 화면이 뜨면 폰에서 수 초씩 빈 화면 — 매물장과 동일 전략)
    // 1000건에서 조용히 잘리면 고객이 사라지므로 백그라운드 수집은 반드시 전건 페이지네이션.
    const FIRST_CHUNK = 200
    // 직원은 서버에서 먼저 좁혀 받는다 — 사무소 전건(~900건)을 다 받아 대부분 버리던 낭비.
    // 이름 부분일치라 넓게 잡히고, 정확한 판정(콤마 분리·완전일치)은 visibleRows 가 그대로 한다.
    // 이름의 특수문자는 or() 문법(콤마·괄호·점·따옴표)과 LIKE(%·_·\)를 깨므로 와일드카드(*)로 바꿔 넓게만 잡는다.
    const namePat = myName?.trim() ? `*${myName.replace(/[^\p{L}\p{N}]+/gu, '*')}*`.replace(/\*+/g, '*') : ''
    const custQuery = (from: number, to: number) => {
      let q = supabase.from('broker_customers').select(CUST_LIST_COLS).eq('office_broker_id', office)
      if (!manager) q = namePat ? q.or(`broker_id.eq.${b.id},assignee.ilike.${namePat}`) : q.eq('broker_id', b.id)
      return q.order('received_date', { ascending: false }).order('created_at', { ascending: false })
        .order('id', { ascending: false })  // 동률 시 페이지 경계 안정화 (중복/누락 방지)
        .range(from, to)
    }

    // 이 탭에서 한 번 받은 목록이 있으면 바로 그리고 뒤에서 통째로 새로 받는다 — 들어올 때마다 900명(약 100KB)을
    // 처음부터 받아 폰 3G 에서 9초 걸렸다(10-30 폰 속도 조사). 새로 받은 것으로 한 번에 바꾼다.
    const cacheKey = `${office}|${b.id}|${manager ? 'o' : 's'}`
    if (custCache?.key === cacheKey) {
      setCustomers(custCache.rows)
      setLoading(false)
      setAllLoaded(true)
      void fetchAllPaged((from, to) => custQuery(from, to)).then(all => setCustomers(visibleRows(all ?? [])), () => {})
      return
    }
    const { data: firstPage } = await custQuery(0, FIRST_CHUNK - 1)
    setCustomers(visibleRows(firstPage ?? []))
    setLoading(false)

    if (firstPage && firstPage.length >= FIRST_CHUNK) {
      void (async () => {
        const rest = await fetchAllPaged((from, to) => custQuery(FIRST_CHUNK + from, FIRST_CHUNK + to))
        if (rest?.length) setCustomers(prev => [...prev, ...visibleRows(rest)])
        setAllLoaded(true)
      })()
    } else setAllLoaded(true)
  }

  // 다 받은 목록(고친 것 포함)을 탭 안에 기억해 둔다 — 다시 들어올 때 바로 그린다
  useEffect(() => {
    if (!allLoaded || !broker) return
    const office = broker.is_owner !== false ? broker.id : (broker.parent_broker_id ?? broker.id)
    custCache = { key: `${office}|${broker.id}|${isOwner ? 'o' : 's'}`, rows: customers }
  }, [customers, allLoaded, broker, isOwner])

  // 담당자 변경 알림은 DB 트리거(notify_assignee_change)가 처리
  const saveField = useCallback(async (id: string, field: string, value: any) => {
    // 날짜가 아닌 값·말이 안 되는 날짜는 서버(영문 DB 오류)까지 보내지 않고 여기서 알려 준다
    if (field === 'received_date' && value) {
      const bad = checkYmdField('접수일자', String(value))
      if (bad) { toast.error(bad); return }
    }
    // 연락처는 01073320252 · 010 7332 0252 로 넣어도 010-7332-0252 로 저장
    if (field === 'contact' && typeof value === 'string') value = formatPhoneKR(value)
    // 글 칸 앞뒤 공백은 지운다 — 공백만 넣은 요청사항이 안내문 없는 빈칸으로 저장됐다(10-30 점검)
    if (typeof value === 'string' && (field === 'request' || field === 'contact' || field === 'client_name')) value = value.trim()
    if (field === 'contact' && typeof value === 'string' && value && !looksLikePhone(value)) {
      toast.info('연락처에 전화번호가 없어 보여요 — 적은 그대로 저장했어요')
    }
    // 되돌릴 값·중복 검사 기준은 updater 밖에서 읽는다 (updater 는 언제 돌지 모른다)
    const prevValue = (customersRef.current.find(c => c.id === id) as any)?.[field]
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
    const { error } = await supabase.from('broker_customers')
      .update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) {
      console.error('[saveField] failed', error)
      setCustomers(prev => prev.map(c => c.id === id ? { ...c, [field]: prevValue } : c))
      toast.error(`저장 실패: ${error.message}`)
    } else if (field === 'contact' && typeof value === 'string' && value.trim() && value !== prevValue) {
      // 같은 연락처 고객 경고 — 저장은 이미 됐으므로 차단하지 않고 알림만 (숫자만 비교: 010-1234-5678 == 01012345678)
      void findDuplicateCustomers(supabase, officeIdRef.current, value, id).then(dups => {
        if (dups.length === 0) return
        const first = dups[0]
        const who = first.assignee ? ` · 담당 ${first.assignee}` : ''
        const more = dups.length > 1 ? ` 외 ${dups.length - 1}명` : ''
        toast.info(`⚠️ 같은 연락처 고객이 이미 있어요: ${first.client_name || '(이름 없음)'}${who}${more}`)
      })
    }
  }, [])

  // custom_fields 는 칸 하나가 아니라 객체 통째로 덮어쓰므로, 반드시 행의 지금 값 전체에 이 칸만 얹어 보낸다.
  const saveCustomField = useCallback(async (id: string, colId: string, value: string) => {
    const rows = customersRef.current
    const row = rows.find(c => c.id === id)
    // 행을 못 찾으면 {[colId]: value} 만 나가 다른 칸이 다 지워진다 — 저장하지 않는다
    if (!row) { toast.error('저장 실패: 고객을 찾지 못했어요. 새로고침 후 다시 시도해 주세요'); return }
    const prevFields = row.custom_fields ?? null
    const newFields = { ...(prevFields ?? {}), [colId]: value }
    // 같은 틱에 같은 행의 다른 칸을 또 저장해도 이 값을 딛고 서도록 렌더를 기다리지 않고 바로 반영
    customersRef.current = rows.map(c => c.id === id ? { ...c, custom_fields: newFields } : c)
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, custom_fields: newFields } : c))
    const { error } = await supabase.from('broker_customers').update({ custom_fields: newFields }).eq('id', id)
    if (error) {
      console.error('[saveCustomField] failed', error)
      // 이 칸만 되돌린다 — 그사이 저장한 다른 칸까지 옛 값으로 덮지 않게
      setCustomers(prev => prev.map(c => {
        if (c.id !== id) return c
        const fields = { ...(c.custom_fields ?? {}) }
        if (prevFields && colId in prevFields) fields[colId] = prevFields[colId]
        else delete fields[colId]
        return { ...c, custom_fields: fields }
      }))
      toast.error(`저장 실패: ${error.message}`)
    }
  }, [])

  // 등록·복사 버튼을 두 번 빠르게 누르면 행이 둘씩 생겼다 — 요청이 끝날 때까지 다시 못 누르게 잠근다
  const rowBusyRef = useRef(false)
  // 새 고객 — 찾는 조건부터 받는다. 예전엔 누르는 순간 빈 줄이 저장돼 이번달 신규·사무실 '오늘 등록 고객'에
  // 빈 고객이 세어졌고, 빈 줄의 회색 '요청사항'이 머리글과 같아 칼럼 메뉴를 열게 만들었다(10-30 점검 4명)
  const [newCust, setNewCust] = useState<{ request: string; category: string } | null>(null)
  const [addingNew, setAddingNew] = useState(false)  // 3G 에서 누른 뒤 몇 초 그대로라 — 버튼에 '등록 중…'
  const openNewCustomer = () => setNewCust({ request: '', category: '' })
  useEscape(!!newCust, () => setNewCust(null))
  const addRow = async () => {
    if (!broker || !newCust || rowBusyRef.current) return
    const request = newCust.request.trim()
    if (!request) return toast.error('찾는 조건을 적어 주세요')
    rowBusyRef.current = true
    setAddingNew(true)
    try {
    const today = todayKST()
    const { data, error } = await supabase.from('broker_customers').insert({
      broker_id: broker.id, client_name: '', received_date: today,
      assignee: profile?.name ?? null,
      category: newCust.category, status: '', request,
    }).select().single()
    if (error || !data) {
      toast.error(`등록하지 못했습니다: ${error?.message ?? '알 수 없는 오류'}. 로그인이 풀렸다면 다시 로그인해 주세요.`)
      return
    }
    setNewCust(null)
    toast.success('등록했어요 — 연락처·유입 등 나머지 칸은 표에서 바로 채우면 저장돼요')
    // customers 배열은 created_at desc 순서. 화면 reverse가 direction을 처리하므로 항상 앞에 추가.
    setCustomers(prev => [data, ...prev])
    setAddingId(data.id); setTimeout(() => setAddingId(null), 2000)
    } finally { rowBusyRef.current = false; setAddingNew(false) }
  }

  // 고객 row 복사 — id/created_at 제외하고 모든 필드 동일하게 새 row 생성
  const duplicateCustomer = async (c: Customer) => {
    if (!broker || rowBusyRef.current) return
    rowBusyRef.current = true
    try {
      // 목록엔 표에 쓰는 칸만 있어 상담내용 등이 빠지므로 원본을 통째로 다시 받아 복사한다
      const { data: full, error: readErr } = await supabase.from('broker_customers').select('*').eq('id', c.id).maybeSingle()
      if (readErr || !full) { toast.error('복사하지 못했습니다. 다시 눌러 주세요.'); return }
      const { id: _id, created_at: _ca, updated_at: _ua, deleted_at: _da, ...rest } = full as Record<string, unknown>
      const { data, error } = await supabase.from('broker_customers').insert(rest).select(CUST_LIST_COLS).single()
      if (error || !data) { toast.error(`복사하지 못했습니다: ${error?.message ?? '알 수 없는 오류'}`); return }
      setCustomers(prev => [data, ...prev])
      setAddingId(data.id); setTimeout(() => setAddingId(null), 2000)
    } finally { rowBusyRef.current = false }
  }

  const deleteRow = async (id: string) => {
    // 휴지통 이동(soft delete) — SECURITY DEFINER RPC (본인·대표만 가능)
    const { error } = await supabase.rpc('soft_delete_customer', { cust_id: id })
    if (error) {
      console.error('[deleteRow] failed', error)
      toast.error(`삭제 실패: ${error.message}`)
      setDeleteConfirm(null)
      return
    }
    setCustomers(prev => prev.filter(c => c.id !== id))
    setDeleteConfirm(null)
  }

  // 칼럼 너비 조절
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = settings.widths[key] ?? 100
    const onMove = (ev: MouseEvent) => update(prev => ({ ...prev, widths: { ...prev.widths, [key]: Math.max(50, startW + ev.clientX - startX) } }))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  // 칼럼 순서 드래그
  const onColDragStart = (key: string, e: React.DragEvent) => {
    wasDragRef.current = true; setDragCol(key); e.dataTransfer.effectAllowed = 'move'
  }
  const onColDragOver = (key: string, e: React.DragEvent) => { e.preventDefault(); setDragOverCol(key) }
  const onColDrop = (key: string) => {
    if (!dragCol || dragCol === key) return
    update(prev => {
      const arr = [...prev.order]
      const fi = arr.indexOf(dragCol)
      const ti = arr.indexOf(key)
      if (ti < 0) return prev
      if (fi < 0) {
        arr.splice(ti, 0, dragCol)
      } else {
        arr.splice(fi, 1); arr.splice(ti, 0, dragCol)
      }
      return { ...prev, order: arr }
    })
    setDragCol(null); setDragOverCol(null)
  }
  const onColDragEnd = () => {
    setDragCol(null); setDragOverCol(null)
    setTimeout(() => { wasDragRef.current = false }, 50)
  }

  // 칼럼 표시/숨김
  const showCol = (key: string) => update(prev => ({ ...prev, visible: [...prev.visible, key] }))
  const hideCol = (key: string) => update(prev => ({ ...prev, visible: prev.visible.filter(k => k !== key) }))
  const setOpts = (key: string, opts: string[]) => update(prev => ({ ...prev, options: { ...prev.options, [key]: opts } }))

  // 커스텀 칼럼 관리
  const addCustomCol = (name: string, type: 'text' | 'select' = 'text') => {
    const id = `custom_${Date.now()}`
    update(prev => ({
      ...prev,
      customCols: [...prev.customCols, { id, name, type }],
      order: [...prev.order, id],
      visible: [...prev.visible, id],
      widths: { ...prev.widths, [id]: 120 },
      options: type === 'select' ? { ...prev.options, [id]: [] } : prev.options,
    }))
  }
  const renameCustomCol = (id: string, name: string) => {
    update(prev => ({ ...prev, customCols: prev.customCols.map(c => c.id === id ? { ...c, name } : c) }))
  }
  const changeCustomColType = (id: string, type: 'text' | 'select') => {
    update(prev => ({
      ...prev,
      customCols: prev.customCols.map(c => c.id === id ? { ...c, type } : c),
      options: type === 'select' && !prev.options[id] ? { ...prev.options, [id]: [] } : prev.options,
    }))
  }
  const changeFixedColType = (key: string, type: 'text' | 'select') => {
    update(prev => ({ ...prev, colTypes: { ...prev.colTypes, [key]: type } }))
  }
  const setMulti = (key: string, multi: boolean) => {
    update(prev => ({ ...prev, multi: { ...prev.multi, [key]: multi } }))
  }
  const deleteCustomCol = (id: string) => {
    update(prev => ({
      ...prev,
      customCols: prev.customCols.filter(c => c.id !== id),
      order: prev.order.filter(k => k !== id),
      visible: prev.visible.filter(k => k !== id),
    }))
  }

  // 필터/통계
  // 월별 카운트 (단일 순회)
  // 고객 800여 건을 글자 하나 칠 때마다 세 번씩 훑었다 — 폰에서 검색 입력이 끊겼다.
  // 목록이 바뀔 때만 다시 세고, 검색은 입력을 먼저 그린 뒤 따라간다.
  const monthCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    customers.forEach(c => {
      if (!c.received_date) return
      const m = c.received_date.slice(0, 7)
      counts[m] = (counts[m] || 0) + 1
    })
    return counts
  }, [customers])
  const months = ['전체', ...Object.keys(monthCounts).sort((a, b) => b.localeCompare(a))]

  // 담당자별 카운트 — assignee의 콤마 분리해서 개별 이름 단위로 누적
  // (공동 담당 "오혜진, 김규영"은 오혜진 1건 + 김규영 1건으로 카운트)
  const assigneeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    customers.forEach(c => {
      if (!c.assignee) return
      c.assignee.split(',').forEach(n => {
        const name = n.trim()
        if (name) counts[name] = (counts[name] || 0) + 1
      })
    })
    return counts
  }, [customers])
  // 재직자는 가입일시 순(teamMembers), 그 뒤에 퇴사자 등 나머지 이름을 가나다순(11-07 사장님)
  const assignees = ['전체',
    ...teamMembers.filter(n => assigneeCounts[n]),
    ...Object.keys(assigneeCounts).filter(n => !teamMembers.includes(n)).sort((a, b) => a.localeCompare(b, 'ko'))]

  const [statsOpen, setStatsOpen] = useState(false)
  const deferredSearch = useDeferredValue(search)
  const filtered = useMemo(() => customers.filter(c => {
    if (monthFilter !== '전체' && (!c.received_date || !c.received_date.startsWith(monthFilter))) return false
    if (assigneeFilter !== '전체') {
      if (!c.assignee) return false
      const names = c.assignee.split(',').map(s => s.trim())
      if (!names.includes(assigneeFilter)) return false
    }
    // 앞뒤 공백·전각(０１０)은 지우고 찾는다 — '점검용 ' 이 0명으로 나왔다(매물 검색은 됐다, 10-30 재점검).
    // 연락처는 숫자만 맞춰도 걸리게(01012345678 로 찾아도 010-1234-5678).
    const q = deferredSearch.normalize('NFKC').trim().toLowerCase()
    if (q) {
      const fields = [
        c.request, c.contact, c.assignee, c.category, c.source, c.status, c.received_date,
      ]
      if (fields.some(f => f?.toLowerCase().includes(q))) return true
      // 낱말 여러 개는 칸을 넘나들어도 모두 들어 있으면 찾는다 — '불당 상가' 가 0명이었다(11-06 점검)
      const words = q.split(/\s+/)
      if (words.length > 1) {
        const hay = [...fields, ...Object.values(c.custom_fields ?? {}).filter(v => typeof v === 'string')]
          .filter(Boolean).join(' ').toLowerCase()
        if (words.every(w => hay.includes(w))) return true
      }
      const qDigits = q.replace(/\D/g, '')
      if (qDigits.length >= 3 && qDigits.length === q.replace(/[\s-]/g, '').length
        && (c.contact ?? '').replace(/\D/g, '').includes(qDigits)) return true
      if (c.custom_fields) {
        return Object.values(c.custom_fields).some(v => typeof v === 'string' && v.toLowerCase().includes(q))
      }
      return false
    }
    return true
  }), [customers, monthFilter, assigneeFilter, deferredSearch])
  const thisMonth = todayKST().slice(0, 7)
  const newThisMonth = customers.filter(c => c.received_date?.startsWith(thisMonth)).length

  // 페이지네이션 (filtered + 정렬 후 슬라이스)
  const sortedFiltered = direction === 'up' ? filtered : [...filtered].reverse()
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = sortedFiltered.slice((page - 1) * pageSize, page * pageSize)
  // 필터 변경 시 1페이지로 리셋
  useEffect(() => { setPage(1) }, [monthFilter, assigneeFilter, search, pageSize])

  // 알림에서 ?focus=ID 로 진입 시 해당 고객 강조 (한 번만 처리)
  const focusedRef = useRef<string | null>(null)
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || loading) return
    if (focusedRef.current === focus) return
    if (customers.some(c => c.id === focus)) {
      focusedRef.current = focus
      setAddingId(focus)
      setTimeout(() => setAddingId(null), 2500)
    }
  }, [searchParams, loading, customers])

  // 홈 [바로 하기 → 고객 등록] 은 ?new=1 로 들어와 등록 창을 바로 연다 (한 번만, 매물목록과 같게)
  const newOpenedRef = useRef(false)
  useEffect(() => {
    if (newOpenedRef.current || !broker || searchParams.get('new') !== '1') return
    newOpenedRef.current = true
    setNewCust({ request: '', category: '' })
    const u = new URL(window.location.href); u.searchParams.delete('new')
    window.history.replaceState(window.history.state, '', u.pathname + (u.search ? u.search : ''))
  }, [broker, searchParams])

  // 새 행 추가 시 새 행이 있는 페이지로 이동 + 화면 스크롤 + 첫 셀 자동 편집
  useEffect(() => {
    if (!addingId) return
    // 새 행 위치: 위로 쌓기 → page 1, 아래로 쌓기 → 마지막 페이지
    const targetPage = direction === 'up' ? 1 : Math.max(1, Math.ceil(customers.length / pageSize))
    setPage(targetPage)
    // 페이지 전환 + 렌더링 후 스크롤만 — 첫 칸을 눌러 주던 것은 뺐다. 첫 칸이 접수일자라
    // 등록하자마자(알림으로 들어와도) 달력이 열려, 찾는 조건을 어디 적는지 헷갈렸다(10-30 점검)
    const t = setTimeout(() => {
      const row = document.querySelector(`tr[data-row-id="${addingId}"]`) as HTMLElement | null
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    return () => clearTimeout(t)
  }, [addingId, direction, customers.length, pageSize])

  // 도넛 분포 — 최대 8개. 9개 이상은 상위 7 + 기타.
  const distribute = (map: Record<string, number>, max = 8): [string, number][] => {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1])
    if (entries.length <= max) return entries
    const top = entries.slice(0, max - 1)
    const restSum = entries.slice(max - 1).reduce((s, [, v]) => s + v, 0)
    return [...top, ['기타', restSum]]
  }
  // 도넛은 현재 필터(월/담당자/검색)에 맞춘 filtered 기준으로 계산.
  // 담당자는 사람마다 센다 — 공동담당("오혜진, 권세현")은 두 사람 모두에게 하나씩. 예전엔 '공동담당'
  // 한 칸으로 묶어 김용유가 도넛 2·필터 741 로 달라 보였다(11-06 점검). 그래서 칸 합은 고객 수보다
  // 클 수 있고, 가운데 숫자는 고객 수(filtered.length)를 보인다. 담당자·구분이 빈 고객은 '없음'·'미정' 칸.
  const assigneeDist = (() => {
    const map: Record<string, number> = {}
    filtered.forEach(c => {
      const names = (c.assignee ?? '').split(',').map(n => n.trim()).filter(Boolean)
      if (!names.length) names.push('없음')
      for (const n of names) map[n] = (map[n] ?? 0) + 1
    })
    return distribute(map)
  })()
  const categoryDist = (() => {
    const map: Record<string, number> = {}
    filtered.forEach(c => { const k = c.category?.trim() || '미정'; map[k] = (map[k] ?? 0) + 1 })
    return distribute(map)
  })()
  // 유입은 PC 12칸·폰 10칸까지 따로 보인다 — 8칸이면 톡톡·워킹이 '기타'에 묻혔다(11-05).
  // PC 는 카드가 넓어 3열로 놓이니 12칸도 4줄이고, 폰은 2열이라 10칸(5줄)에서 끊는다.
  const [wideStats, setWideStats] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const on = () => setWideStats(mq.matches)
    on(); mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const sourceDist = (() => {
    const map: Record<string, number> = {}
    // 유입이 빈 고객은 '없음' 칸 — 빠지면 가운데 숫자가 다른 카드와 달랐다(11-06 재점검)
    filtered.forEach(c => { const k = c.source?.trim() || '없음'; map[k] = (map[k] ?? 0) + 1 })
    return distribute(map, wideStats ? 12 : 10)
  })()

  // 활성 칼럼
  const fixedCols: ColDef[] = []
  const optionalCols = CUST_COLS

  type ActiveCol =
    | { type: 'fixed'; def: ColDef }
    | { type: 'optional'; def: ColDef }
    | { type: 'custom'; id: string; name: string }

  const activeCols: ActiveCol[] = loaded
    ? [
        ...settings.order.flatMap((key): ActiveCol[] => {
          const optDef = CUST_COLS.find(c => c.key === key)
          if (optDef && settings.visible.includes(key)) return [{ type: 'optional', def: optDef }]
          const customDef = settings.customCols.find(c => c.id === key)
          if (customDef && settings.visible.includes(key)) return [{ type: 'custom', id: customDef.id, name: customDef.name }]
          return []
        }),
      ]
    : CUST_COLS.map(def => ({ type: 'optional' as const, def }))

  const renderCell = (c: Customer, col: ActiveCol) => {
    const ro = !canEdit
    if (col.type === 'custom') {
      const customDef = settings.customCols.find(cc => cc.id === col.id)
      if (customDef?.type === 'select') {
        const opts = settings.options[col.id] ?? []
        return <SelectCell value={c.custom_fields?.[col.id] ?? ''} options={opts} onSave={v => saveCustomField(c.id, col.id, v)} readOnly={ro} multi={settings.multi[col.id]} />
      }
      return <TextCell value={c.custom_fields?.[col.id] ?? ''} onSave={v => saveCustomField(c.id, col.id, v)} placeholder="—" readOnly={ro} />
    }
    const def = col.def
    const opts = def.key === 'source' ? sourceOptions : (settings.options[def.key] ?? def.defaultOpts ?? [])
    const colorMap = COL_COLORS[def.key]
    switch (def.key) {
      case 'request':       return <TextCell value={c.request} onSave={v => saveField(c.id, 'request', v || null)} placeholder="요청사항" readOnly={ro} />
      case 'received_date': return <DateCell value={c.received_date} onSave={v => saveField(c.id, 'received_date', v || null)} readOnly={ro} />
      case 'contact':       return <TextCell value={c.contact} onSave={v => saveField(c.id, 'contact', v || null)} placeholder="연락처" readOnly={ro} />
      case 'assignee':
        if (ro || !canManageOffice(broker)) return <TextCell value={c.assignee} onSave={() => {}} placeholder="담당자" readOnly={true} />
        return <SelectCell value={c.assignee ?? ''} options={teamMembers} onSave={v => saveField(c.id, 'assignee', v || null)} placeholder="담당자" multi={settings.multi['assignee']} />
      case 'category':      return (settings.colTypes['category'] === 'text')
        ? <TextCell value={c.category} onSave={v => saveField(c.id, 'category', v)} placeholder="구분" readOnly={ro} />
        : <SelectCell value={c.category} options={opts} onSave={v => saveField(c.id, 'category', v)} colorMap={colorMap} readOnly={ro} placeholder="구분" multi={settings.multi['category']} />
      case 'source':        return (settings.colTypes['source'] === 'text')
        ? <TextCell value={c.source} onSave={v => saveField(c.id, 'source', v || null)} placeholder="유입" readOnly={ro} />
        : <SelectCell value={c.source ?? ''} options={opts} onSave={v => saveField(c.id, 'source', v)} colorMap={colorMap} readOnly={ro} placeholder="유입" multi={settings.multi['source']} />
      case 'status':        return (settings.colTypes['status'] === 'text')
        ? <TextCell value={c.status} onSave={v => saveField(c.id, 'status', v)} placeholder="진행상황" readOnly={ro} />
        : <SelectCell value={c.status} options={opts} onSave={v => saveField(c.id, 'status', v)} colorMap={colorMap} readOnly={ro} placeholder="진행상황" multi={settings.multi['status']} />
      default: return null
    }
  }

  const getColKey = (col: ActiveCol) => col.type === 'custom' ? col.id : col.def.key
  const getColWidth = (col: ActiveCol) => {
    const key = getColKey(col)
    return settings.widths[key] ?? (col.type === 'custom' ? 120 : (col.def.minWidth ?? 100))
  }

  if (loading) return (
    <div className="bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-gray-500 text-sm">불러오는 중...</div>
    </div>
  )

  if (accessDenied) return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="text-5xl">🔒</div>
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-300">고객목록 접근 권한이 없어요</h2>
        <p className="text-sm text-gray-500">대표에게 권한 설정을 요청해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="px-4 py-6">

        {/* 헤더 */}
        <div className="mb-5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">고객목록</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {allLoaded ? `전체 ${customers.length}명 · 검색 ${filtered.length}명` : `고객 불러오는 중… (지금 ${customers.length}명까지)`}
            </p>
          </div>
          {/* 표 맨 아래까지 내려가야 보이던 '고객 등록'을 제목 줄에도 둔다 (매물목록의 '+ 매물 등록' 과 같은 자리) */}
          {canEdit && (
            <button type="button" onClick={openNewCustomer}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" />고객 등록
            </button>
          )}
        </div>

        {/* 통계 */}
        {(() => {
          const ASSIGNEE_COLORS = ['#5174b1','#2c5095','#14274e','#859ecd']
          const CATEGORY_COLORS_CHART = ['#a78bfa','#8b5cf6','#7c3aed','#c4b5fd']
          const SOURCE_COLORS_CHART = ['#34d399','#10b981','#f59e0b','#f97316','#6366f1','#ec4899','#14b8a6','#84cc16','#a855f7','#0ea5e9','#eab308','#64748b']
          const aTotal = assigneeDist.reduce((s,[,v])=>s+v,0)
          const cTotal = categoryDist.reduce((s,[,v])=>s+v,0)
          const sTotal = sourceDist.reduce((s,[,v])=>s+v,0)
          return (
            // 다 받기 전엔 첫 200명 기준 숫자라 흐리게 두고 '불러오는 중'을 덮는다 — 폰 3G 에서 200·공동담당 70 을
            // 진짜 숫자로 읽었다(10-30 재점검). 맨 위 작은 글자만으로는 스크롤해 내려와 있으면 안 보였다.
            <>
            {/* 폰에선 카드 4개가 고객 표를 한 화면 반 아래로 밀었다(11-06 점검) — 접어 두고 누르면 편다 */}
            <button type="button" onClick={() => setStatsOpen(v => !v)}
              className="mb-3 w-full rounded-xl border border-gray-100 bg-white px-4 py-2 text-left text-xs font-semibold text-gray-600 sm:hidden dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              {statsOpen ? '통계 접기 ▴' : `통계 보기 ▾ · 이번 달 신규 ${newThisMonth}명`}
            </button>
            <div className={cn('relative mb-5', !statsOpen && 'hidden sm:block')} aria-busy={!allLoaded}>
            {!allLoaded && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-gray-600 shadow dark:bg-gray-900/90 dark:text-gray-300">고객 불러오는 중…</span>
              </div>
            )}
            {/* 유입이 10칸이라 칸을 넓게 주고, 나머지 카드는 내용을 세로 가운데에 — 같은 줄 높이에 맞춰 늘어나 아래가 텅 비어 보였다(11-05) */}
            <div className={cn('grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[0.5fr_1.15fr_0.85fr_1.5fr] gap-3', !allLoaded && 'opacity-30')}>
              {/* 신규 */}
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-4 py-4 shadow-sm flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  <span className="text-xs font-semibold text-gray-500">신규</span>
                </div>
                <div>
                  <div className="text-3xl font-black text-blue-600 leading-none">{monthFilter === '전체' ? newThisMonth : filtered.length}<span className="text-sm font-normal text-gray-500 ml-1">명</span></div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">{monthFilter === '전체' ? '이번달 신규 고객' : `${monthFilter.slice(2, 4)}년 ${parseInt(monthFilter.slice(5, 7), 10)}월 신규 고객`}</div>
                </div>
              </div>

              {/* 담당자 도넛 */}
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-4 py-4 shadow-sm flex flex-col">
                <div className="text-xs font-semibold text-gray-500 mb-3">담당자</div>
                {assigneeDist.length === 0 ? (
                  <div className="text-xs text-gray-500 text-center py-6">데이터 없음</div>
                ) : (
                  <div className="flex-1 flex items-center gap-3">
                    <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
                      <DonutChart data={assigneeDist} colors={ASSIGNEE_COLORS} total={aTotal} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-gray-600 dark:text-gray-500">{filtered.length}</span>
                      </div>
                    </div>
                    <div className={`flex-1 min-w-0 ${assigneeDist.length > 4 ? 'grid grid-cols-2 gap-x-2 gap-y-1.5' : 'space-y-1.5'}`}>
                      {assigneeDist.map(([label, count], i) => (
                        <div key={label} className="flex items-center gap-1.5 min-w-0">
                          <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: ASSIGNEE_COLORS[i % ASSIGNEE_COLORS.length] }} />
                          <span className="text-[11px] text-gray-600 dark:text-gray-500 truncate flex-1">{label}</span>
                          <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 구분 도넛 */}
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-4 py-4 shadow-sm flex flex-col">
                <div className="text-xs font-semibold text-gray-500 mb-3">구분</div>
                {categoryDist.length === 0 ? (
                  <div className="text-xs text-gray-500 text-center py-6">데이터 없음</div>
                ) : (
                  <div className="flex-1 flex items-center gap-3">
                    <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
                      <DonutChart data={categoryDist} colors={CATEGORY_COLORS_CHART} total={cTotal} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-gray-600 dark:text-gray-500">{cTotal}</span>
                      </div>
                    </div>
                    <div className={`flex-1 min-w-0 ${categoryDist.length > 4 ? 'grid grid-cols-2 gap-x-2 gap-y-1.5' : 'space-y-1.5'}`}>
                      {categoryDist.map(([label, count], i) => (
                        <div key={label} className="flex items-center gap-1.5 min-w-0">
                          <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS_CHART[i % CATEGORY_COLORS_CHART.length] }} />
                          <span className="text-[11px] text-gray-600 dark:text-gray-500 truncate flex-1">{label}</span>
                          <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 유입 도넛 */}
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-4 py-4 shadow-sm flex flex-col @container">
                <div className="text-xs font-semibold text-gray-500 mb-3">유입</div>
                {sourceDist.length === 0 ? (
                  <div className="text-xs text-gray-500 text-center py-6">데이터 없음</div>
                ) : (
                  <div className="flex-1 flex items-center gap-3">
                    <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
                      <DonutChart data={sourceDist} colors={SOURCE_COLORS_CHART} total={sTotal} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-gray-600 dark:text-gray-500">{sTotal}</span>
                      </div>
                    </div>
                    <div className={`flex-1 min-w-0 ${sourceDist.length > 6 ? 'grid grid-cols-2 @sm:grid-cols-3 gap-x-3 gap-y-1.5' : sourceDist.length > 4 ? 'grid grid-cols-2 gap-x-2 gap-y-1.5' : 'space-y-1.5'}`}>
                      {sourceDist.map(([label, count], i) => (
                        <div key={label} className="flex items-center gap-1.5 min-w-0">
                          <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_COLORS_CHART[i % SOURCE_COLORS_CHART.length] }} />
                          <span className="text-[11px] text-gray-600 dark:text-gray-500 truncate flex-1">{label}</span>
                          <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            </div>
            </>
          )
        })()}

        {/* 필터 */}
        <div className="mb-3 flex flex-nowrap items-center gap-2">
          <SearchBox value={search} onChange={setSearch} placeholder="전체 검색..." label="고객 전체 검색" className="flex-1 sm:max-w-xs" />

          <select aria-label="월별 필터" value={monthFilter} onChange={e => setMonthFilter(e.target.value)}
            className={cn(SELECT_BOX, 'shrink-0 max-w-[34%] sm:max-w-none px-2 sm:px-3')}>
            {months.map(m => {
              const label = m === '전체'
                ? '월별'
                : (() => { const [y, mo] = m.split('-'); return `${y.slice(2)}년 ${parseInt(mo)}월 (${monthCounts[m]})` })()
              return <option key={m} value={m}>{label}</option>
            })}
          </select>

          {canManageOffice(broker) && assignees.length > 1 && (
            <select aria-label="담당자 필터" value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}
              className={cn(SELECT_BOX, 'shrink-0 max-w-[34%] sm:max-w-none px-2 sm:px-3')}>
              {assignees.map(a => (
                <option key={a} value={a}>
                  {a === '전체' ? '담당자' : `${a} (${assigneeCounts[a]})`}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 테이블 */}
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="border-collapse table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
              <thead>
                <tr className="border-b-2 border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-xs font-semibold text-gray-500 uppercase tracking-wide select-none">
                  {activeCols.map(col => {
                    const key = getColKey(col)
                    const w = getColWidth(col)
                    return (
                      <th key={key}
                        className={`px-2 py-2.5 text-left relative border-r border-gray-100 dark:border-gray-800 transition-colors ${dragOverCol === key ? 'bg-blue-50' : 'hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800'} cursor-grab`}
                        style={{ width: w, maxWidth: w }}
                        draggable
                        onDragStart={e => onColDragStart(key, e)}
                        onDragOver={e => onColDragOver(key, e)}
                        onDrop={() => onColDrop(key)}
                        onDragEnd={onColDragEnd}
                      >
                        <div className="pr-2">
                          {col.type === 'custom' ? (() => {
                            const customDef = settings.customCols.find(cc => cc.id === col.id)
                            return (
                              <ColumnHeader
                                label={col.name} isCustom
                                colType={customDef?.type ?? 'text'}
                                onChangeType={type => changeCustomColType(col.id, type)}
                                hasOptions={customDef?.type === 'select'}
                                options={settings.options[col.id] ?? []}
                                onSetOptions={opts => setOpts(col.id, opts)}
                                isMulti={settings.multi[col.id]}
                                onChangeMulti={m => setMulti(col.id, m)}
                                onHide={() => hideCol(col.id)}
                                onRename={name => renameCustomCol(col.id, name)}
                                onDelete={() => deleteCustomCol(col.id)}
                              />
                            )
                          })() : (
                            <ColumnHeader
                              label={col.def.label}
                              isFixed={col.def.fixed}
                              hasOptions={col.def.hasOptions && settings.colTypes[col.def.key] !== 'text'}
                              options={col.def.key === 'source' ? sourceOptions : (settings.options[col.def.key] ?? col.def.defaultOpts ?? [])}
                              onSetOptions={col.def.key === 'assignee' ? undefined : col.def.key === 'source' ? saveSourceOptions : opts => setOpts(col.def.key, opts)}
                              colType={col.def.hasOptions && col.def.key !== 'assignee' ? (settings.colTypes[col.def.key] ?? 'select') : undefined}
                              onChangeType={col.def.hasOptions && col.def.key !== 'assignee' ? type => changeFixedColType(col.def.key, type) : undefined}
                              isMulti={settings.multi[col.def.key]}
                              onChangeMulti={col.def.hasOptions ? m => setMulti(col.def.key, m) : undefined}
                              onHide={() => hideCol(col.def.key)}
                            />
                          )}
                        </div>
                        <div onMouseDown={e => startResize(key, e)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 transition-all" />
                      </th>
                    )
                  })}
                  <SheetActionHeader>
                    <AddColBtn onAdd={addCustomCol} />
                    <ColVisibility
                      cols={[...fixedCols.map(c => ({ key: c.key, label: c.label, fixed: true })), ...optionalCols.map(c => ({ key: c.key, label: c.label }))]}
                      visible={settings.visible}
                      onToggle={key => settings.visible.includes(key) ? hideCol(key) : showCol(key)}
                    />
                  </SheetActionHeader>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <EmptyRow
                    colSpan={activeCols.length + 1}
                    message={customers.length === 0 ? '아직 등록된 고객이 없어요' : '검색 결과가 없어요'}
                  />
                ) : paginated.map((c, _idx) => (
                  <tr key={c.id} data-row-id={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    {activeCols.map(col => (
                      <td key={getColKey(col)} className="px-3 py-1.5 border-r border-gray-100 dark:border-gray-800"
                        style={{ width: getColWidth(col), maxWidth: getColWidth(col) }}>
                        {renderCell(c, col)}
                      </td>
                    ))}
                    <SheetActionCell canEdit={canEdit} onCopy={() => duplicateCustomer(c)} onDelete={() => setDeleteConfirm(c.id)} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>

      {/* 새 고객 — 찾는 조건부터 받는다 (매물목록 '새 매물 등록' 창과 같은 모양) */}
      {newCust && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setNewCust(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void addRow() }}
            className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <h3 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">새 고객 등록</h3>
            <p className="mb-4 text-sm text-gray-500">찾는 조건만 적으면 등록돼요. 연락처·유입 같은 나머지 칸은 등록한 뒤 표에서 바로 채우면 저절로 저장돼요.</p>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="new-cust-request">찾는 조건 (요청사항) {/* 폰 키보드엔 Shift+Enter 가 없어 PC 에서만 보인다(11-06 재점검) */}<span className="hidden text-xs font-normal text-gray-400 sm:inline">Enter 로 등록 · 줄바꿈은 Shift+Enter</span></label>
            <textarea id="new-cust-request" autoFocus rows={3} maxLength={2000} value={newCust.request}
              onChange={e => setNewCust(v => v && { ...v, request: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void addRow() } }}
              placeholder="예: 불당동 상가 20평 월세 200 이하"
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
            <p className="mb-1 mt-4 text-sm font-medium text-gray-700 dark:text-gray-300">구분 <span className="text-xs font-normal text-gray-400">(나중에 골라도 돼요)</span></p>
            <div className="flex flex-wrap gap-2">
              {['비주거', '주거용'].map(d => (
                <button key={d} type="button" onClick={() => setNewCust(v => v && { ...v, category: v.category === d ? '' : d })}
                  className={cn('rounded-lg border px-3 py-1.5 text-sm font-medium',
                    newCust.category === d ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800')}>
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setNewCust(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800">취소</button>
              <button type="submit" disabled={!newCust.request.trim() || addingNew}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">{addingNew ? '등록 중…' : '등록'}</button>
            </div>
          </form>
        </div>
      )}

      {/* 삭제 확인 */}
      {deleteConfirm && (
        <div role="dialog" aria-modal="true" aria-labelledby={deleteTitleId} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
            <h3 id={deleteTitleId} className="text-lg font-bold text-gray-900 dark:text-white mb-6">고객을 삭제할까요?</h3>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
              <button onClick={() => deleteRow(deleteConfirm)} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
