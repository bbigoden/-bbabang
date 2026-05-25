'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Search, Users, ChevronDown, EyeOff, Eye, MoreHorizontal, X, Lock, Download, Check, Copy, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useColSettings, ColSettings } from '@/lib/use-col-settings'
import { useSheetDirection } from '@/lib/use-sheet-direction'
import { useClickOutside } from '@/lib/use-click-outside'
import { ColumnHeader } from '@/components/sheet/column-header'
import { SheetActionCell, SheetActionHeader } from '@/components/sheet/action-cell'
import { CellTooltip } from '@/components/sheet/cells/cell-tooltip'
import { TextCell } from '@/components/sheet/cells/text-cell'
import { SelectCell } from '@/components/sheet/cells/select-cell'
import { DateCell } from '@/components/sheet/cells/date-cell'
import { ArrowUp, ArrowDown } from 'lucide-react'

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
  { key: 'source',         label: '유입',     fixed: true, minWidth: 90, hasOptions: true, defaultOpts: ['빠방', '당근', '플레이스', '네이버광고', '네이버블로그', '공동', '지인', '특톡', '기타'] },
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

const SOURCE_COLORS: Record<string, string> = {
  '빠방': 'bg-blue-100 text-blue-700', '당근': 'bg-orange-100 text-orange-700',
  '플레이스': 'bg-sky-100 text-sky-700', '네이버광고': 'bg-green-100 text-green-700',
  '네이버블로그': 'bg-green-100 text-green-700', '공동': 'bg-purple-100 text-purple-700',
  '지인': 'bg-pink-100 text-pink-700', '특톡': 'bg-yellow-100 text-yellow-700',
  '기타': 'bg-gray-100 text-gray-600',
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

interface Customer {
  id: string; client_name: string; contact: string | null; received_date: string | null
  assignee: string | null; category: string; source: string | null; status: string
  request: string | null; created_at: string; custom_fields: Record<string, string> | null
}



// ── ColAdder (숨김 칼럼 복원 + 커스텀 칼럼 추가) ────────────
function ColAdder({ fixedCols, optionalCols, customCols, visible, onShow, onAddCustom, asHeaderButton }: {
  fixedCols: ColDef[]
  optionalCols: ColDef[]
  customCols: Array<{ id: string; name: string }>
  visible: string[]
  onShow: (key: string) => void
  onAddCustom: (name: string) => void
  asHeaderButton?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [addingName, setAddingName] = useState('')
  const [showInput, setShowInput] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => { setOpen(false); setShowInput(false); setAddingName('') })

  const hiddenOptional = optionalCols.filter(c => !visible.includes(c.key))
  const hiddenCustom = customCols.filter(c => !visible.includes(c.id))

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setStyle({ position: 'fixed', zIndex: 9999, top: r.bottom + 2, right: Math.max(4, window.innerWidth - r.right), minWidth: 180 })
    }
    setOpen(v => !v)
  }

  const addCustom = () => {
    const v = addingName.trim()
    if (!v) return
    onAddCustom(v); setAddingName(''); setShowInput(false); setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div ref={btnRef} onClick={handleOpen}
        className={asHeaderButton
          ? 'flex items-center gap-2 rounded-xl border border-blue-600 px-4 py-2.5 text-sm font-bold text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer'
          : 'flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-500 cursor-pointer transition-colors text-sm font-bold leading-none'
        }>
        {asHeaderButton ? <>헤더 추가</> : '+'}</div>
      {open && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl overflow-hidden" style={style}
          onClick={e => e.stopPropagation()}>

          {/* 고정 칼럼 섹션 */}
          <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 dark:border-gray-800">
            <Lock className="h-2.5 w-2.5" />고정 칼럼
          </div>
          {fixedCols.map(col => (
            <div key={col.key} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-400">
              <span className="text-[10px] text-gray-300">🔒</span>{col.label}
            </div>
          ))}

          {/* 선택 칼럼 섹션 */}
          {hiddenOptional.length > 0 && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">선택 칼럼</div>
              {hiddenOptional.map(col => (
                <button key={col.key} onClick={() => { onShow(col.key); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                  <span className="text-gray-300 font-bold">+</span>{col.label}
                </button>
              ))}
            </>
          )}

          {/* 내 칼럼 섹션 */}
          {hiddenCustom.length > 0 && (
            <>
              <div className="border-t border-gray-100 dark:border-gray-800 px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">내 칼럼</div>
              {hiddenCustom.map(col => (
                <button key={col.id} onClick={() => { onShow(col.id); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                  <span className="text-gray-300 font-bold">+</span>{col.name}
                </button>
              ))}
            </>
          )}

          {/* 새 칼럼 만들기 */}
          <div className="border-t border-gray-100 dark:border-gray-800">
            {showInput ? (
              <div className="flex items-center gap-1.5 px-2 py-2">
                <input autoFocus value={addingName} onChange={e => setAddingName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCustom(); if (e.key === 'Escape') { setShowInput(false); setAddingName('') } }}
                  placeholder="칼럼 이름 입력"
                  className="flex-1 rounded-lg border border-blue-400 px-2 py-1 text-xs outline-none min-w-0 placeholder-gray-300" />
                <button onClick={addCustom} className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">추가</button>
              </div>
            ) : (
              <button onClick={() => setShowInput(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-blue-600 hover:bg-blue-50 transition-colors font-medium">
                <Plus className="h-3.5 w-3.5" />새 칼럼 만들기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── AddColBtn ─────────────────────────────────────────
function AddColBtn({ onAdd }: { onAdd: (name: string, type: 'text' | 'select') => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<'text' | 'select'>('text')
  const btnRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  useClickOutside(containerRef, () => { setOpen(false); setName(''); setType('text') })
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopStyle({ position: 'fixed', top: r.bottom + 4, left: Math.max(8, r.right - 210), zIndex: 9999 })
    }
    setOpen(v => !v)
  }
  const add = () => {
    if (name.trim()) { onAdd(name.trim(), type); setName(''); setType('text'); setOpen(false) }
  }

  return (
    <div ref={containerRef} className="relative">
      <button ref={btnRef} onClick={handleOpen}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-500 cursor-pointer transition-colors text-sm font-bold leading-none">
        +
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl p-2.5" style={popStyle}>
          <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setOpen(false); setName('') } }}
            placeholder="칼럼 이름 입력"
            className="rounded-lg border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 w-44" />
          <div className="flex gap-1">
            <button onClick={() => setType('text')}
              className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${type === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
              텍스트
            </button>
            <button onClick={() => setType('select')}
              className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${type === 'select' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>
              선택
            </button>
          </div>
          <button onClick={add} disabled={!name.trim()}
            className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">추가</button>
        </div>
      )}
    </div>
  )
}

// ── ColVisibility ─────────────────────────────────────
function ColVisibility({ fixedCols, optionalCols, customCols, visible, onToggle }: {
  fixedCols: ColDef[]
  optionalCols: ColDef[]
  customCols: Array<{ id: string; name: string }>
  visible: string[]
  onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  useClickOutside(containerRef, () => setOpen(false))

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopStyle({ position: 'fixed', top: r.bottom + 4, left: Math.max(8, r.right - 260), zIndex: 9999, width: 260 })
    }
    setOpen(v => !v)
  }

  const all = [
    ...fixedCols.map(c => ({ key: c.key, label: c.label, fixed: true })),
    ...optionalCols.map(c => ({ key: c.key, label: c.label, fixed: false })),
  ]
  const rows = search ? all.filter(c => c.label.includes(search)) : all
  const hideAll = () => all.filter(c => !c.fixed && visible.includes(c.key)).forEach(c => onToggle(c.key))

  return (
    <div ref={containerRef} className="relative">
      <button ref={btnRef} onClick={handleOpen}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-gray-200 hover:text-gray-500 cursor-pointer transition-colors">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl overflow-hidden" style={popStyle}>
          <div className="p-2 border-b border-gray-100 dark:border-gray-800">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="속성을 검색하세요" autoFocus
              className="w-full rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-xs focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20" />
          </div>
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-xs font-medium text-gray-500">표에 표시하기</span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {rows.map(c => (
              <div key={c.key}
                className={`flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 ${c.fixed ? 'cursor-default' : 'cursor-pointer'}`}
                onClick={() => !c.fixed && onToggle(c.key)}>
                <span className={`text-xs font-medium ${c.fixed || visible.includes(c.key) ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400'}`}>{c.label}</span>
                <Eye className={`h-3.5 w-3.5 flex-shrink-0 ${c.fixed || visible.includes(c.key) ? 'text-gray-400' : 'text-gray-200'}`} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── mapCategory ───────────────────────────────────────
function mapCategory(roomType: string, opts: string[]): string {
  if (!roomType) return opts[0] ?? '비주거'
  const residential = ['아파트', '빌라', '원룸', '투룸', '쓰리룸', '주택', '연립', '다세대', '오피스텔', '다가구']
  if (residential.some(r => roomType.includes(r))) return opts.includes('주거용') ? '주거용' : opts[0]
  return opts.includes('비주거') ? '비주거' : opts[0]
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

// ── 메인 페이지 ──────────────────────────────────────
export default function BrokerCustomersPage() {
  const supabase = createClient()
  const router = useRouter()
  const auth = useAuth()

  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [teamMembers, setTeamMembers] = useState<string[]>([])
  const [canEdit, setCanEdit] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [monthFilter, setMonthFilter] = useState('전체')
  const [assigneeFilter, setAssigneeFilter] = useState('전체')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 불러오기 모달
  const [showImport, setShowImport] = useState(false)
  const [importLoading, setImportLoading] = useState(false)
  const [importItems, setImportItems] = useState<any[]>([])
  const [importSelected, setImportSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  // 칼럼 드래그
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const wasDragRef = useRef(false)

  // 칼럼 설정 (DB)
  const { settings, update, loaded } = useColSettings('customers', broker?.id ?? null, DEFAULT_COL_SETTINGS)
  const { direction, updateDirection } = useSheetDirection(broker?.id ?? null, 'customers')

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
    setIsOwner(owner)

    // ── 권한 체크 (직원만) ──────────────────────────────
    if (!owner) {
      if (b.is_approved === false) { setAccessDenied(true); setLoading(false); return }
      const perms = b.permissions
      if (perms?.customers?.view === false) { setAccessDenied(true); setLoading(false); return }
      setCanEdit(perms ? perms.customers?.edit !== false : true)
    }

    // ── 팀원 이름 목록 구성 ────────────────────────────
    const myName = prof?.name
    if (owner) {
      const { data: emps } = await supabase
        .from('broker_profiles')
        .select('profiles(name)')
        .eq('parent_broker_id', b.id)
        .eq('is_approved', true)
      const empNames = (emps ?? []).map((e: any) => e.profiles?.name).filter(Boolean)
      setTeamMembers([myName, ...empNames].filter(Boolean) as string[])
    } else {
      setTeamMembers(myName ? [myName] : [])
    }

    // ── 데이터 범위 결정 ───────────────────────────────
    // 룰: 대표=사무소 전체, 직원=본인 고객만 (고객은 개인 정보·영업 비밀로 분리)
    let brokerIds: string[] = [b.id]
    if (owner) {
      const { data: employees } = await supabase.from('broker_profiles').select('id').eq('parent_broker_id', b.id)
      if (employees) brokerIds = [b.id, ...employees.map((e: any) => e.id)]
    }

    const { data } = await supabase.from('broker_customers').select('*')
      .in('broker_id', brokerIds).order('received_date', { ascending: false }).order('created_at', { ascending: false })
    setCustomers(data ?? [])
    setLoading(false)
  }

  const saveField = useCallback(async (id: string, field: string, value: any) => {
    let prevValue: any = undefined
    setCustomers(prev => {
      const row = prev.find(c => c.id === id) as any
      if (row) prevValue = row[field]
      return prev.map(c => c.id === id ? { ...c, [field]: value } : c)
    })
    const { error } = await supabase.from('broker_customers')
      .update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) {
      console.error('[saveField] failed', error)
      setCustomers(prev => prev.map(c => c.id === id ? { ...c, [field]: prevValue } : c))
      alert(`저장 실패: ${error.message}`)
    }
  }, [])

  const saveCustomField = useCallback(async (id: string, colId: string, value: string) => {
    let prevFields: Record<string, string> | null = null
    setCustomers(prev => {
      const row = prev.find(c => c.id === id)
      prevFields = (row?.custom_fields ?? null) as any
      const newFields = { ...(row?.custom_fields ?? {}), [colId]: value }
      return prev.map(c => c.id === id ? { ...c, custom_fields: newFields } : c)
    })
    const newFields = { ...(prevFields ?? {}), [colId]: value }
    const { error } = await supabase.from('broker_customers').update({ custom_fields: newFields }).eq('id', id)
    if (error) {
      console.error('[saveCustomField] failed', error)
      setCustomers(prev => prev.map(c => c.id === id ? { ...c, custom_fields: prevFields ?? {} } : c))
      alert(`저장 실패: ${error.message}`)
    }
  }, [])

  const addRow = async () => {
    if (!broker) return
    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await supabase.from('broker_customers').insert({
      broker_id: broker.id, client_name: '', received_date: today,
      assignee: profile?.name ?? null,
      category: '', status: '',
    }).select().single()
    if (error || !data) return
    // customers 배열은 created_at desc 순서. 화면 reverse가 direction을 처리하므로 항상 앞에 추가.
    setCustomers(prev => [data, ...prev])
    setAddingId(data.id); setTimeout(() => setAddingId(null), 2000)
  }

  // 고객 row 복사 — id/created_at 제외하고 모든 필드 동일하게 새 row 생성
  const duplicateCustomer = async (c: Customer) => {
    if (!broker) return
    const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = c as Customer & { updated_at?: string }
    const { data, error } = await supabase.from('broker_customers').insert(rest).select().single()
    if (error || !data) return
    setCustomers(prev => [data, ...prev])
    setAddingId(data.id); setTimeout(() => setAddingId(null), 2000)
  }

  const openImport = async () => {
    setShowImport(true)
    setImportSelected(new Set())
    setImportLoading(true)
    const { data } = await supabase
      .from('chat_rooms')
      .select(`id, created_at, request_posts(deal_type, room_type, city, district, description), profiles!chat_rooms_user_id_fkey(name)`)
      .eq('broker_id', user?.id)
      .order('created_at', { ascending: false })
    setImportItems(data ?? [])
    setImportLoading(false)
  }

  const toggleImportSelect = (id: string) => {
    setImportSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const doImport = async () => {
    if (!broker || importSelected.size === 0) return
    setImporting(true)
    const categoryOpts = settings.options.category ?? ['비주거', '주거용']
    const rows = importItems.filter(item => importSelected.has(item.id))
    const inserts = rows.map(item => {
      const rp = item.request_posts as any
      const parts = [rp?.deal_type, rp?.room_type, rp?.district, rp?.description].filter(Boolean)
      return {
        broker_id: broker.id,
        received_date: new Date(item.created_at).toISOString().split('T')[0],
        request: parts.join(' · ') || null,
        assignee: profile?.name ?? null,
        category: mapCategory(rp?.room_type ?? '', categoryOpts),
        source: '빠방',
        status: settings.options.status?.[0] ?? '잠재',
      }
    })
    const { data, error } = await supabase.from('broker_customers').insert(inserts).select()
    if (!error && data) {
      setCustomers(prev => [...data, ...prev])
      setShowImport(false)
    }
    setImporting(false)
  }

  const deleteRow = async (id: string) => {
    // 휴지통 이동(soft delete) — SECURITY DEFINER RPC (본인·대표만 가능)
    const { error } = await supabase.rpc('soft_delete_customer', { cust_id: id })
    if (error) {
      console.error('[deleteRow] failed', error)
      alert(`삭제 실패: ${error.message}`)
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
  const months = (() => {
    const set = new Set<string>()
    customers.forEach(c => { if (c.received_date) set.add(c.received_date.slice(0, 7)) })
    return ['전체', ...Array.from(set).sort((a, b) => b.localeCompare(a))]
  })()
  const assignees = (() => {
    const set = new Set<string>()
    customers.forEach(c => { if (c.assignee) set.add(c.assignee) })
    return ['전체', ...Array.from(set).sort()]
  })()
  const filtered = customers.filter(c => {
    if (monthFilter !== '전체' && (!c.received_date || !c.received_date.startsWith(monthFilter))) return false
    if (assigneeFilter !== '전체' && c.assignee !== assigneeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      const fields = [
        c.request, c.contact, c.assignee, c.category, c.source, c.status, c.received_date,
      ]
      if (fields.some(f => f?.toLowerCase().includes(q))) return true
      if (c.custom_fields) {
        return Object.values(c.custom_fields).some(v => typeof v === 'string' && v.toLowerCase().includes(q))
      }
      return false
    }
    return true
  })
  const thisMonth = new Date().toISOString().slice(0, 7)
  const newThisMonth = customers.filter(c => c.received_date?.startsWith(thisMonth)).length

  // 페이지네이션 (filtered + 정렬 후 슬라이스)
  const sortedFiltered = direction === 'up' ? filtered : [...filtered].reverse()
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = sortedFiltered.slice((page - 1) * pageSize, page * pageSize)
  // 필터 변경 시 1페이지로 리셋
  useEffect(() => { setPage(1) }, [monthFilter, assigneeFilter, search, pageSize])

  // 새 행 추가 시 새 행이 있는 페이지로 이동 + 화면 스크롤 + 첫 셀 자동 편집
  useEffect(() => {
    if (!addingId) return
    // 새 행 위치: 위로 쌓기 → page 1, 아래로 쌓기 → 마지막 페이지
    const targetPage = direction === 'up' ? 1 : Math.max(1, Math.ceil(customers.length / pageSize))
    setPage(targetPage)
    // 페이지 전환 + 렌더링 후 스크롤 + 첫 셀 클릭
    const t = setTimeout(() => {
      const row = document.querySelector(`tr[data-row-id="${addingId}"]`) as HTMLElement | null
      if (row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' })
        // 첫 편집 가능 셀 클릭 → 편집 모드 진입
        setTimeout(() => {
          const cells = row.querySelectorAll('td')
          // td[0] = # 번호, td[1] 부터 데이터 셀
          for (let i = 1; i < cells.length - 1; i++) {
            const clickable = cells[i].querySelector('div[class*="cursor"], button:not([disabled])') as HTMLElement | null
            if (clickable) { clickable.click(); break }
          }
        }, 400)
      }
    }, 80)
    return () => clearTimeout(t)
  }, [addingId, direction, customers.length, pageSize])

  // 도넛 분포 — 최대 8개. 9개 이상은 상위 7 + 기타.
  const distribute = (map: Record<string, number>): [string, number][] => {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1])
    if (entries.length <= 8) return entries
    const top = entries.slice(0, 7)
    const restSum = entries.slice(7).reduce((s, [, v]) => s + v, 0)
    return [...top, ['기타', restSum]]
  }
  // 도넛은 현재 필터(월/담당자/검색)에 맞춘 filtered 기준으로 계산
  const assigneeDist = (() => {
    const map: Record<string, number> = {}
    filtered.forEach(c => { if (c.assignee) map[c.assignee] = (map[c.assignee] ?? 0) + 1 })
    return distribute(map)
  })()
  const categoryDist = (() => {
    const map: Record<string, number> = {}
    filtered.forEach(c => { if (c.category) map[c.category] = (map[c.category] ?? 0) + 1 })
    return distribute(map)
  })()
  const sourceDist = (() => {
    const map: Record<string, number> = {}
    filtered.forEach(c => { if (c.source) map[c.source] = (map[c.source] ?? 0) + 1 })
    return distribute(map)
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
    const opts = settings.options[def.key] ?? def.defaultOpts ?? []
    const colorMap = COL_COLORS[def.key]
    switch (def.key) {
      case 'request':       return <TextCell value={c.request} onSave={v => saveField(c.id, 'request', v || null)} placeholder="요청사항" readOnly={ro} />
      case 'received_date': return <DateCell value={c.received_date} onSave={v => saveField(c.id, 'received_date', v || null)} readOnly={ro} />
      case 'contact':       return <TextCell value={c.contact} onSave={v => saveField(c.id, 'contact', v || null)} placeholder="연락처" readOnly={ro} />
      case 'assignee':
        if (ro || !isOwner) return <TextCell value={c.assignee} onSave={() => {}} placeholder="담당자" readOnly={true} />
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
      <div className="text-gray-400 text-sm">불러오는 중...</div>
    </div>
  )

  if (accessDenied) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="text-5xl">🔒</div>
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-300">고객목록 접근 권한이 없어요</h2>
        <p className="text-sm text-gray-400">대표에게 권한 설정을 요청해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-screen-xl px-4 py-6">

        {/* 헤더 */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white">고객목록</h1>
            <p className="text-sm text-gray-400 mt-0.5">전체 {customers.length}명 · 검색 {filtered.length}명</p>
          </div>
        </div>

        {/* 통계 */}
        {(() => {
          const ASSIGNEE_COLORS = ['#60a5fa','#3b82f6','#2563eb','#93c5fd']
          const CATEGORY_COLORS_CHART = ['#a78bfa','#8b5cf6','#7c3aed','#c4b5fd']
          const SOURCE_COLORS_CHART = ['#34d399','#10b981','#f59e0b','#f97316','#6366f1','#ec4899','#14b8a6','#84cc16']
          const aTotal = assigneeDist.reduce((s,[,v])=>s+v,0)
          const cTotal = categoryDist.reduce((s,[,v])=>s+v,0)
          const sTotal = sourceDist.reduce((s,[,v])=>s+v,0)
          return (
            <div className="mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 신규 */}
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-4 py-4 shadow-sm flex flex-col justify-between">
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  <span className="text-xs font-semibold text-gray-500">신규</span>
                </div>
                <div>
                  <div className="text-3xl font-black text-blue-600 leading-none">{monthFilter === '전체' ? newThisMonth : filtered.length}<span className="text-sm font-normal text-gray-400 ml-1">명</span></div>
                  <div className="text-[10px] text-gray-300 mt-1">{monthFilter === '전체' ? '이번달 신규 고객' : `${monthFilter.slice(2, 4)}년 ${parseInt(monthFilter.slice(5, 7), 10)}월 신규 고객`}</div>
                </div>
              </div>

              {/* 담당자 도넛 */}
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-4 py-4 shadow-sm">
                <div className="text-xs font-semibold text-gray-500 mb-3">담당자</div>
                {assigneeDist.length === 0 ? (
                  <div className="text-xs text-gray-300 text-center py-6">데이터 없음</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
                      <DonutChart data={assigneeDist} colors={ASSIGNEE_COLORS} total={aTotal} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-gray-600 dark:text-gray-400">{aTotal}</span>
                      </div>
                    </div>
                    <div className={`flex-1 min-w-0 ${assigneeDist.length > 4 ? 'grid grid-cols-2 gap-x-2 gap-y-1.5' : 'space-y-1.5'}`}>
                      {assigneeDist.map(([label, count], i) => (
                        <div key={label} className="flex items-center gap-1.5 min-w-0">
                          <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: ASSIGNEE_COLORS[i % ASSIGNEE_COLORS.length] }} />
                          <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate flex-1">{label}</span>
                          <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 구분 도넛 */}
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-4 py-4 shadow-sm">
                <div className="text-xs font-semibold text-gray-500 mb-3">구분</div>
                {categoryDist.length === 0 ? (
                  <div className="text-xs text-gray-300 text-center py-6">데이터 없음</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
                      <DonutChart data={categoryDist} colors={CATEGORY_COLORS_CHART} total={cTotal} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-gray-600 dark:text-gray-400">{cTotal}</span>
                      </div>
                    </div>
                    <div className={`flex-1 min-w-0 ${categoryDist.length > 4 ? 'grid grid-cols-2 gap-x-2 gap-y-1.5' : 'space-y-1.5'}`}>
                      {categoryDist.map(([label, count], i) => (
                        <div key={label} className="flex items-center gap-1.5 min-w-0">
                          <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS_CHART[i % CATEGORY_COLORS_CHART.length] }} />
                          <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate flex-1">{label}</span>
                          <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 유입 도넛 */}
              <div className="rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-4 py-4 shadow-sm">
                <div className="text-xs font-semibold text-gray-500 mb-3">유입</div>
                {sourceDist.length === 0 ? (
                  <div className="text-xs text-gray-300 text-center py-6">데이터 없음</div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0" style={{ width: 64, height: 64 }}>
                      <DonutChart data={sourceDist} colors={SOURCE_COLORS_CHART} total={sTotal} />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-[11px] font-bold text-gray-600 dark:text-gray-400">{sTotal}</span>
                      </div>
                    </div>
                    <div className={`flex-1 min-w-0 ${sourceDist.length > 4 ? 'grid grid-cols-2 gap-x-2 gap-y-1.5' : 'space-y-1.5'}`}>
                      {sourceDist.map(([label, count], i) => (
                        <div key={label} className="flex items-center gap-1.5 min-w-0">
                          <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: SOURCE_COLORS_CHART[i % SOURCE_COLORS_CHART.length] }} />
                          <span className="text-[11px] text-gray-600 dark:text-gray-400 truncate flex-1">{label}</span>
                          <span className="text-[11px] font-bold text-gray-700 dark:text-gray-300">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* 필터 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="전체 검색..."
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 pl-8 pr-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20" />
          </div>
          {isOwner && assignees.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              {assignees.map(a => (
                <button key={a} onClick={() => setAssigneeFilter(a)}
                  className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    assigneeFilter === a ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
                  )}>{a}</button>
              ))}
            </div>
          )}
        </div>

        {/* 월 탭 */}
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {months.map(m => (
            <button key={m} onClick={() => setMonthFilter(m)}
              className={cn('flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                monthFilter === m ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
              )}>
              {m === '전체' ? '전체' : (() => { const [y, mo] = m.split('-'); return `${y.slice(2)}년 ${parseInt(mo)}월` })()}
              {m !== '전체' && <span className="ml-1.5 text-[10px] opacity-60">{customers.filter(c => c.received_date?.startsWith(m)).length}</span>}
            </button>
          ))}
        </div>

        {/* 테이블 */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="border-collapse table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
              <thead>
                <tr className="border-b-2 border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-xs font-semibold text-gray-400 uppercase tracking-wide select-none">
                  <th className="px-3 py-2.5 text-center border-r border-gray-100 dark:border-gray-800" style={{ width: 32 }}>#</th>
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
                              options={settings.options[col.def.key] ?? col.def.defaultOpts ?? []}
                              onSetOptions={col.def.key === 'assignee' ? undefined : opts => setOpts(col.def.key, opts)}
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
                      fixedCols={fixedCols}
                      optionalCols={optionalCols}
                      customCols={settings.customCols}
                      visible={settings.visible}
                      onToggle={key => settings.visible.includes(key) ? hideCol(key) : showCol(key)}
                    />
                  </SheetActionHeader>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={activeCols.length + 2} className="py-16 text-center text-sm text-gray-400">
                      {customers.length === 0 ? '아직 등록된 고객이 없어요' : '검색 결과가 없어요'}
                    </td>
                  </tr>
                ) : paginated.map((c, idx) => (
                  <tr key={c.id} data-row-id={c.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', addingId === c.id && 'animate-pulse bg-blue-50/40')}>
                    <td className="px-3 py-1.5 text-center text-xs text-gray-300 font-mono border-r border-gray-100 dark:border-gray-800">{direction === 'up' ? filtered.length - ((page - 1) * pageSize + idx) : ((page - 1) * pageSize + idx + 1)}</td>
                    {activeCols.map(col => (
                      <td key={getColKey(col)} className="px-3 py-1.5 border-r border-gray-100 dark:border-gray-800"
                        style={{ width: getColWidth(col), maxWidth: getColWidth(col) }}>
                        {renderCell(c, col)}
                      </td>
                    ))}
                    <SheetActionCell canEdit={canEdit} onCopy={() => duplicateCustomer(c)} onDelete={() => setDeleteConfirm(c.id)} />
                  </tr>
                ))}
                {canEdit && (
                  <tr>
                    <td colSpan={activeCols.length + 2} className="border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center divide-x divide-gray-100">
                        <button onClick={addRow}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-gray-600 dark:text-gray-400 hover:bg-gray-50/80 transition-colors">
                          <Plus className="h-3.5 w-3.5" />고객 등록
                        </button>
                        <button onClick={() => updateDirection(direction === 'up' ? 'down' : 'up')}
                          title={direction === 'up' ? '새 행이 위로 쌓임 (클릭하면 아래로)' : '새 행이 아래로 쌓임 (클릭하면 위로)'}
                          className="flex items-center gap-1 px-3 py-2 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors">
                          {direction === 'up' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                          {direction === 'up' ? '위로 쌓기' : '아래로 쌓기'}
                        </button>
                        <button onClick={openImport}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors">
                          <Download className="h-3.5 w-3.5" />불러오기
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
            {totalPages > 1 && (
              <>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 disabled:opacity-40 transition-colors"
                ><ChevronLeft className="h-4 w-4" /></button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 2)
                  .reduce<(number | '...')[]>((acc, n, i, arr) => {
                    if (i > 0 && (n as number) - (arr[i - 1] as number) > 1) acc.push('...')
                    acc.push(n); return acc
                  }, [])
                  .map((n, i) => n === '...'
                    ? <span key={`e${i}`} className="px-1 text-gray-400">…</span>
                    : <button key={n} onClick={() => setPage(n as number)}
                        className={`h-9 w-9 rounded-xl border text-sm font-semibold transition-colors ${page === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}
                      >{n}</button>
                  )
                }
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 disabled:opacity-40 transition-colors"
                ><ChevronRight className="h-4 w-4" /></button>
              </>
            )}
            <div className="flex items-center gap-1 ml-3">
              <span className="text-sm text-gray-400">페이지당</span>
              {[10, 20, 50, 100].map(n => (
                <button key={n} onClick={() => setPageSize(n)}
                  className={`h-8 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${pageSize === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}
                >{n}개</button>
              ))}
              <span className="text-sm text-gray-400 ml-1">| 총 {filtered.length}개</span>
            </div>
          </div>
        </div>
      </div>

      {/* 불러오기 모달 */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 shadow-xl mx-4 flex flex-col" style={{ maxHeight: '80vh' }}>
            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">빠방 대화 불러오기</h3>
                <p className="text-xs text-gray-400 mt-0.5">선택한 고객을 고객목록에 추가해요</p>
              </div>
              <button onClick={() => setShowImport(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 목록 */}
            <div className="flex-1 overflow-y-auto">
              {importLoading ? (
                <div className="flex items-center justify-center py-16 text-sm text-gray-400">불러오는 중...</div>
              ) : importItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <div className="text-3xl">💬</div>
                  <p className="text-sm text-gray-400">빠방에서 대화한 고객이 없어요</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {importItems.map(item => {
                    const rp = item.request_posts as any
                    const userName = (item.profiles as any)?.name ?? '이름 없음'
                    const summary = [rp?.deal_type, rp?.room_type, rp?.district].filter(Boolean).join(' · ')
                    const desc = rp?.description
                    const date = new Date(item.created_at).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' })
                    const selected = importSelected.has(item.id)
                    return (
                      <div key={item.id} onClick={() => toggleImportSelect(item.id)}
                        className={cn('flex items-start gap-3 px-5 py-3.5 cursor-pointer transition-colors', selected ? 'bg-blue-50' : 'hover:bg-gray-50')}>
                        <div className={cn('mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                          selected ? 'bg-blue-600 border-blue-600' : 'border-gray-300')}>
                          {selected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-gray-900 dark:text-white">{userName}</span>
                            <span className="text-xs text-gray-400">{date}</span>
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{summary || '요청사항 없음'}</div>
                          {desc && <div className="text-xs text-gray-400 mt-0.5 truncate">{desc}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* 푸터 */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
              <span className="text-xs text-gray-400">{importSelected.size > 0 ? `${importSelected.size}명 선택됨` : '고객을 선택해주세요'}</span>
              <div className="flex gap-2">
                <button onClick={() => setShowImport(false)} className="rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
                <button onClick={doImport} disabled={importSelected.size === 0 || importing}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
                  {importing ? '추가 중...' : '고객 추가'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 삭제 확인 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">고객을 삭제할까요?</h3>
            <p className="text-sm text-gray-500 mb-6">삭제하면 복구할 수 없어요.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
              <button onClick={() => deleteRow(deleteConfirm)} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
