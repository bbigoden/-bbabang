'use client'

import { useEscape } from '@/lib/use-escape'
import { useEffect, useState, useRef, useCallback, useId } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { AddColBtn } from '@/components/sheet/add-col-button'
import { ColVisibility } from '@/components/sheet/col-visibility'
import { getOfficeMembers } from '@/lib/office-members'
import { canManageOffice } from '@/lib/office-role'
import { Header } from '@/components/layout/header'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, ChevronLeft, ChevronRight, ChevronDown, X, Download, ArrowUp, ArrowDown } from 'lucide-react'
import { SearchClear } from '@/components/ui/search-clear'
import { cn } from '@/lib/utils'
import { useColSettings, ColSettings } from '@/lib/use-col-settings'
import { useSheetDirection } from '@/lib/use-sheet-direction'
import { ColumnHeader } from '@/components/sheet/column-header'
import { EmptyRow } from '@/components/sheet/empty-row'
import { SheetActionCell, SheetActionHeader } from '@/components/sheet/action-cell'
import { DateCell } from '@/components/sheet/cells/date-cell'
import { TextCell } from '@/components/sheet/cells/text-cell'
import { LongTextCell } from '@/components/sheet/cells/long-text-cell'
import { SelectCell } from '@/components/sheet/cells/select-cell'
import { notifyOwnerOfBrokerAction } from '@/lib/notify-owner'
import { EmptyState } from '@/components/empty-state'
import { DiaryAdCommon } from '@/components/broker/diary-ad-common'
import { useToast } from '@/components/toast'
import { todayKST, addDays } from '@/lib/date-kst'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { SOURCE_OPTIONS, SOURCE_COLORS } from '@/lib/customer-sources'
import { useOfficeSources } from '@/lib/use-office-sources'

// ── 컬럼 정의 (고객목록과 동일) ─────────────────────────
interface ColDef {
  key: string; label: string; fixed?: boolean; minWidth?: number
  hasOptions?: boolean; defaultOpts?: string[]; isLong?: boolean
}

const CUST_COLS: ColDef[] = [
  { key: 'request',            label: '요청사항', fixed: true, minWidth: 160, isLong: true },
  { key: 'received_date',      label: '접수일자', fixed: true, minWidth: 100 },
  { key: 'contact',            label: '연락처',   fixed: true, minWidth: 130 },
  { key: 'interest',           label: '관심물건', fixed: true, minWidth: 110, hasOptions: true, defaultOpts: ['상가','창고','오피스텔','건물','아파트','토지'] },
  { key: 'source',             label: '유입',     fixed: true, minWidth: 90,  hasOptions: true, defaultOpts: SOURCE_OPTIONS },
  { key: 'status',             label: '진행상황', fixed: true, minWidth: 100, hasOptions: true, defaultOpts: ['잠재','진행중','종료','계약완료'] },
  { key: 'consult_note',       label: '상담내용', fixed: true, minWidth: 260, isLong: true },
  { key: 'proposed_properties',label: '제안 매물', fixed: true, minWidth: 180 },
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
  '잠재':'bg-gray-100 text-gray-600','진행중':'bg-blue-100 text-blue-700',
  '종료':'bg-red-100 text-red-600','계약완료':'bg-green-100 text-green-700',
}
const CATEGORY_COLORS: Record<string, string> = {
  '비주거':'bg-amber-100 text-amber-700','주거용':'bg-sky-100 text-sky-700',
  '상가':'bg-amber-100 text-amber-700','공장':'bg-orange-100 text-orange-700',
  '창고':'bg-rose-100 text-rose-700','사무실':'bg-indigo-100 text-indigo-700',
  '토지':'bg-green-100 text-green-700','기타':'bg-gray-100 text-gray-600',
}
const COL_COLORS: Record<string, Record<string, string>> = { source: SOURCE_COLORS, status: STATUS_COLORS, category: CATEGORY_COLORS }

interface Customer {
  id: string; client_name: string; contact: string | null; received_date: string | null
  assignee: string | null; category: string; source: string | null; status: string
  request: string | null; custom_fields: Record<string, string> | null
}
interface Property {
  id: string; seq_no: number | null; address: string; deal_type: string; room_type: string
  price: number; monthly_rent: number | null
  // 칩에서만 조회 (피커는 안 가져감) — 누르면 중개사메모 복사
  memo?: string | null; broker_id?: string | null; assignee?: string | null
}
interface DiaryCustomerRow {
  link_id: string   // broker_diary_customers.id
  sort_order: number
  proposed_property_ids: string[] | null
  id: string; client_name: string; contact: string | null; received_date: string | null
  assignee: string | null; category: string; source: string | null; status: string
  request: string | null; custom_fields: Record<string, string> | null
  // 휴지통에 들어간 고객. 일지에는 그날 기록으로 남지만 broker_customers RLS가
  // deleted_at IS NULL을 요구해 수정이 0행으로 끝나므로 읽기 전용으로 보여 준다.
  is_deleted?: boolean
}

// diary_customers_for_date RPC 한 행 → 화면 행 (로드·불러오기가 같은 규칙을 쓰도록 한 곳에)
const toDiaryRow = (l: any): DiaryCustomerRow => ({
  link_id: l.link_id, sort_order: l.sort_order,
  proposed_property_ids: l.proposed_property_ids ?? [],
  id: l.id, client_name: l.client_name, contact: l.contact,
  received_date: l.received_date, assignee: l.assignee, category: l.category,
  source: l.source, status: l.status, request: l.request, interest: l.interest,
  consult_note: l.consult_note, custom_fields: l.custom_fields,
  is_deleted: !!l.is_deleted,
} as DiaryCustomerRow)

// update가 오류 없이 0행으로 끝나면(RLS에 막혔거나 그새 삭제됨) PostgREST는 204만 준다.
// 이걸 성공으로 보면 화면만 바뀌고 새로고침하면 사라지므로 실패로 다룬다.
const NO_ROW_MSG = '권한이 없거나 삭제된 항목이에요'

// 일지 본문·구조를 저장할 대상 행. archive면 퇴사자 일지(broker_diary_archive).
// req는 저장을 시작할 때의 로드 순번, key는 같은 칸 저장을 묶는 이름.
interface DiaryTarget { archive: boolean; officeId: string; brokerId: string; date: string; req: number; key: string }

interface SectionDef { id: string; title: string }
// 이날부터 3번 광고현황은 사무실 공통 칸(현황판 숫자 + 공통 메모). 그전 일지는 예전처럼 사람마다 쓴 칸 그대로(2026-10-29 사장님)
const AD_COMMON_FROM = '2026-10-29'
const DEFAULT_SECTIONS: SectionDef[] = [
  { id: 's_work',     title: '업무요약' },
  { id: 's_ad',       title: '광고현황' },
  { id: 's_suggest',  title: '건의사항' },
  { id: 's_delivery', title: '전달사항' },
]
// 기본 섹션 id의 이름 — 레거시 데이터에서 이름을 복원할 때 사용
const KNOWN_SECTION_TITLES: Record<string, string> = {
  s_work: '업무요약', s_ad: '광고현황', s_suggest: '건의사항', s_delivery: '전달사항',
}

// 이 날짜에 보여줄 섹션 목록을 결정한다.
// 1) 날짜별 섹션(perDate)이 있으면 그대로 사용 — 이 날짜에서 추가/삭제한 결과가 우선
//    (의도적으로 삭제한 섹션이 되살아나면 안 되므로 perDate가 있으면 안전망 미적용)
// 2) 없으면(레거시 날짜) 이 사람의 기존 전역 섹션(legacy) → 그것도 없으면 기본값
// 3) 안전망: 기본 섹션(업무요약·광고현황·건의사항·전달사항)에 내용이 있는데 목록에서
//    빠졌다면 되살린다. 전역에서 지워진 기본 섹션의 과거 내용이 사라지지 않게 하는 용도.
//    이름을 알 수 없는 옛 커스텀 키는 되살리지 않는다(애매한 '기타' 박스 남발 방지).
//    — 어느 경우든 내용 자체는 DB(sections_content)에 그대로 보존됨.
function resolveSections(perDate: any, legacy: any, content: Record<string, string>, date: string): SectionDef[] {
  return dropSuggest(pickSections(perDate, legacy, Object.keys(content)), content, date)
}
function pickSections(perDate: any, legacy: any, contentKeys: string[]): SectionDef[] {
  if (Array.isArray(perDate) && perDate.length > 0) return perDate as SectionDef[]
  const base: SectionDef[] = (Array.isArray(legacy) && legacy.length > 0) ? legacy as SectionDef[] : DEFAULT_SECTIONS
  const have = new Set(base.map(s => s.id))
  const extra = contentKeys
    .filter(k => KNOWN_SECTION_TITLES[k] && !have.has(k))
    .map(k => ({ id: k, title: KNOWN_SECTION_TITLES[k] }))
  return extra.length > 0 ? [...base, ...extra] : base
}
// 이날부터 건의사항 칸을 뺀다 — 전달사항이 4번으로 올라온다(2026-11-03 사장님).
// 이미 적어 둔 건의사항은 숨기면 안 보이게 되므로, 내용이 있으면 그 날짜만 남긴다.
const NO_SUGGEST_FROM = '2026-11-03'
function dropSuggest(list: SectionDef[], content: Record<string, string>, date: string): SectionDef[] {
  if (date < NO_SUGGEST_FROM || content['s_suggest']?.trim()) return list
  return list.filter(s => s.id !== 's_suggest')
}



// 피커가 쓰는 매물 컬럼 — 목록 표시에 필요한 최소한만 (images·description 등 무거운 건 제외)
const PROP_PICK_COLS = 'id, seq_no, address, deal_type, room_type, price, monthly_rent'
const PROP_CHIP_COLS = `${PROP_PICK_COLS}, memo, broker_id, assignee`
const CUST_PICK_COLS = 'id, broker_id, client_name, contact, received_date, assignee, category, source, status, request, interest, consult_note, custom_fields'

// 피커가 한 번에 받아올 최대 건수 — 상한에 걸리면 UI에서 사용자에게 알린다
const CUST_PICK_LIMIT = 100
const PROP_PICK_LIMIT = 30

// PostgREST .or() 필터는 쉼표·괄호로 조건을 구분하므로 검색어에 그대로 들어가면 쿼리가 깨진다.
const sanitizeFilterTerm = (s: string) => s.trim().replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim()

// ── ProposedPropertiesCell ────────────────────────────
function ProposedPropertiesCell({ propIds, propertyMap, canSeeMemo, onOpen, onRemove, readOnly }: {
  propIds: string[] | null
  propertyMap: Record<string, Property>  // 이 날짜 일지가 참조하는 매물만 담긴 맵 (전건 아님)
  canSeeMemo: (p: Property) => boolean
  onOpen: () => void; onRemove: (id: string) => void; readOnly?: boolean
}) {
  const toast = useToast()
  const selected = (propIds ?? []).map(id => propertyMap[id]).filter(Boolean) as Property[]
  // 칩을 누르면 중개사메모를 클립보드로 — 바로 다른 곳에 붙여넣게
  const copyMemo = async (p: Property) => {
    if (!canSeeMemo(p)) { toast.info('이 매물의 중개사메모는 볼 권한이 없어요'); return }
    const memo = (p.memo ?? '').trim()
    if (!memo) { toast.info('중개사메모가 비어 있어요'); return }
    try {
      await navigator.clipboard.writeText(memo)
      toast.success('중개사메모를 복사했어요')
    } catch {
      toast.error('복사하지 못했어요')
    }
  }
  const formatDetail = (p: Property) => {
    const price = p.deal_type === '월세'
      ? `${p.price != null ? p.price.toLocaleString() + '만' : '—'}/${p.monthly_rent != null ? p.monthly_rent.toLocaleString() + '만' : '—'}`
      : p.price != null ? `${p.price.toLocaleString()}만` : '—'
    return `${p.deal_type} · ${p.room_type} · ${price}`
  }
  if (selected.length === 0) {
    if (readOnly) return <span className="text-xs text-gray-500 px-1">—</span>
    return (
      <button onClick={onOpen} className="flex items-center gap-1 px-1 py-0.5 text-xs text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors w-full">
        <Plus className="h-3 w-3" />매물 추가
      </button>
    )
  }
  return (
    <div className="flex flex-wrap gap-1 items-center px-1 py-0.5">
      {selected.map(p => (
        <span key={p.id} className="group/chip inline-flex items-center gap-0.5 rounded-lg bg-indigo-50 pl-2 pr-0.5 py-0.5 text-[11px] font-medium text-indigo-700 max-w-[160px]" title={`${p.seq_no != null ? `#${p.seq_no} ` : ''}${p.address || '주소없음'}\n${formatDetail(p)}`}>
          <button type="button" onClick={e => { e.stopPropagation(); void copyMemo(p) }} className="truncate hover:underline">{p.address || '주소없음'}</button>
          {!readOnly && (
            <button
              onClick={e => { e.stopPropagation(); onRemove(p.id) }}
              aria-label="매물 제거"
              className="flex h-3.5 w-3.5 items-center justify-center rounded text-indigo-400 hover:bg-indigo-200 hover:text-indigo-700 transition-colors flex-shrink-0"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <button onClick={onOpen} className="flex h-4 w-4 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-500 transition-colors flex-shrink-0">
          <Plus className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ── PropertyPicker ────────────────────────────────────
function PropertyPicker({ officeId, selectedIds, memoScope, onConfirm, onClose }: {
  officeId: string | null; selectedIds: string[]
  /** null = 대표·이사(모든 메모 검색). 직원이면 본인 id·대표 이름 — 메모를 볼 수 있는 매물만 메모로 찾는다 */
  memoScope: { selfId: string; ownerName: string } | null
  onConfirm: (ids: string[]) => void; onClose: () => void
}) {
  const supabase = createClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds))
  const [rows, setRows] = useState<Property[]>([])
  const [pinned, setPinned] = useState<Property[]>([])  // 이미 선택된 매물 — 검색어와 무관하게 항상 보여야 체크가 유지됨
  const [loading, setLoading] = useState(true)

  // 이미 선택된 매물을 id로 직접 조회해 고정 (서버 검색 결과에 안 걸려도 목록에서 사라지지 않게)
  useEffect(() => {
    if (selectedIds.length === 0) { setPinned([]); return }
    let alive = true
    supabase.from('broker_properties').select(PROP_PICK_COLS).in('id', selectedIds)
      .then(({ data }) => { if (alive) setPinned((data ?? []) as Property[]) })
    return () => { alive = false }
    // selectedIds는 모달이 열릴 때 고정 — 의도적으로 최초 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 입력이 멎고 250ms 뒤 서버 검색 (전건 프리로드 대체 — 필요한 30건만 받는다)
  useEffect(() => {
    if (!officeId) return
    let alive = true
    setLoading(true)
    const timer = setTimeout(async () => {
      const term = sanitizeFilterTerm(search)
      let q = supabase.from('broker_properties').select(PROP_PICK_COLS).eq('office_broker_id', officeId)
      // 낱말마다 따로 건다(모두 맞아야) — '불당 월세' 처럼 주소·거래형태에 나뉜 말도 찾게(11-06 재점검)
      for (const w of term.split(' ').filter(Boolean)) {
        const digits = w.replace(/[^0-9]/g, '')
        const conds = [`address.ilike.%${w}%`, `deal_type.ilike.%${w}%`, `room_type.ilike.%${w}%`]
        // seq_no는 정수 컬럼 — 자릿수가 크면 오버플로로 쿼리가 깨지므로 제외
        if (digits && digits === w && digits.length <= 9) conds.push(`seq_no.eq.${digits}`)
        // 중개사메모의 가게 이름('완미족발')으로도 찾게(11-06). 숫자만 친 말은 메모에 안 건다(전화번호 떠보기 방지).
        // 대표·이사는 모든 메모, 직원은 메모를 볼 수 있는 매물(본인 것·담당자에 대표)에서만 — 직원끼리는 못 찾는다.
        if (digits !== w) {
          if (!memoScope) conds.push(`memo.ilike.%${w}%`)
          else {
            const who: string[] = []
            if (memoScope.selfId) who.push(`broker_id.eq.${memoScope.selfId}`)
            if (memoScope.ownerName) who.push(`assignee.ilike.%${memoScope.ownerName}%`)
            if (who.length) conds.push(`and(memo.ilike.%${w}%,or(${who.join(',')}))`)
          }
        }
        q = q.or(conds.join(','))
      }
      const { data } = await q.order('created_at', { ascending: false }).limit(PROP_PICK_LIMIT)
      if (!alive) return
      setRows((data ?? []) as Property[])
      setLoading(false)
    }, search ? 250 : 0)
    return () => { alive = false; clearTimeout(timer) }
  }, [search, officeId, memoScope?.selfId, memoScope?.ownerName])

  // 선택된 것 먼저, 그 뒤 검색 결과(중복 제외)
  const pinnedIds = new Set(pinned.map(p => p.id))
  const filtered = [...pinned, ...rows.filter(p => !pinnedIds.has(p.id))]
  const toggle = (id: string) => {
    setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s })
  }
  const formatPrice = (p: Property) => {
    if (p.deal_type === '월세') {
      const dep = p.price != null ? `${p.price.toLocaleString()}만` : '—'
      const mo = p.monthly_rent != null ? `${p.monthly_rent.toLocaleString()}만` : '—'
      return `${dep}/${mo}`
    }
    return p.price != null ? `${p.price.toLocaleString()}만` : '—'
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">제안 매물 선택</h3>
          <button onClick={onClose} aria-label="닫기" className="text-gray-500 hover:text-gray-600 dark:text-gray-500"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
          <div className="relative">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="매물번호, 주소, 유형, 메모 검색..." className="w-full rounded-xl border border-gray-200 dark:border-gray-800 pl-3 pr-8 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
            {search && <SearchClear onClick={() => setSearch('')} />}
          </div>
          {/* 전건을 받지 않으므로 상한에 걸리면 반드시 알린다 */}
          {rows.length >= PROP_PICK_LIMIT && (
            <p className="mt-2 text-xs text-gray-500">최근 {PROP_PICK_LIMIT}건만 표시 중이에요. 주소나 매물번호로 검색해 보세요.</p>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0
            ? <EmptyState variant="inline" message={loading ? '매물 불러오는 중...' : '매물 없음'} />
            : filtered.map(p => (
              <div key={p.id} onClick={() => toggle(p.id)}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0">
                <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${selected.has(p.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-700'}`}>
                  {selected.has(p.id) && <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </div>
                {p.seq_no != null && (
                  <span className="flex-shrink-0 inline-flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 tabular-nums min-w-[2.25rem]">
                    {p.seq_no}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.address}</div>
                  <div className="text-xs text-gray-500">{p.deal_type} · {p.room_type} · {formatPrice(p)}</div>
                </div>
              </div>
            ))
          }
        </div>
        <div className="p-3 border-t border-gray-100 dark:border-gray-800 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
          <button onClick={() => onConfirm(Array.from(selected))} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            확인 ({selected.size}개)
          </button>
        </div>
      </div>
    </div>
  )
}

// ── CustomerPicker ────────────────────────────────────
function CustomerPicker({ officeId, linkedIds, ownerName, ownerBrokerId: _ownerBrokerId, onAddExisting, onCreateNew, onClose }: {
  officeId: string | null; linkedIds: Set<string>
  ownerName: string  // 일지 주인 이름 — 담당자 매칭 + 표시용
  ownerBrokerId: string | null  // 일지 주인 broker_id — 그 사람 소유 고객만 필터
  onAddExisting: (c: Customer) => void
  onCreateNew: () => void; onClose: () => void
}) {
  const supabase = createClient()
  const toast = useToast()
  useEscape(true, onClose)
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  // 입력이 멎고 250ms 뒤 서버 검색 (전건 프리로드 대체)
  // 담당자 필터는 서버에서 ilike로 넓게 잡고, 아래에서 콤마 분리 정확 매칭으로 정제한다.
  useEffect(() => {
    if (!officeId) return
    let alive = true
    setLoading(true)
    const timer = setTimeout(async () => {
      let q = supabase.from('broker_customers').select(CUST_PICK_COLS).eq('office_broker_id', officeId)
      if (ownerName) q = q.ilike('assignee', `%${ownerName}%`)
      // 낱말마다 조건을 따로 걸어 모두 맞는 고객을 찾는다(.or 를 여러 번 = 그리고) — '불당 월세' 가
      // 한 덩어리로만 찾아져 0건이었다. 고객목록 검색과 같은 결과가 나와야 한다(11-06 재점검).
      for (const w of sanitizeFilterTerm(search).split(' ').filter(Boolean)) {
        q = q.or(`request.ilike.%${w}%,contact.ilike.%${w}%,client_name.ilike.%${w}%`)
      }
      const { data, error } = await q.order('created_at', { ascending: false }).limit(CUST_PICK_LIMIT)
      if (!alive) return
      // 실패하면 앞 목록이 결과처럼 남아 있었다(' OR 1=1 같은 말은 보안 필터가 막는다, 11-06 점검)
      if (error) toast.error('검색하지 못했어요. 다른 말로 찾아 주세요.')
      setRows(error ? [] : (data ?? []) as Customer[])
      setLoading(false)
    }, search ? 250 : 0)
    return () => { alive = false; clearTimeout(timer) }
  }, [search, officeId, ownerName])

  // 일지 주인 담당자(assignee) 정확 매칭 + 아직 일지에 안 들어간 것만
  // broker_id가 아니라 assignee 이름으로 매칭 — 봇 등 다른 계정이 등록해도 담당자 일지에 보임.
  // 공동담당("오혜진, 권세현, 김규영")도 콤마로 분리해야 '김규영' 검색에 '김규영수'가 안 걸린다.
  const filtered = rows.filter(c => {
    if (linkedIds.has(c.id)) return false
    if (!ownerName) return true
    if (!c.assignee) return false
    return c.assignee.split(',').map(s => s.trim()).includes(ownerName)
  })
  const capped = rows.length >= CUST_PICK_LIMIT

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-gray-900 shadow-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">고객 등록</h3>
            <p className="text-xs text-gray-500 mt-0.5">{ownerName} 담당 고객 중 일지에 추가할 행을 클릭하세요</p>
          </div>
          <button onClick={onClose} aria-label="닫기" className="text-gray-500 hover:text-gray-600 dark:text-gray-500 transition-colors"><X className="h-5 w-5" /></button>
        </div>

        {/* 검색 */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="relative">
            <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
              placeholder="요청사항, 연락처, 고객명으로 검색..."
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 pl-3 pr-8 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
            {search && <SearchClear onClick={() => setSearch('')} />}
          </div>
          {/* 전건을 받지 않으므로 상한에 걸리면 반드시 알린다 — 조용히 잘리면 "고객이 사라졌다"가 된다 */}
          {capped && (
            <p className="mt-2 text-xs text-gray-500">
              최근 {CUST_PICK_LIMIT}건만 표시하고 있어요. 찾는 고객이 없으면 이름·연락처로 검색해 보세요.
            </p>
          )}
        </div>

        {/* 테이블 */}
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">
              {loading ? '고객 목록 불러오는 중...'
                : search ? '검색 결과 없음'
                : (ownerName ? `${ownerName} 담당의 가능 고객이 없어요` : '추가 가능한 고객이 없어요')}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="px-3 py-2.5 text-left">요청사항</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">접수일자</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">연락처</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">담당자</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">구분</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">유입</th>
                  <th className="px-3 py-2.5" style={{ width: 64 }}><span className="sr-only">액션</span></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} onClick={() => onAddExisting(c)}
                    className="group border-b border-gray-50 cursor-pointer hover:bg-blue-50/60 transition-colors">
                    <td className="px-3 py-2 text-gray-800 dark:text-gray-100 max-w-md truncate">{c.request || c.client_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{c.received_date ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{c.contact ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{c.assignee ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{c.category || <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{c.source ?? <span className="text-gray-300">—</span>}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="text-xs font-semibold text-gray-300 group-hover:text-blue-600 transition-colors">추가</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 푸터 */}
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3 flex items-center gap-3 flex-shrink-0 bg-gray-50/50">
          <button onClick={onCreateNew}
            className="flex items-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-800 px-3 py-2 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors">
            <Plus className="h-4 w-4" />새 고객 만들기
          </button>
          <div className="flex-1" />
          <button onClick={onClose}
            className="rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 transition-colors">
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

// ── MasonryCell (벽돌 쌓기 한 칸) ─────────────────────
// 그리드 행을 MASONRY_ROW(4px)로 잘게 나누고, 칸마다 자기 키만큼 행을 차지하게 한다.
// 그리드는 순서대로 놓으며 먼저 비는 줄에 다음 칸을 넣으므로 덜 찬 쪽으로 쌓인다.
// 칸 사이 간격(16px)은 행 간격 대신 차지하는 키에 더한다. 글을 쓰면 키가 바뀌니 계속 잰다.
const MASONRY_ROW = 4
const MASONRY_GAP = 16
function MasonryCell({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [span, setSpan] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSpan(Math.ceil((el.getBoundingClientRect().height + MASONRY_GAP) / MASONRY_ROW))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div style={{ gridRowEnd: `span ${span}` }} className="min-w-0">
      <div ref={ref}>{children}</div>
    </div>
  )
}

// ── DiarySection (동적, 이름변경/삭제 가능) ───────────────
function DiarySection({ def, num, content, onSave, onRename, onDelete, readOnly }: {
  def: SectionDef; num: number; content: string | null
  onSave: (v: string) => Promise<boolean>; onRename: (id: string, title: string) => void
  onDelete: (id: string) => void; readOnly?: boolean
}) {
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(def.title)
  const [draft, setDraft] = useState(content ?? '')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // 입력 중인지 — 저장은 blur 뒤에 비동기로 끝나는데, 그 사이 다시 들어와 이어 쓰던
  // 글자를 저장 완료 값(content)이 덮어쓰면 안 된다. 입력 중엔 화면의 글이 우선이다.
  const focusedRef = useRef(false)
  // textarea를 내용 줄 수에 맞춰 자동 늘어나게 (스크롤 없이)
  const autoSize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useEffect(() => { if (!focusedRef.current) setDraft(content ?? '') }, [content])
  useEffect(() => { setTitleDraft(def.title) }, [def.title])
  useEffect(() => { autoSize() }, [draft, readOnly])
  const commitRename = () => {
    if (titleDraft.trim() && titleDraft !== def.title) onRename(def.id, titleDraft.trim())
    setRenaming(false)
  }
  // 저장이 실패하면 쓴 글은 화면에 그대로 두고(content는 안 바뀜) 다시 저장할 수 있게 한다.
  // 토스트는 몇 초 뒤 사라지므로 머리에도 '저장 안 됨'을 남긴다.
  // 저장은 줄을 서서 차례로 끝나므로, 앞 것이 먼저 끝나도 뒤 것이 남아 있으면 '저장 중'을 유지한다.
  const inflightRef = useRef(0)
  const save = async (v: string) => {
    inflightRef.current++
    setSaving(true)
    const ok = await onSave(v)
    if (--inflightRef.current === 0) setSaving(false)
    setFailed(!ok)
    // 저장됐다는 표시가 없어 저장됐는지 모른다는 말이 세 명에게서 나왔다(11-06 점검)
    if (ok) { setJustSaved(true); clearTimeout(savedTimer.current); savedTimer.current = setTimeout(() => setJustSaved(false), 2500) }
  }
  const [justSaved, setJustSaved] = useState(false)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(savedTimer.current), [])
  const handleBlur = () => {
    focusedRef.current = false
    if (draft === (content ?? '')) { setFailed(false); return }
    void save(draft)
  }
  // blur에서만 저장하면 쓰다가 새로고침·뒤로가기 했을 때 글이 경고 없이 사라졌다(11-03 점검).
  // 입력이 1.5초 멈추면 저장하고, 안 끝난 글·저장 중이 있으면 떠나기 전에 브라우저가 묻게 한다.
  useEffect(() => {
    if (readOnly || !focusedRef.current || draft === (content ?? '')) return
    const t = setTimeout(() => { if (focusedRef.current) void save(draft) }, 1500)
    return () => clearTimeout(t)
  }, [draft]) // eslint-disable-line react-hooks/exhaustive-deps
  const unsavedRef = useRef(false)
  unsavedRef.current = !readOnly && (draft !== (content ?? '') || saving)
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (unsavedRef.current) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 group/header">
        <span className="text-sm font-bold text-gray-500 flex-shrink-0">{num}.</span>
        {renaming ? (
          <input autoFocus value={titleDraft} onChange={e => setTitleDraft(e.target.value)}
            onBlur={commitRename} onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setTitleDraft(def.title); setRenaming(false) } }}
            className="flex-1 rounded-lg border border-blue-400 px-2 py-0.5 text-sm font-bold text-gray-800 dark:text-gray-100 outline-none" />
        ) : (
          <span className={cn('text-sm font-bold text-gray-800', !readOnly && 'cursor-pointer hover:text-blue-600 transition-colors')}
            onClick={() => !readOnly && setRenaming(true)} title="클릭하여 이름 변경">
            {def.title}
          </span>
        )}
        {saving && <span className="text-xs text-gray-500 ml-2">저장 중...</span>}
        {!saving && !failed && justSaved && <span className="text-xs text-green-600 ml-2">저장됨 ✓</span>}
        {!saving && failed && !readOnly && (
          <button onClick={() => void save(draft)} className="ml-2 text-xs font-medium text-red-500 hover:text-red-600 hover:underline">
            저장 안 됨 · 다시 저장
          </button>
        )}
        {!readOnly && !renaming && (
          <button onClick={() => onDelete(def.id)} aria-label={`${def.title} 일지 삭제`} title="삭제"
            className="ml-auto opacity-0 group-hover/header:opacity-100 flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-400 transition-all">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {readOnly
        ? <div className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap min-h-[60px]">{content || <span className="text-gray-300">—</span>}</div>
        : <textarea ref={taRef} value={draft}
            onChange={e => { setDraft(e.target.value); autoSize() }}
            onFocus={() => { focusedRef.current = true }}
            onBlur={handleBlur}
            placeholder={`${def.title} 입력...`}
            rows={1}
            className="w-full px-4 py-3 text-sm text-gray-700 dark:text-gray-300 placeholder-gray-300 resize-none outline-none overflow-hidden focus:ring-2 focus:ring-blue-400/20 focus:ring-inset min-h-[44px]" />
      }
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────
export default function BrokerDiaryPage() {
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()
  const auth = useAuth()

  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([])
  const [exEmployees, setExEmployees] = useState<Array<{ id: string; name: string }>>([])
  // 퇴사자 일지는 사건이 생겨야 본다(2026-11-05 사장님) — 일지를 열 때마다 받지 않고, 고르는 칸에서
  // '퇴사자 일지 보기…' 를 누를 때 한 번 받는다. null=아직 안 받음, 'loading'=받는 중
  const [exState, setExState] = useState<null | 'loading' | 'done'>(null)
  const [_teamMembers, setTeamMembers] = useState<string[]>([])
  const [viewingBrokerId, setViewingBrokerId] = useState<string | null>(null) // null = 자기 자신
  const [viewingExEmployee, setViewingExEmployee] = useState(false) // true면 archive에서 읽음
  const [canEdit] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loading, setLoading] = useState(true)

  // Section 1 데이터
  const [diaryCustomers, setDiaryCustomers] = useState<DiaryCustomerRow[]>([])
  const [addingId, setAddingId] = useState<string | null>(null)
  // 피커는 각자 서버 검색으로 필요한 만큼만 가져간다 (사무소 전건 프리로드 없음)
  const [pickerOfficeId, setPickerOfficeId] = useState<string | null>(null)
  // 이 날짜 일지가 참조하는 매물만 담는 맵 — 제안매물 칩 표시용
  const [propertyMap, setPropertyMap] = useState<Record<string, Property>>({})
  const [officeOwnerName, setOfficeOwnerName] = useState('')  // 중개사메모 열람 판정용 (매물목록과 같은 규칙)
  const [showPicker, setShowPicker] = useState(false)
  const [propertyPickerLinkId, setPropertyPickerLinkId] = useState<string | null>(null) // 매물 피커 대상
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null) // link_id
  const [sectionDeleteConfirm, setSectionDeleteConfirm] = useState<{ id: string; title: string } | null>(null) // 섹션 삭제 확인
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const wasDragRef = useRef(false)

  // Section 2-5 데이터
  const [sections, setSections] = useState<SectionDef[]>(DEFAULT_SECTIONS)
  const [sectionContent, setSectionContent] = useState<Record<string, string>>({})
  // 마지막으로 DB와 맞춰진(로드했거나 저장에 성공한) 섹션 구조 — 구조 저장이 실패하면 여기로 되돌린다
  const savedSectionsRef = useRef<SectionDef[]>(DEFAULT_SECTIONS)

  // 날짜
  const [diaryDate, setDiaryDate] = useState(() => todayKST())
  const [diaryLoading, setDiaryLoading] = useState(false)
  // 일지를 한 번이라도 다 불러왔는가 — 처음엔 diaryLoading 이 false 로 시작해, 불러오기 전에
  // '일지에 없는 고객' 조회가 한 번 헛돌았다(2026-11-05 폰 속도 점검)
  const [diaryReady, setDiaryReady] = useState(false)

  // 알림에서 ?date=YYYY-MM-DD&broker=BROKER_ID 로 진입 시 처리 (한 번만)
  const notifNavRef = useRef(false)
  useEffect(() => {
    if (notifNavRef.current) return
    const dateParam = searchParams.get('date')
    const brokerParam = searchParams.get('broker')
    if (!dateParam && !brokerParam) return
    if (!broker) return  // broker 로드 후에야 본인 매칭 가능
    notifNavRef.current = true
    // 진짜 있는 날짜만 받는다 — ?date=abc 면 'NaN/NaN/NaN' 일지가 열리고 저장하면 영문 DB 오류가 떴다(11-06 재점검)
    const d = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? new Date(dateParam + 'T00:00:00Z') : null
    if (d && !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateParam) setDiaryDate(dateParam!)
    if (brokerParam && isOwner && brokerParam !== broker.id) {
      // 대표가 직원 일지 알림 클릭 → 그 직원 일지 보기
      setViewingBrokerId(brokerParam)
      setViewingExEmployee(false)
    }
  }, [searchParams, broker, isOwner])

  // 칼럼 설정
  // 일지의 customCols·옵션도 viewing 대상의 col_settings 사용 (직원별 다른 칼럼 지원)
  // 퇴사자는 col_settings 없으므로 대표 본인 설정으로 fallback
  const settingsBrokerId = viewingExEmployee ? (broker?.id ?? null) : (viewingBrokerId ?? broker?.id ?? null)
  const { settings, update, loaded } = useColSettings('diary_cust', settingsBrokerId, DEFAULT_COL_SETTINGS)
  // 유입 선택지는 사무실 공통 — 대표만 머리글에서 고친다(use-office-sources.ts)
  const { sourceOptions, saveSourceOptions } = useOfficeSources(broker ? (broker.is_owner !== false ? broker.id : (broker.parent_broker_id ?? broker.id)) : null, isOwner)
  const { direction, updateDirection } = useSheetDirection(broker?.id ?? null, 'diary')
  const toast = useToast()

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id])
  useEffect(() => { if (broker) loadDiaryData(diaryDate) }, [diaryDate, broker?.id, viewingBrokerId, viewingExEmployee])

  // 제안매물 칩에 필요한 매물만 조회 — 사무소 전건 대신 이 날짜가 실제로 참조하는 것만.
  // 이미 맵에 있는 id는 건너뛰므로 날짜를 오가도 중복 조회되지 않는다.
  useEffect(() => {
    const needed = Array.from(new Set(diaryCustomers.flatMap(c => c.proposed_property_ids ?? [])))
      .filter(id => id && !propertyMap[id])
    if (needed.length === 0) return
    let alive = true
    supabase.from('broker_properties').select(PROP_CHIP_COLS).in('id', needed)
      .then(({ data }) => {
        if (!alive || !data) return
        setPropertyMap(prev => {
          const next = { ...prev }
          for (const p of data as Property[]) next[p.id] = p
          return next
        })
      })
    return () => { alive = false }
    // propertyMap은 갱신 대상이라 의존성에서 제외 (넣으면 매 갱신마다 재실행)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diaryCustomers])

  const init = async () => {
    const u = auth.user!
    const b = auth.broker!
    const prof = auth.profile
    const owner = b.is_owner !== false
    try {
      await initEssential(u, b, prof, owner)
    } catch (e) {
      // 여기서 막히면 "불러오는 중..."에서 영영 멈추므로 반드시 화면은 띄운다
      console.error('[diary] init 실패:', e)
    } finally {
      setLoading(false)
    }
  }

  // 화면 표시에 꼭 필요한 것만 — 끝나는 즉시 일지가 렌더된다
  const initEssential = async (u: any, b: any, prof: any, owner: boolean) => {
    setUser(u)
    setProfile(prof); setBroker(b)
    // isOwner = 대표 권한(대표·이사). 사무소 id 는 owner(대표 본인 여부)로 따로 구한다
    const manager = canManageOffice(b)
    setIsOwner(manager)
    if (!owner) {
      if (b.is_approved === false) { setAccessDenied(true); return }
    }
    const officeId: string = owner ? b.id : (b.parent_broker_id ?? b.id)

    // 피커가 검색할 대상 범위(사무소) — office_broker_id 하나면 되므로 멤버 목록 조립이 필요 없다
    setPickerOfficeId(officeId)

    // 직원: 대표 이름 — 담당자에 대표가 걸린 매물은 중개사메모를 직원도 본다(매물목록과 동일)
    if (owner) setOfficeOwnerName(prof?.name ?? '')
    else if (b.parent_broker_id) void getOfficeMembers(b.parent_broker_id).then(
      ms => setOfficeOwnerName(ms.find(m => m.isOwner)?.name ?? ''), () => {})

    // 대표: 직원 목록 — 일지 고르는 칸에만 쓰이니 화면을 기다리게 하지 않는다.
    // 기다리면 직원 → 퇴사자(1,000행 넘어 두 번) 왕복이 줄을 서, 폰 느린 회선에서 일지·광고현황이
    // 약 6초 늦게 떴다(2026-10-29 점검).
    // 이사도 같다 — 이사는 대표 + 다른 직원(자기 빼고) 일지를 고른다
    if (manager) void (async () => {
      // 사무소 사람 목록은 화면끼리 같이 쓴다(office-members)
      const emps = await getOfficeMembers(officeId).catch(() => null)
      if (emps) {
        const empList = emps.filter(e => e.approved && e.id !== b.id).map(e => ({ id: e.id, name: e.name ?? '직원' }))
        setEmployees(empList)
        setTeamMembers([prof?.name, ...empList.map(e => e.name)].filter(Boolean) as string[])
      } else {
        setTeamMembers(prof?.name ? [prof.name] : [])
      }
      // 퇴사자 목록은 여기서 받지 않는다 — 고르는 칸에서 '퇴사자 일지 보기…' 를 누를 때만(loadExEmployees).
    })()
    else setTeamMembers(prof?.name ? [prof.name] : [])
  }

  const loadExEmployees = async () => {
    if (!pickerOfficeId || exState) return
    setExState('loading')
    try {
      // 겹치지 않는 사람만 한 번에(office_archive_authors)
      const { data: authors, error: authErr } = await supabase.rpc('office_archive_authors', { p_office: pickerOfficeId })
      if (!authErr && authors) {
        setExEmployees((authors as { author_broker_id: string; author_name: string | null }[])
          .map(a => ({ id: a.author_broker_id, name: a.author_name ?? '퇴사자' })))
      } else {
        // 함수가 없으면 예전처럼 두 보관 표를 이어 받아 겹친 것을 거른다.
        // customer archive는 1,000행을 넘었다 — PostgREST는 1,000행에서 조용히 자르므로 페이지를 이어 받는다.
        const [archAuthors1, archAuthors2] = await Promise.all([
          fetchAllPaged((from, to) => supabase.from('broker_diary_archive')
            .select('author_broker_id, author_name').eq('office_broker_id', pickerOfficeId).order('id').range(from, to)),
          fetchAllPaged((from, to) => supabase.from('broker_diary_customers_archive')
            .select('author_broker_id, author_name').eq('office_broker_id', pickerOfficeId).order('id').range(from, to)),
        ])
        const seen = new Set<string>()
        const exList: Array<{ id: string; name: string }> = []
        for (const a of [...archAuthors1, ...archAuthors2] as { author_broker_id: string | null; author_name: string | null }[]) {
          if (a.author_broker_id && !seen.has(a.author_broker_id)) {
            seen.add(a.author_broker_id)
            exList.push({ id: a.author_broker_id, name: a.author_name ?? '퇴사자' })
          }
        }
        setExEmployees(exList)
      }
      setExState('done')
    } catch (e) {
      console.error('[diary] 퇴사자 목록 로드 실패:', e)
      setExState(null) // 다시 누르면 또 받는다
    }
  }

  // 날짜를 빠르게 넘기면 늦게 도착한 이전 응답이 최신 화면을 덮어쓰므로 요청 순번으로 차단
  const diaryReqRef = useRef(0)

  const loadDiaryData = async (date: string) => {
    if (!broker) return
    const req = ++diaryReqRef.current
    setDiaryLoading(true)
    try {
      await loadDiaryInner(date, req)
    } catch (e) {
      // 실패해도 로딩 표시는 반드시 걷는다
      console.error('[diary] 일지 로드 실패:', e)
    } finally {
      if (req === diaryReqRef.current) { setDiaryLoading(false); setDiaryReady(true) }
    }
  }

  const loadDiaryInner = async (date: string, req: number) => {
    if (!broker) return
    const stale = () => req !== diaryReqRef.current
    // 아직 끝나지 않은 일지 저장이 있으면 끝난 뒤에 읽는다 — 날짜를 넘겼다 바로 돌아오면
    // 저장보다 읽기가 먼저 끝나 방금 쓴 글이 빠진 채로 보이고, 그걸 고치면 그대로 덮인다.
    // 저장 줄을 기다리되 끝없이는 아니다. 폰에서 요청 하나가 멈추면 날짜를 바꿔도 영영
    // '불러오는 중' 이었다.
    await Promise.race([saveChainRef.current, new Promise(r => setTimeout(r, 8000))])
    if (stale()) return

    // 퇴사자 archive 모드 — 사무소 archive 테이블에서 읽기 전용 로드
    if (viewingExEmployee && viewingBrokerId) {
      const [{ data: archLinks }, { data: archDiary }] = await Promise.all([
        supabase.from('broker_diary_customers_archive')
          .select('id, sort_order, proposed_property_ids, customer_id, customer_name, customer_contact')
          .eq('office_broker_id', broker.id)
          .eq('author_broker_id', viewingBrokerId)
          .eq('diary_date', date)
          .order('sort_order'),
        supabase.from('broker_diary_archive')
          .select('sections, sections_content, work_summary, ad_status, suggestions, delivery_notes')
          .eq('office_broker_id', broker.id)
          .eq('author_broker_id', viewingBrokerId)
          .eq('date', date)
          .maybeSingle(),
      ])
      // archive 테이블은 이름·연락처만 저장한다(요청사항·진행상황 등은 없음).
      // 부소장 고객은 대부분 이름을 비우고 요청사항에 핵심을 적으므로, archive만
      // 읽으면 연락처만 남아 "고객정보가 사라진" 것처럼 보인다. 원본 고객이
      // 아직 살아있으면(퇴사자 고객이 대표에게 이관돼 대개 살아있다) 원본에서
      // 요청사항·진행상황 등을 채워 넣는다. 원본이 없을 때만 archive 스냅샷 사용.
      const custIds = Array.from(new Set((archLinks ?? []).map((l: any) => l.customer_id).filter(Boolean)))
      const liveMap: Record<string, any> = {}
      if (custIds.length > 0) {
        const { data: liveCusts } = await supabase.from('broker_customers')
          .select('id, client_name, contact, received_date, assignee, category, source, status, request, interest, consult_note, custom_fields')
          .in('id', custIds)
        for (const c of liveCusts ?? []) liveMap[(c as any).id] = c
      }
      if (stale()) return
      setDiaryCustomers((archLinks ?? []).map((l: any) => {
        const live = l.customer_id ? liveMap[l.customer_id] : null
        if (live) return {
          link_id: l.id, sort_order: l.sort_order,
          proposed_property_ids: l.proposed_property_ids ?? [],
          id: live.id, client_name: live.client_name ?? '', contact: live.contact ?? null,
          received_date: live.received_date, assignee: live.assignee, category: live.category ?? '',
          source: live.source, status: live.status ?? '', request: live.request,
          interest: live.interest, consult_note: live.consult_note, custom_fields: live.custom_fields,
        }
        // 원본이 없으면(정말 삭제된 고객) archive 스냅샷의 이름·연락처만 남는다
        return {
          link_id: l.id, sort_order: l.sort_order,
          proposed_property_ids: l.proposed_property_ids ?? [],
          id: l.customer_id ?? l.id,
          client_name: l.customer_name ?? '', contact: l.customer_contact ?? null,
          received_date: null, assignee: null, category: '', source: null,
          status: '', request: null, custom_fields: null,
        }
      }))
      // sections_content 우선, 없으면 레거시 4개 컬럼을 기본 섹션 키로 매핑
      let content: Record<string, string> = (archDiary?.sections_content as any) ?? {}
      if (Object.keys(content).length === 0 && archDiary) {
        const fallback: Record<string, string> = {}
        if ((archDiary as any).work_summary) fallback['s_work'] = (archDiary as any).work_summary
        if ((archDiary as any).ad_status) fallback['s_ad'] = (archDiary as any).ad_status
        if ((archDiary as any).suggestions) fallback['s_suggest'] = (archDiary as any).suggestions
        if ((archDiary as any).delivery_notes) fallback['s_delivery'] = (archDiary as any).delivery_notes
        content = fallback
      }
      setSectionContent(content)
      // 퇴사자는 전역 섹션 정의가 없으므로 기본값 기준으로 복원
      const archSections = resolveSections((archDiary as any)?.sections, DEFAULT_SECTIONS, content, date)
      setSections(archSections)
      savedSectionsRef.current = archSections
      return
    }

    const targetId = viewingBrokerId ?? broker.id
    // 이 대상의 레거시 전역 섹션 — 날짜별 섹션이 아직 없을 때 fallback 기준
    let legacySections: any = null
    if (targetId === broker.id) legacySections = (broker.col_settings as any)?.diary_sections?.sections
    else {
      const { data: prof } = await supabase.from('broker_profiles').select('col_settings').eq('id', targetId).maybeSingle()
      legacySections = (prof?.col_settings as any)?.diary_sections?.sections
    }
    // 일반 조인 대신 RPC를 쓰는 이유: broker_customers RLS가 deleted_at IS NULL을
    // 요구해서, 고객을 휴지통에 보내면 과거 일지에서까지 사라졌다. 일지는 그날의
    // 기록이므로 삭제된 고객도 그대로 남아야 한다(is_deleted로 구분해서 받는다).
    const [{ data: links, error: linkErr }, { data: diaryRow }] = await Promise.all([
      supabase.rpc('diary_customers_for_date', { p_broker_id: targetId, p_date: date }),
      supabase.from('broker_diary').select('sections, sections_content').eq('broker_id', targetId).eq('date', date).maybeSingle(),
    ])
    if (linkErr) throw linkErr
    if (stale()) return
    setDiaryCustomers((links ?? []).map(toDiaryRow))
    const content = (diaryRow?.sections_content as any) ?? {}
    setSectionContent(content)
    const loadedSections = resolveSections((diaryRow as any)?.sections, legacySections, content, date)
    setSections(loadedSections)
    savedSectionsRef.current = loadedSections
  }

  // 고객 피커: 기존 고객 추가 (direction에 따라 위/아래)
  const addExistingCustomer = async (c: Customer) => {
    if (!broker) return
    const targetBrokerId = viewingBrokerId ?? broker.id  // 직원 일지 보는 중이면 그 직원 일지에 저장
    const orders = diaryCustomers.map(d => d.sort_order)
    const nextOrder = direction === 'up'
      ? (orders.length > 0 ? Math.min(...orders) - 1 : 0)
      : (orders.length > 0 ? Math.max(...orders) + 1 : 0)
    const { data, error } = await supabase.from('broker_diary_customers').insert({ broker_id: targetBrokerId, diary_date: diaryDate, customer_id: c.id, sort_order: nextOrder }).select('id').single()
    if (!error && data) {
      setDiaryCustomers(prev => direction === 'up'
        ? [{ link_id: data.id, sort_order: nextOrder, proposed_property_ids: [], ...c }, ...prev]
        : [...prev, { link_id: data.id, sort_order: nextOrder, proposed_property_ids: [], ...c }])
      setAddingId(c.id)
      setTimeout(() => setAddingId(null), 3000)
    }
    setShowPicker(false)
  }

  // 고객 피커: 새 고객 만들기 (구분/진행상황 빈 값으로 생성, 위로 쌓이게)
  const createAndAddCustomer = async () => {
    if (!broker) return
    setShowPicker(false)
    const targetBrokerId = viewingBrokerId ?? broker.id  // 직원 일지 보는 중이면 그 직원 소유로 생성
    const { data: newCust, error: ce } = await supabase.from('broker_customers').insert({
      broker_id: targetBrokerId, client_name: '', request: '', contact: null,
      received_date: null, assignee: viewingName || null, source: null,  // 담당자도 보고 있는 대상
      category: '', status: '',
    }).select().single()
    if (ce || !newCust) return
    const orders = diaryCustomers.map(d => d.sort_order)
    const nextOrder = direction === 'up'
      ? (orders.length > 0 ? Math.min(...orders) - 1 : 0)
      : (orders.length > 0 ? Math.max(...orders) + 1 : 0)
    const { data: link } = await supabase.from('broker_diary_customers').insert({ broker_id: targetBrokerId, diary_date: diaryDate, customer_id: newCust.id, sort_order: nextOrder }).select('id').single()
    if (link) {
      setDiaryCustomers(prev => direction === 'up'
        ? [{ link_id: link.id, sort_order: nextOrder, proposed_property_ids: [], ...newCust as Customer }, ...prev]
        : [...prev, { link_id: link.id, sort_order: nextOrder, proposed_property_ids: [], ...newCust as Customer }])
      setAddingId(newCust.id)
      setTimeout(() => setAddingId(null), 3000)
    }
  }

  // 고객 행 삭제 (diary_customers 링크만 제거)
  // 실패(오프라인·RLS)를 무시하고 행을 지우면 화면에선 빠졌는데 새로고침하면 다시 나온다.
  // 지워진 게 확인될 때만 화면에서 뺀다.
  const unlinkCustomer = async (linkId: string) => {
    setDeleteConfirm(null)
    const { data, error } = await supabase.from('broker_diary_customers').delete().eq('id', linkId).select('id')
    if (error || !data?.length) {
      console.error('[diary unlinkCustomer] failed', error)
      toast.error(`제거 실패: ${error?.message ?? NO_ROW_MSG}`)
      return
    }
    setDiaryCustomers(prev => prev.filter(c => c.link_id !== linkId))
  }

  // 일지 행 복사 — 원본 고객 필드를 복제한 새 고객을 생성하고 같은 일지에 link 추가
  const duplicateDiaryCustomer = async (row: any) => {
    if (!broker) return
    const targetBrokerId = viewingBrokerId ?? broker.id
    // is_deleted는 RPC가 붙여 주는 표시용 값이라 broker_customers 컬럼이 아니다 — 같이 넣으면 insert가 깨진다
    const { link_id: _lid, sort_order: _so, proposed_property_ids: _ppi, id: _id, created_at: _ca, updated_at: _ua, is_deleted: _del, ...rest } = row
    const { data: newCust, error: ce } = await supabase.from('broker_customers').insert({ ...rest, broker_id: targetBrokerId }).select().single()
    if (ce || !newCust) return
    const orders = diaryCustomers.map(d => d.sort_order)
    const nextOrder = direction === 'up'
      ? (orders.length > 0 ? Math.min(...orders) - 1 : 0)
      : (orders.length > 0 ? Math.max(...orders) + 1 : 0)
    const { data: link } = await supabase.from('broker_diary_customers').insert({ broker_id: targetBrokerId, diary_date: diaryDate, customer_id: newCust.id, sort_order: nextOrder }).select('id').single()
    if (link) {
      setDiaryCustomers(prev => direction === 'up'
        ? [{ link_id: link.id, sort_order: nextOrder, proposed_property_ids: [], ...newCust as Customer }, ...prev]
        : [...prev, { link_id: link.id, sort_order: nextOrder, proposed_property_ids: [], ...newCust as Customer }])
      setAddingId(newCust.id)
      setTimeout(() => setAddingId(null), 3000)
    }
  }

  // 새 행 추가 시: 스크롤 + 첫 셀 클릭 (일지는 페이지네이션 없음)
  useEffect(() => {
    if (!addingId) return
    const t = setTimeout(() => {
      const row = document.querySelector(`tr[data-row-id="${addingId}"]`) as HTMLElement | null
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setTimeout(() => {
          const cells = row.querySelectorAll('td')
          for (let i = 1; i < cells.length - 1; i++) {
            const clickable = cells[i].querySelector('div[class*="cursor"], button:not([disabled])') as HTMLElement | null
            if (clickable) { clickable.click(); break }
          }
        }, 400)
      }
    }, 80)
    return () => clearTimeout(t)
  }, [addingId])

  // 고객 필드 수정 (broker_customers 업데이트)
  // 저장 실패(RLS 거부·오프라인·네트워크 단절)를 무시하면 화면에는 저장된 것처럼
  // 보이고 DB엔 안 들어가, 새로고침해야 유실을 안다. 고객관리·매물 시트가 쓰는
  // "실패 시 이전 값으로 되돌리고 알린다" 패턴을 일지에도 맞춘다.
  const saveCustomerField = useCallback(async (customerId: string, field: string, value: any) => {
    // 되돌릴 값은 updater 밖에서 읽는다 — updater 는 나중에(두 번) 돌 수 있어, 안에서 채우면
    // 실패했을 때 칸이 옛 값이 아니라 빈칸으로 돌아갔다
    const prevValue = (diaryCustomers.find(c => c.id === customerId) as any)?.[field]
    setDiaryCustomers(prev => prev.map(c => c.id === customerId ? { ...c, [field]: value } : c))
    // 0행도 실패다 — 그새 휴지통에 갔거나 권한이 막히면 오류 없이 0행으로 끝난다
    const { data, error } = await supabase.from('broker_customers').update({ [field]: value }).eq('id', customerId).select('id')
    if (error || !data?.length) {
      console.error('[diary saveCustomerField] failed', error)
      setDiaryCustomers(prev => prev.map(c => c.id === customerId ? { ...c, [field]: prevValue } : c))
      toast.error(`저장 실패: ${error?.message ?? NO_ROW_MSG}`)
    }
    // 피커는 열 때마다 서버에서 다시 검색하므로 별도 로컬 캐시 동기화가 필요 없다
  }, [toast, diaryCustomers])

  const saveCustomField = useCallback(async (customerId: string, colId: string, value: string) => {
    const row = diaryCustomers.find(c => c.id === customerId)
    const prevFields = row?.custom_fields ?? null
    const newFields = { ...(row?.custom_fields ?? {}), [colId]: value }
    setDiaryCustomers(prev => prev.map(c => c.id === customerId ? { ...c, custom_fields: newFields } : c))
    const { data, error } = await supabase.from('broker_customers').update({ custom_fields: newFields }).eq('id', customerId).select('id')
    if (error || !data?.length) {
      console.error('[diary saveCustomField] failed', error)
      setDiaryCustomers(prev => prev.map(c => c.id === customerId ? { ...c, custom_fields: prevFields } : c))
      toast.error(`저장 실패: ${error?.message ?? NO_ROW_MSG}`)
    }
  }, [diaryCustomers, toast])

  // 제안 매물 저장
  const saveProposedProperties = async (linkId: string, ids: string[]) => {
    const prevIds = diaryCustomers.find(c => c.link_id === linkId)?.proposed_property_ids ?? []
    setDiaryCustomers(prev => prev.map(c => c.link_id === linkId ? { ...c, proposed_property_ids: ids } : c))
    setPropertyPickerLinkId(null)
    const { data, error } = await supabase.from('broker_diary_customers').update({ proposed_property_ids: ids }).eq('id', linkId).select('id')
    if (error || !data?.length) {
      console.error('[diary saveProposedProperties] failed', error)
      setDiaryCustomers(prev => prev.map(c => c.link_id === linkId ? { ...c, proposed_property_ids: prevIds } : c))
      toast.error(`제안매물 저장 실패: ${error?.message ?? NO_ROW_MSG}`)
    }
  }

  // ── 일지 본문·섹션 구조 저장 ─────────────────────────
  // 본문(sections_content)과 구조(sections)는 그날 일지 행 하나에 같이 들어간다. 예전엔
  //  ① 화면이 들고 있던 sectionContent 전체로 덮어써서, A 저장(조회→수정 두 번 왕복)이
  //    끝나기 전에 B를 blur하면 B의 payload에 A의 새 값이 없어 DB에서 A가 사라졌고,
  //  ② 그날 첫 저장 두 건이 겹치면 둘 다 행이 없다고 보고 insert해 두 번째가
  //    UNIQUE(broker_id,date)에 막혀 조용히 사라졌고,
  //  ③ 오류를 안 봐서 폰에서 망이 끊기면 저장된 것처럼 보이고 실제로는 유실됐다.
  // 그래서 이 행에 대한 쓰기는 모두 한 줄로 세우고(앞의 첫 insert가 끝나야 다음이 돈다),
  // 매번 DB에서 방금 읽은 내용에 바꿀 섹션 키만 넣어 쓰며, 실패는 알린다.
  // 이렇게 하면 다른 기기에서 고친 다른 섹션도 지우지 않는다.
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const enqueueSave = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = saveChainRef.current.then(job)
    saveChainRef.current = run.catch(() => {})
    return run
  }
  // 같은 칸 저장이 줄에 또 서면 아직 안 돈 앞 것은 건너뛴다 — 마지막 값만 쓰면 된다
  const saveSeqRef = useRef(0)
  const latestSaveRef = useRef<Record<string, number>>({})
  const claimLatest = (key: string) => {
    const seq = ++saveSeqRef.current
    latestSaveRef.current[key] = seq
    return () => latestSaveRef.current[key] !== seq  // true면 더 새 저장이 있다
  }

  // 지금 보고 있는 일지 — 저장은 비동기로 끝나므로 부를 때 대상을 잡아 둔다.
  // req는 그때의 로드 순번: 끝났을 때 날짜·대상을 바꿨으면 화면 상태는 건드리지 않는다.
  const currentTarget = (): DiaryTarget | null => {
    if (!broker) return null
    const archive = viewingExEmployee && !!viewingBrokerId
    const brokerId = viewingBrokerId ?? broker.id
    return {
      archive, officeId: broker.id, brokerId, date: diaryDate, req: diaryReqRef.current,
      key: `${archive ? 'ex' : 'live'}|${brokerId}|${diaryDate}`,
    }
  }

  // archive 행을 새로 만들 때 남길 작성자 이름
  const archiveAuthorName = async (authorId: string): Promise<string | null> => {
    const { data: prof } = await supabase.from('broker_profiles').select('user_id').eq('id', authorId).maybeSingle()
    const { data: nameRow } = prof?.user_id
      ? await supabase.from('profiles').select('name').eq('id', prof.user_id).maybeSingle()
      : { data: null }
    return (nameRow as any)?.name ?? null
  }

  // 그날 일지 행(퇴사자면 사무소 archive 행)을 DB에서 읽어 patch를 적용한다. 없으면 만든다.
  // 반드시 enqueueSave 안에서 부를 것. patch는 방금 읽은 sections_content를 받아 바꿀 컬럼만 돌려준다.
  const writeDiaryRow = async (
    t: DiaryTarget,
    patch: (cur: Record<string, string>) => Record<string, unknown>,
    insertExtra: Record<string, unknown> = {},
  ): Promise<{ created: boolean; before: Record<string, string> }> => {
    if (t.archive) {
      const { data: row, error } = await supabase.from('broker_diary_archive').select('id, sections_content')
        .eq('office_broker_id', t.officeId).eq('author_broker_id', t.brokerId).eq('date', t.date).maybeSingle()
      if (error) throw error
      const before = (row?.sections_content ?? {}) as Record<string, string>
      if (row) {
        const { data, error: ue } = await supabase.from('broker_diary_archive').update(patch(before)).eq('id', row.id).select('id')
        if (ue) throw ue
        if (!data?.length) throw new Error(NO_ROW_MSG)
      } else {
        // archive엔 (사무소·작성자·날짜) 유일 제약이 없다 — 위의 줄 세우기가 중복 insert를 막는다
        const { error: ie } = await supabase.from('broker_diary_archive').insert({
          office_broker_id: t.officeId, author_broker_id: t.brokerId,
          author_name: await archiveAuthorName(t.brokerId), date: t.date,
          ...insertExtra, ...patch(before),
        })
        if (ie) throw ie
      }
      return { created: !row, before }
    }
    // 다른 기기가 같은 순간 그날 첫 행을 만들면 insert가 UNIQUE에 걸린다 → 한 번 더 읽어 update로
    for (let attempt = 0; ; attempt++) {
      const { data: row, error } = await supabase.from('broker_diary').select('id, sections_content')
        .eq('broker_id', t.brokerId).eq('date', t.date).maybeSingle()
      if (error) throw error
      const before = (row?.sections_content ?? {}) as Record<string, string>
      const updated_at = new Date().toISOString()
      if (row) {
        const { data, error: ue } = await supabase.from('broker_diary').update({ ...patch(before), updated_at }).eq('id', row.id).select('id')
        if (ue) throw ue
        if (!data?.length) throw new Error(NO_ROW_MSG)
        return { created: false, before }
      }
      const { error: ie } = await supabase.from('broker_diary')
        .insert({ broker_id: t.brokerId, date: t.date, ...insertExtra, ...patch(before), updated_at })
      if (!ie) return { created: true, before }
      if (ie.code !== '23505' || attempt > 0) throw ie
    }
  }

  // 섹션 내용 저장 — viewing 대상의 broker_id에 저장 (사장님이 직원 일지 편집 가능하도록)
  // 퇴사자 archive 모드면 broker_diary_archive에 저장 (대표 권한 필요)
  // 저장됐으면 true. 실패하면 sectionContent는 그대로 둬서 쓴 글이 칸에 남고, 다시 저장할 수 있다.
  const saveSectionContent = async (sectionId: string, value: string): Promise<boolean> => {
    const t = currentTarget()
    if (!t) return false
    const superseded = claimLatest(`${t.key}|c|${sectionId}`)
    const structure = sections  // 그날 첫 행이면 지금 섹션 구조를 함께 기록해 이 날짜에 고정
    try {
      const res = await enqueueSave(async () => {
        if (superseded()) return null
        return writeDiaryRow(t, cur => {
          const next = { ...cur }
          if (value) next[sectionId] = value
          else delete next[sectionId]
          return { sections_content: next }
        }, { sections: structure })
      })
      if (!res) return true  // 뒤에 같은 칸 저장이 있어 그쪽이 마지막 값을 썼다
      // 그날 첫 내용이면 대표에게 알림 — 섹션 추가 등으로 빈 행이 먼저 생긴 경우도 포함 (이후 수정은 알림 없음)
      if (!t.archive && value && (res.created || Object.keys(res.before).length === 0)) {
        notifyOwnerOfBrokerAction(t.brokerId, 'diary', `/broker/diary?date=${t.date}&broker=${t.brokerId}`)
      }
      // 같은 칸의 더 새 저장이 줄 서 있으면 화면을 이 값으로 되돌리지 않는다 — 되돌리면 이어 쓴 글이
      // 화면에서 사라지고, 다음 저장이 그 옛 값을 덮어써 조용히 잃었다.
      if (t.req === diaryReqRef.current && !superseded()) setSectionContent(prev => ({ ...prev, [sectionId]: value || '' }))
      return true
    } catch (e: any) {
      console.error('[diary saveSectionContent] failed', e)
      toast.error(`일지 저장 실패: ${e?.message ?? '다시 시도해 주세요'}`)
      return false
    }
  }

  // 섹션 이름 변경
  const renameSection = (id: string, title: string) => {
    const newSections = sections.map(s => s.id === id ? { ...s, title } : s)
    setSections(newSections)
    persistSections(newSections)
  }

  // 섹션 삭제 (이 날짜에서만 제거 — 다른 날짜는 영향 없음, 작성된 내용은 DB에 보존)
  const deleteSection = (id: string) => {
    const newSections = sections.filter(s => s.id !== id)
    setSections(newSections)
    persistSections(newSections)
  }

  // 섹션 추가 (이 날짜에서만)
  const addSection = () => {
    const id = `s_${Date.now()}`
    const newSections = [...sections, { id, title: '새 섹션' }]
    setSections(newSections)
    persistSections(newSections)
  }

  // 섹션 구조 저장 — 날짜별 (viewing 대상의 그날 일지 행에 저장)
  // 퇴사자 archive 모드면 archive 행에 저장 (대표만). 행이 없으면 새로 만든다.
  // 본문 저장과 같은 줄에 선다 — 섹션을 추가하자마자 본문을 쓰면 첫 insert가 겹치기 때문.
  // 실패하면 조용히 넘기지 않고, 마지막으로 맞춰진 구조로 되돌린 뒤 알린다.
  const persistSections = async (newSections: SectionDef[]) => {
    const t = currentTarget()
    if (!t) return
    const superseded = claimLatest(`${t.key}|s`)
    try {
      const res = await enqueueSave(async () => {
        if (superseded()) return null  // 더 새 구조가 줄 서 있다
        return writeDiaryRow(t, () => ({ sections: newSections }))
      })
      if (res && t.req === diaryReqRef.current) savedSectionsRef.current = newSections
    } catch (e: any) {
      console.error('[diary persistSections] failed', e)
      toast.error(`섹션 저장 실패: ${e?.message ?? '다시 시도해 주세요'}`)
      if (!superseded() && t.req === diaryReqRef.current) setSections(savedSectionsRef.current)
    }
  }

  // 칼럼 설정 헬퍼
  const showCol = (key: string) => update(prev => ({ ...prev, visible: [...prev.visible, key] }))
  const hideCol = (key: string) => update(prev => ({ ...prev, visible: prev.visible.filter(k => k !== key) }))
  const setOpts = (key: string, opts: string[]) => update(prev => ({ ...prev, options: { ...prev.options, [key]: opts } }))
  const setMulti = (key: string, multi: boolean) => update(prev => ({ ...prev, multi: { ...prev.multi, [key]: multi } }))
  const addCustomCol = (name: string, type: 'text' | 'select' = 'text') => {
    const id = `custom_${Date.now()}`
    update(prev => ({ ...prev, customCols: [...prev.customCols, { id, name, type }], order: [...prev.order, id], visible: [...prev.visible, id], widths: { ...prev.widths, [id]: 120 }, options: type === 'select' ? { ...prev.options, [id]: [] } : prev.options }))
  }
  const renameCustomCol = (id: string, name: string) => update(prev => ({ ...prev, customCols: prev.customCols.map(c => c.id === id ? { ...c, name } : c) }))
  const changeCustomColType = (id: string, type: 'text' | 'select') => update(prev => ({ ...prev, customCols: prev.customCols.map(c => c.id === id ? { ...c, type } : c), options: type === 'select' && !prev.options[id] ? { ...prev.options, [id]: [] } : prev.options }))
  const deleteCustomCol = (id: string) => update(prev => ({ ...prev, customCols: prev.customCols.filter(c => c.id !== id), order: prev.order.filter(k => k !== id), visible: prev.visible.filter(k => k !== id) }))
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX; const startW = settings.widths[key] ?? 100
    const onMove = (ev: MouseEvent) => update(prev => ({ ...prev, widths: { ...prev.widths, [key]: Math.max(50, startW + ev.clientX - startX) } }))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }
  const onColDragStart = (key: string, e: React.DragEvent) => { wasDragRef.current = true; setDragCol(key); e.dataTransfer.effectAllowed = 'move' }
  const onColDragOver = (key: string, e: React.DragEvent) => { e.preventDefault(); setDragOverCol(key) }
  const onColDrop = (key: string) => {
    if (!dragCol || dragCol === key) return
    update(prev => { const arr = [...prev.order]; const fi = arr.indexOf(dragCol); const ti = arr.indexOf(key); if (fi < 0 || ti < 0) return prev; arr.splice(fi, 1); arr.splice(ti, 0, dragCol); return { ...prev, order: arr } })
    setDragCol(null); setDragOverCol(null)
  }
  const onColDragEnd = () => { setDragCol(null); setDragOverCol(null); setTimeout(() => { wasDragRef.current = false }, 50) }

  // 불러오기
  const [showImport, setShowImport] = useState(false)
  const [importDate, setImportDate] = useState('')
  const importDateId = useId()
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importNotice, setImportNotice] = useState<string | null>(null)  // 건너뛴 행 안내 (실패는 아님)

  // 불러오기를 열면 이 날짜 전에 마지막으로 쓴 일지 날짜를 기본으로 채운다(2026-11-03 사장님).
  // 본문만 있는 날도, 고객만 있는 날도 있어 두 표를 다 보고 늦은 쪽을 고른다.
  // 섹션 구조만 저장됐거나 글을 다 지운 빈 행도 남아 있어서, 행이 있다고 고르면 빈 날로 덮어쓰게 된다 — 글이 있는 행만 센다.
  const openImport = async () => {
    setImportDate(''); setShowImport(true)
    if (!broker) return
    const targetBrokerId = viewingBrokerId ?? broker.id
    const [{ data: ds }, { data: c }] = await Promise.all([
      supabase.from('broker_diary').select('date, sections_content').eq('broker_id', targetBrokerId).lt('date', diaryDate).order('date', { ascending: false }).limit(60),
      supabase.from('broker_diary_customers').select('diary_date').eq('broker_id', targetBrokerId).lt('diary_date', diaryDate).order('diary_date', { ascending: false }).limit(1).maybeSingle(),
    ])
    const written = (ds ?? []).find(r => Object.values((r.sections_content as Record<string, string>) ?? {}).some(v => typeof v === 'string' && v.trim()))
    const last = [written?.date, c?.diary_date].filter(Boolean).sort().pop()
    // 기다리는 사이 직접 고른 날짜는 덮지 않는다
    if (last) setImportDate(prev => prev || last)
  }

  const importFromDate = async () => {
    if (!broker || !importDate) return
    setImporting(true)
    setImportError(null)
    setImportNotice(null)
    const targetBrokerId = viewingBrokerId ?? broker.id  // 직원 일지 보는 중이면 그 직원 일지로 불러오기
    try {
      // 1) 원본을 먼저 읽는다 — 여기서 실패하면 현재 일지는 손도 대지 않는다
      const [{ data: sourceLinks, error: srcLinkErr }, { data: sourceDiary, error: srcDiaryErr }] = await Promise.all([
        supabase.rpc('diary_customers_for_date', { p_broker_id: targetBrokerId, p_date: importDate }),
        supabase.from('broker_diary').select('sections, sections_content').eq('broker_id', targetBrokerId).eq('date', importDate).maybeSingle(),
      ])
      if (srcLinkErr) throw srcLinkErr
      if (srcDiaryErr) throw srcDiaryErr
      // 빈 날을 불러오면 지금 일지만 조용히 지워진다 — 덮기 전에 막는다
      const srcHasText = Object.values((sourceDiary?.sections_content as Record<string, string>) ?? {}).some(v => typeof v === 'string' && v.trim())
      if (!(sourceLinks ?? []).some((l: any) => !l.is_deleted) && !srcHasText) {
        setImportError('그날 일지는 비어 있어요. 다른 날짜를 골라 주세요.')
        return
      }

      // 2) 현재 날짜 고객 링크 삭제 후 재삽입
      const { error: delErr } = await supabase.from('broker_diary_customers')
        .delete().eq('broker_id', targetBrokerId).eq('diary_date', diaryDate)
      if (delErr) throw delErr

      // 휴지통에 있는 고객은 새 일지로 가져오지 않는다. 과거 일지에는 기록으로 남지만,
      // 불러오기는 "오늘 일지를 새로 만드는" 동작이라 정리한 고객이 되살아나면 안 된다.
      const liveLinks = (sourceLinks ?? []).filter((l: any) => !l.is_deleted)
      if (liveLinks.length > 0) {
        const inserts = liveLinks.map((l: any, idx: number) => ({
          broker_id: targetBrokerId, diary_date: diaryDate,
          customer_id: l.id, sort_order: idx,
          proposed_property_ids: l.proposed_property_ids ?? [],
        }))
        const { error: insErr } = await supabase.from('broker_diary_customers').insert(inserts)
        if (insErr) throw insErr
        // 삽입 결과를 되읽지 않고 RPC로 다시 불러온다 — 표시 규칙을 로드 경로와 일치시키기 위해
        const { data: fresh, error: freshErr } = await supabase.rpc('diary_customers_for_date', { p_broker_id: targetBrokerId, p_date: diaryDate })
        if (freshErr) throw freshErr
        setDiaryCustomers((fresh ?? []).map(toDiaryRow))
      } else {
        setDiaryCustomers([])
      }

      // 3) 섹션 내용 + 구조 복사 (불러온 날의 섹션 구성을 이 날짜로 가져옴)
      const newContent = sourceDiary?.sections_content ?? {}
      const newSections = resolveSections((sourceDiary as any)?.sections, sections, newContent, diaryDate)
      // 본문 저장과 같은 줄에 세운다 — 방금 blur된 섹션 저장의 첫 insert와 겹치면 UNIQUE에 걸린다
      const t = currentTarget()
      if (!t) return
      const { created } = await enqueueSave(() => writeDiaryRow(t, () => ({ sections_content: newContent, sections: newSections })))
      if (created) notifyOwnerOfBrokerAction(targetBrokerId, 'diary', `/broker/diary?date=${diaryDate}&broker=${targetBrokerId}`)
      setSectionContent(newContent)
      setSections(newSections)
      savedSectionsRef.current = newSections
      // 건너뛴 게 있으면 모달을 닫지 않고 알린다 — 조용히 빠지면 왜 줄었는지 알 수 없다
      const skipped = (sourceLinks ?? []).length - liveLinks.length
      if (skipped > 0) setImportNotice(`불러왔어요. 다만 휴지통에 있는 고객 ${skipped}명은 제외했습니다.`)
      else setShowImport(false)
    } catch (e: any) {
      // 조용히 끝내면 삭제만 된 채로 일지가 비어 보인다 — 알리고 DB 기준으로 되돌린다
      console.error('[diary] 불러오기 실패:', e)
      setImportError(e?.message ?? '불러오기에 실패했습니다. 다시 시도해 주세요.')
      await loadDiaryData(diaryDate)
    } finally {
      setImporting(false)
    }
  }

  // 날짜 포맷
  const changeDate = (delta: number) => setDiaryDate(addDays(diaryDate, delta))
  const formatDateHeader = (d: string) => {
    const date = new Date(d); const days = ['일','월','화','수','목','금','토']
    return `${date.getFullYear()}/${String(date.getMonth()+1).padStart(2,'0')}/${String(date.getDate()).padStart(2,'0')} (${days[date.getDay()]})`
  }

  // 현재 보고 있는 사람 이름
  const viewingName = viewingBrokerId
    ? (employees.find(e => e.id === viewingBrokerId)?.name ?? '직원')
    : (profile?.name ?? '')
  // 대표가 다른 직원 일지 보는 중이면 읽기 전용
  // 사장님은 직원 일지도 편집 가능. 직원은 다른 사람 일지 보면 read-only.
  // 퇴사자 archive는 법적 보존 기록이라 누구도 편집 불가.
  const effectiveCanEdit = canEdit && (isOwner || !viewingBrokerId) && !viewingExEmployee
  // 퇴사자 archive 모드에서도 대표는 섹션 텍스트(업무요약·광고현황 등)는 편집 가능
  // 고객 행 셀은 본체 broker_customers 데이터라 archive 스냅샷 화면에서 직접 편집은 차단 (위 effectiveCanEdit가 false)
  const canEditSections = effectiveCanEdit || (viewingExEmployee && isOwner)

  // 활성 칼럼
  const fixedCols: ColDef[] = []
  const optionalCols = CUST_COLS
  type ActiveCol = { type: 'fixed'; def: ColDef } | { type: 'optional'; def: ColDef } | { type: 'custom'; id: string; name: string }
  const activeCols: ActiveCol[] = loaded
    ? [
        ...settings.order.flatMap((key): ActiveCol[] => {
          const od = CUST_COLS.find(c => c.key === key); if (od && settings.visible.includes(key)) return [{ type: 'optional', def: od }]
          const cd = settings.customCols.find(c => c.id === key); if (cd && settings.visible.includes(key)) return [{ type: 'custom', id: cd.id, name: cd.name }]
          return []
        }),
        // 저장된 order에 없는 신규 칼럼(예: 제안 매물) 자동 추가
        ...CUST_COLS.filter(c => !settings.order.includes(c.key)).map(def => ({ type: 'optional' as const, def })),
      ]
    : CUST_COLS.map(def => ({ type: 'optional' as const, def }))
  const getColKey = (col: ActiveCol) => col.type === 'custom' ? col.id : col.def.key
  const getColWidth = (col: ActiveCol) => { const key = getColKey(col); return settings.widths[key] ?? (col.type === 'custom' ? 120 : (col.def.minWidth ?? 100)) }

  const renderCell = (c: DiaryCustomerRow, col: ActiveCol) => {
    // 휴지통 고객은 그날 기록으로만 보여 준다 — 고쳐도 RLS에 막혀 저장되지 않는다
    const ro = !effectiveCanEdit || !!c.is_deleted
    if (col.type === 'custom') {
      const cd = settings.customCols.find(cc => cc.id === col.id)
      if (cd?.type === 'select') return <SelectCell value={c.custom_fields?.[col.id] ?? ''} options={settings.options[col.id] ?? []} onSave={v => saveCustomField(c.id, col.id, v)} readOnly={ro} multi={settings.multi[col.id]} />
      return <TextCell value={c.custom_fields?.[col.id] ?? ''} onSave={v => saveCustomField(c.id, col.id, v)} placeholder="—" readOnly={ro} />
    }
    const def = col.def; const opts = def.key === 'source' ? sourceOptions : (settings.options[def.key] ?? def.defaultOpts ?? []); const colorMap = COL_COLORS[def.key]
    switch (def.key) {
      case 'request':       return <LongTextCell value={c.request} onSave={v => saveCustomerField(c.id, 'request', v || null)} placeholder="요청사항" readOnly={ro} />
      case 'received_date': return <TextCell value={c.received_date} onSave={v => saveCustomerField(c.id, 'received_date', v || null)} placeholder="접수일자" readOnly={ro} />
      case 'contact':       return <TextCell value={c.contact} onSave={v => saveCustomerField(c.id, 'contact', v || null)} placeholder="연락처" readOnly={ro} />
      case 'interest':      return <SelectCell value={(c as any).interest ?? ''} options={opts} onSave={v => saveCustomerField(c.id, 'interest', v || null)} colorMap={colorMap} readOnly={ro} placeholder="관심물건" multi={settings.multi['interest']} />
      case 'source':        return <SelectCell value={c.source} options={opts} onSave={v => saveCustomerField(c.id, 'source', v)} colorMap={colorMap} readOnly={ro} placeholder="유입" multi={settings.multi['source']} />
      case 'status':        return <SelectCell value={c.status} options={opts} onSave={v => saveCustomerField(c.id, 'status', v)} colorMap={colorMap} readOnly={ro} placeholder="진행상황" multi={settings.multi['status']} />
      case 'consult_note':  return <LongTextCell value={(c as any).consult_note ?? ''} onSave={v => saveCustomerField(c.id, 'consult_note', v || null)} placeholder="상담내용" readOnly={ro} />
      case 'proposed_properties': return <ProposedPropertiesCell propIds={c.proposed_property_ids} propertyMap={propertyMap} canSeeMemo={p => isOwner || p.broker_id === broker?.id || (!!officeOwnerName && (p.assignee ?? '').split(',').map(s => s.trim()).includes(officeOwnerName))} onOpen={() => setPropertyPickerLinkId(c.link_id)} onRemove={id => saveProposedProperties(c.link_id, (c.proposed_property_ids ?? []).filter(x => x !== id))} readOnly={ro} />
      default: return null
    }
  }

  const linkedIds = new Set(diaryCustomers.map(c => c.id))

  // 화면 순서는 접수일자 순 — 넣은 순서(sort_order)대로만 그리면 옛 고객을 나중에 넣을 때
  // 11-04 아래에 07-13 이 끼는 식으로 날짜가 뒤섞였다(11-04 사장님). 위로 쌓기는 최근이 위,
  // 아래로 쌓기는 최근이 아래. 접수일 없는 새 줄은 가장 최근으로 친다. 같은 날은 넣은 순서.
  // 2026-11-04 일지부터만 — 그전 일지는 적어 둔 순서 그대로 둔다(사장님 지시).
  const shownCustomers = diaryDate < '2026-11-04' ? diaryCustomers : [...diaryCustomers].sort((a, b) => {
    const da = a.received_date ?? '9999-99-99', db = b.received_date ?? '9999-99-99'
    if (da !== db) return direction === 'up' ? db.localeCompare(da) : da.localeCompare(db)
    return a.sort_order - b.sort_order
  })

  // 그날 고객목록에 등록했는데 일지에는 없는 이 사람 담당 고객 — 사무실 화면은 '오늘 고객 1명 등록' 인데
  // 일지는 0명이라 같은 날 같은 사람 숫자가 달랐다(10-30 점검 4명). 일지는 고른 고객만 담는 칸이라
  // 자동으로 넣지 않고, 있다는 것을 알려 한 번에 넣을 수 있게 한다.
  const [dayUnlinked, setDayUnlinked] = useState<Customer[]>([])
  const linkedKey = diaryCustomers.map(c => c.id).join(',')
  useEffect(() => {
    // 일지를 다 불러오기 전에 세면 이미 들어 있는 고객까지 '없다'로 잡혀 알림이 떴다 사라졌다(11-05).
    if (!pickerOfficeId || !viewingName || viewingExEmployee || diaryLoading || !diaryReady) { setDayUnlinked([]); return }
    let alive = true
    void (async () => {
      // 고객목록에서 지운 고객은 빼야 한다 — 같은 날 만들었다 지운 빈 줄이 '1명 없음'으로 떴다(11-05).
      const { data } = await supabase.from('broker_customers').select(CUST_PICK_COLS)
        .eq('office_broker_id', pickerOfficeId).ilike('assignee', `%${viewingName}%`)
        .is('deleted_at', null)
        .gte('created_at', new Date(`${diaryDate}T00:00:00+09:00`).toISOString())
        .lt('created_at', new Date(`${addDays(diaryDate, 1)}T00:00:00+09:00`).toISOString())
        .limit(100)
      if (!alive) return
      const linked = new Set(linkedKey ? linkedKey.split(',') : [])
      setDayUnlinked(((data ?? []) as Customer[]).filter(c => !linked.has(c.id)
        && (c.assignee ?? '').split(',').map(x => x.trim()).includes(viewingName)))
    })()
    return () => { alive = false }
  }, [pickerOfficeId, viewingName, viewingExEmployee, diaryDate, linkedKey, diaryLoading, diaryReady])
  const addDayUnlinked = async () => {
    if (!broker || dayUnlinked.length === 0) return
    const targetBrokerId = viewingBrokerId ?? broker.id
    const orders = diaryCustomers.map(d => d.sort_order)
    let next = orders.length > 0 ? Math.max(...orders) + 1 : 0
    const inserts = dayUnlinked.map(c => ({ broker_id: targetBrokerId, diary_date: diaryDate, customer_id: c.id, sort_order: next++ }))
    const { error } = await supabase.from('broker_diary_customers').insert(inserts)
    if (error) { toast.error(`일지에 넣지 못했습니다: ${error.message}`); return }
    const { data: fresh } = await supabase.rpc('diary_customers_for_date', { p_broker_id: targetBrokerId, p_date: diaryDate })
    setDiaryCustomers((fresh ?? []).map(toDiaryRow))
    toast.success(`고객 ${inserts.length}명을 일지에 넣었어요`)
  }

  if (loading) return <div className="bg-gray-50 dark:bg-gray-950 flex items-center justify-center"><div className="text-gray-500 text-sm">불러오는 중...</div></div>
  if (accessDenied) return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="text-5xl">🔒</div>
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-300">업무일지 접근 권한이 없어요</h2>
        <p className="text-sm text-gray-500">대표에게 권한 설정을 요청해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="px-4 py-6 space-y-4">

        {/* 날짜 헤더 — 제목과 조작칸이 한 줄에 다 들어가면 양 끝으로, 모자라면 조작칸이 통째로 아랫줄로 */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{formatDateHeader(diaryDate)} 업무일지</h1>
            {viewingExEmployee && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                퇴사자 일지 · 읽기 전용
              </span>
            )}
          </div>
          {/* 조작칸은 한 묶음 — 선택·불러오기·날짜를 모두 같은 높이(h-9)로 한 줄에 둔다. 선택이 제목 밑에 따로 있으면
              오른쪽 묶음이 두 줄 사이 가운데에 떠서 어긋나 보였다(11-06). 좁으면 묶음 단위로만 줄을 바꾼다 —
              '< 날짜 >' 는 떼지 않는다(> 만 다음 줄로 떨어졌던 일, 11-05). */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {/* 대표: 직원/퇴사자 선택 드롭다운 */}
            {isOwner && (employees.length > 0 || exEmployees.length > 0) && (
              // 선택칸은 가장 긴 항목('퇴사자 일지 보기…') 폭으로 잡혀 넓었다 — 고른 이름만 글자로 보이고
              // 투명한 선택칸을 그 위에 겹친다. 폭·글씨가 옆 [불러오기] 와 같아진다(11-06)
              <label className="relative flex h-9 items-center gap-1 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-2.5 sm:px-3 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors cursor-pointer whitespace-nowrap">
                {viewingBrokerId
                  ? (employees.find(e => e.id === viewingBrokerId)?.name ?? exEmployees.find(e => e.id === viewingBrokerId)?.name ?? '직원')
                  : '내 일지'}
                <ChevronDown className="h-3.5 w-3.5" />
                <select
                  value={viewingExEmployee ? `ex:${viewingBrokerId}` : (viewingBrokerId ?? '')}
                  onChange={e => {
                    const v = e.target.value
                    if (v === '__ex') { void loadExEmployees(); return }
                    if (!v) { setViewingBrokerId(null); setViewingExEmployee(false) }
                    else if (v.startsWith('ex:')) { setViewingBrokerId(v.slice(3)); setViewingExEmployee(true) }
                    else { setViewingBrokerId(v); setViewingExEmployee(false) }
                  }}
                  aria-label="업무일지 작성자 선택"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                >
                  <option value="">내 일지</option>
                  {employees.length > 0 && (
                    <optgroup label="재직">
                      {employees.map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="퇴사">
                    {exState !== 'done' && (
                      <option value="__ex">{exState === 'loading' ? '퇴사자 불러오는 중…' : '퇴사자 일지 보기…'}</option>
                    )}
                    {exState === 'done' && exEmployees.length === 0 && <option disabled>퇴사자 기록 없음</option>}
                    {exEmployees.map(e => (
                      <option key={e.id} value={`ex:${e.id}`}>{e.name}</option>
                    ))}
                  </optgroup>
                </select>
              </label>
            )}
            {effectiveCanEdit && (
              // 폰에선 아이콘만 — 글자까지 넣으면 '< 날짜 >' 가 아랫줄로 떨어져 머리가 세 줄이 됐다(11-06)
              <button onClick={openImport} aria-label="불러오기" title="불러오기"
                className="flex items-center justify-center gap-1.5 h-9 w-9 sm:w-auto sm:px-3 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors">
                <Download className="h-4 w-4 sm:h-3.5 sm:w-3.5" /><span className="hidden sm:inline">불러오기</span>
              </button>
            )}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button onClick={() => changeDate(-1)} aria-label="이전 날짜" className="flex items-center justify-center h-9 w-8 sm:w-9 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"><ChevronLeft className="h-4 w-4" /></button>
              <div className="flex h-9 items-center rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-2.5 sm:px-3 hover:border-blue-300 transition-colors">
                <DateCell value={diaryDate} onSave={v => { if (v) setDiaryDate(v) }}
                  triggerClassName="min-h-0 rounded-none px-0 py-0 text-sm font-medium text-gray-500 dark:text-gray-500 tabular-nums hover:bg-transparent hover:text-blue-600" />
              </div>
              <button onClick={() => changeDate(1)} aria-label="다음 날짜" className="flex items-center justify-center h-9 w-8 sm:w-9 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        {/* Section 1: 고객정보 */}
        <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50">
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">1. 고객정보</span>
            <span className="text-xs text-gray-500">{diaryCustomers.length}명</span>
          </div>
          {effectiveCanEdit && dayUnlinked.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/40 dark:bg-amber-500/10 dark:text-amber-300">
              <span>이 날 고객목록에 등록한 {viewingName} 담당 고객 {dayUnlinked.length}명이 아직 일지에 없어요</span>
              <button type="button" onClick={() => void addDayUnlinked()}
                className="rounded-md bg-amber-600 px-2 py-1 font-semibold text-white hover:bg-amber-700">일지에 넣기</button>
            </div>
          )}
          {diaryLoading ? (
            <div className="py-8 text-center text-sm text-gray-500">불러오는 중...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="border-collapse table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
                <thead>
                  <tr className="border-b-2 border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-xs font-semibold text-gray-500 uppercase tracking-wide select-none">
                    {activeCols.map(col => {
                      const key = getColKey(col); const w = getColWidth(col)
                      return (
                        <th key={key} className={`px-2 py-2.5 text-left relative border-r border-gray-100 dark:border-gray-800 transition-colors ${dragOverCol === key ? 'bg-blue-50' : 'hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800'} cursor-grab`}
                          style={{ width: w, maxWidth: w }} draggable
                          onDragStart={e => onColDragStart(key, e)} onDragOver={e => onColDragOver(key, e)} onDrop={() => onColDrop(key)} onDragEnd={onColDragEnd}>
                          <div className="pr-2">
                            {col.type === 'custom' ? (() => {
                              const cd = settings.customCols.find(cc => cc.id === col.id)
                              return <ColumnHeader label={col.name} isCustom colType={cd?.type ?? 'text'} onChangeType={t => changeCustomColType(col.id, t)} hasOptions={cd?.type === 'select'} options={settings.options[col.id] ?? []} onSetOptions={opts => setOpts(col.id, opts)} isMulti={settings.multi[col.id]} onChangeMulti={cd?.type === 'select' ? m => setMulti(col.id, m) : undefined} onHide={() => hideCol(col.id)} onRename={n => renameCustomCol(col.id, n)} onDelete={() => deleteCustomCol(col.id)} />
                            })() : <ColumnHeader label={col.def.label} isFixed={col.def.fixed} hasOptions={col.def.hasOptions} options={col.def.key === 'source' ? sourceOptions : (settings.options[col.def.key] ?? col.def.defaultOpts ?? [])} onSetOptions={col.def.key === 'source' ? saveSourceOptions : opts => setOpts(col.def.key, opts)} isMulti={settings.multi[col.def.key]} onChangeMulti={col.def.hasOptions ? m => setMulti(col.def.key, m) : undefined} onHide={() => hideCol(col.def.key)} />}
                          </div>
                          <div onMouseDown={e => startResize(key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 transition-all" />
                        </th>
                      )
                    })}
                    <SheetActionHeader>
                      <AddColBtn onAdd={addCustomCol} />
                      <ColVisibility cols={[...fixedCols.map(c => ({ key: c.key, label: c.label, fixed: true })), ...optionalCols.map(c => ({ key: c.key, label: c.label }))]} visible={settings.visible} onToggle={key => settings.visible.includes(key) ? hideCol(key) : showCol(key)} />
                    </SheetActionHeader>
                  </tr>
                </thead>
                <tbody>
                  {diaryCustomers.length === 0 ? (
                    <EmptyRow colSpan={activeCols.length + 1} message="아래 버튼으로 고객을 추가하세요" />
                  ) : shownCustomers.map((c) => (
                    <tr key={c.link_id} data-row-id={c.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', addingId === c.id && 'animate-pulse bg-blue-50/40', c.is_deleted && 'bg-gray-50/70 dark:bg-gray-800/30')}>
                      {activeCols.map((col, ci) => (
                        <td key={getColKey(col)} className="px-3 py-1.5 border-r border-gray-100 dark:border-gray-800" style={{ width: getColWidth(col), maxWidth: getColWidth(col) }}>
                          {ci === 0 && c.is_deleted && (
                            <span className="mb-0.5 inline-block rounded-full bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-gray-300" title="휴지통에 있는 고객이라 수정할 수 없어요">휴지통</span>
                          )}
                          {renderCell(c, col)}
                        </td>
                      ))}
                      <SheetActionCell canEdit={effectiveCanEdit} onCopy={() => duplicateDiaryCustomer(c)} onDelete={() => setDeleteConfirm(c.link_id)} />
                    </tr>
                  ))}
                  {effectiveCanEdit && (
                    <tr><td colSpan={activeCols.length + 1} className="border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center divide-x divide-gray-100">
                        <button onClick={() => setShowPicker(true)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-600 dark:text-gray-500 hover:bg-gray-50/80 transition-colors">
                          <Plus className="h-3.5 w-3.5" />고객 등록
                        </button>
                        <button onClick={() => updateDirection(direction === 'up' ? 'down' : 'up')}
                          title={direction === 'up' ? '새 행이 위로 쌓임 (클릭하면 아래로)' : '새 행이 아래로 쌓임 (클릭하면 위로)'}
                          className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50/50 transition-colors">
                          {direction === 'up' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                          {direction === 'up' ? '위로 쌓기' : '아래로 쌓기'}
                        </button>
                      </div>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sections 2~ — 넓은 화면은 두 줄로, 칸마다 키에 맞춰 덜 찬 쪽에 차례로 쌓는다(벽돌 쌓기).
            예전 2열 그리드는 한 행의 키를 맞춰 긴 칸 옆이 텅 비었고, 왼쪽·오른쪽을 고정으로 나누면
            섹션이 많은 날 한쪽만 길어졌다(2026-10-29 사장님). 좁은 화면은 한 줄로 순서 그대로. */}
        {!diaryLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4" style={{ gridAutoRows: MASONRY_ROW }}>
            {sections.map((def, idx) => (
              <MasonryCell key={def.id}>
                {def.id === 's_ad' && diaryDate >= AD_COMMON_FROM ? (
                  // 광고현황은 사람마다가 아니라 사무실 공통 — 현황판 숫자 + 메모
                  <DiaryAdCommon num={idx + 2} title={def.title} officeId={pickerOfficeId} date={diaryDate}
                    myBrokerId={broker?.id ?? null} viewedBrokerId={viewingBrokerId ?? broker?.id ?? null} readOnly={!broker} />
                ) : (
                  <DiarySection def={def} num={idx + 2} content={sectionContent[def.id] ?? null}
                    onSave={v => saveSectionContent(def.id, v)} onRename={renameSection} onDelete={(id) => setSectionDeleteConfirm({ id, title: def.title })} readOnly={!canEditSections} />
                )}
              </MasonryCell>
            ))}
            {effectiveCanEdit && (
              <MasonryCell>
                <button onClick={addSection} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-800 py-3 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-500 transition-colors">
                  <Plus className="h-4 w-4" />섹션 추가
                </button>
              </MasonryCell>
            )}
          </div>
        )}

      </div>

      {/* 고객 피커 */}
      {showPicker && (
        <CustomerPicker officeId={pickerOfficeId} linkedIds={linkedIds} ownerName={viewingName} ownerBrokerId={viewingBrokerId ?? broker?.id ?? null}
          onAddExisting={addExistingCustomer} onCreateNew={createAndAddCustomer} onClose={() => setShowPicker(false)} />
      )}

      {/* 제안 매물 피커 */}
      {propertyPickerLinkId && (() => {
        const row = diaryCustomers.find(c => c.link_id === propertyPickerLinkId)
        return (
          <PropertyPicker
            officeId={pickerOfficeId}
            selectedIds={row?.proposed_property_ids ?? []}
            memoScope={isOwner ? null : { selfId: broker?.id ?? '', ownerName: officeOwnerName }}
            onConfirm={ids => saveProposedProperties(propertyPickerLinkId, ids)}
            onClose={() => setPropertyPickerLinkId(null)}
          />
        )
      })()}

      {/* 불러오기 모달 */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">다른 날 업무일지 불러오기</h3>
            <p className="text-sm text-gray-500 mb-5">선택한 날짜의 고객·내용을 <span className="font-semibold text-gray-700 dark:text-gray-300">{formatDateHeader(diaryDate)}</span>에 덮어씁니다.</p>
            <div className="mb-5">
              <label htmlFor={importDateId} className="text-xs font-semibold text-gray-500 mb-1.5 block">불러올 날짜</label>
              <input id={importDateId} type="date" value={importDate} max={diaryDate}
                onChange={e => setImportDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 cursor-pointer" />
            </div>
            {importError && (
              <p className="mb-4 rounded-xl bg-red-50 dark:bg-red-950/40 px-3 py-2.5 text-xs font-medium text-red-600 dark:text-red-400">{importError}</p>
            )}
            {importNotice && (
              <p className="mb-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">{importNotice}</p>
            )}
            <div className="flex gap-3">
              <button onClick={() => { setShowImport(false); setImportError(null); setImportNotice(null) }} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">{importNotice ? '닫기' : '취소'}</button>
              <button onClick={importFromDate} disabled={!importDate || importing}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                {importing ? '불러오는 중...' : '불러오기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">이 날 일지에서 제거할까요?</h3>
            <p className="text-sm text-gray-500 mb-6">고객 정보는 유지되고, {formatDateHeader(diaryDate)} 일지에서만 사라져요.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
              <button onClick={() => unlinkCustomer(deleteConfirm)} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">제거</button>
            </div>
          </div>
        </div>
      )}

      {/* 섹션 삭제 확인 */}
      {sectionDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">‘{sectionDeleteConfirm.title}’ 섹션을 삭제할까요?</h3>
            <p className="text-sm text-gray-500 mb-6"><span className="font-semibold text-gray-700 dark:text-gray-300">이 날짜의 일지에서만</span> 사라지고, 다른 날짜는 그대로예요. 작성한 내용은 남아 있어, 같은 날 이 섹션을 다시 만들면 복구됩니다.</p>
            <div className="flex gap-3">
              <button onClick={() => setSectionDeleteConfirm(null)} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
              <button onClick={() => { deleteSection(sectionDeleteConfirm.id); setSectionDeleteConfirm(null) }} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
