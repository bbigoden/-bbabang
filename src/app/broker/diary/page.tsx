'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Search, Link2, X, ChevronDown, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── 컬럼 정의 ──────────────────────────────────────────
interface ColDef {
  key: string; label: string; fixed?: boolean; minWidth?: number
  hasOptions?: boolean; defaultOpts?: string[]; isLong?: boolean
}

const DIARY_COLS: ColDef[] = [
  { key: 'consulted_at', label: '날짜',     fixed: true, minWidth: 90 },
  { key: 'client_name',  label: '고객명',   fixed: true, minWidth: 130 },
  { key: 'contact',      label: '연락처',   minWidth: 120 },
  { key: 'amount',       label: '금액',     minWidth: 90 },
  { key: 'assignee',     label: '담당자',   minWidth: 80 },
  { key: 'source',       label: '유입경로', minWidth: 90, hasOptions: true, defaultOpts: ['빠방', '당근', '플레이스', '네이버광고', '네이버블로그', '공동', '지인', '특톡', '기타'] },
  { key: 'region',       label: '지역',     minWidth: 80 },
  { key: 'interest',     label: '관심물건', minWidth: 80, hasOptions: true, defaultOpts: ['상가', '주거용', '공장', '창고', '사무실', '토지', '기타'] },
  { key: 'status',       label: '진행상황', minWidth: 90, hasOptions: true, defaultOpts: ['잠재', '진행중', '종료', '계약완료'] },
  { key: 'memo',         label: '상담내용', minWidth: 200, isLong: true },
]

const VISIBLE_KEY = 'crm_diary_visible_v1'
const OPTS_KEY    = 'crm_diary_opts_v1'

const DEFAULT_OPTS: Record<string, string[]> = Object.fromEntries(
  DIARY_COLS.filter(c => c.hasOptions).map(c => [c.key, c.defaultOpts!])
)

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
const COL_COLORS: Record<string, Record<string, string>> = { source: SOURCE_COLORS, status: STATUS_COLORS }

interface Consultation {
  id: string; customer_id: string | null; consulted_at: string; client_name: string
  contact: string | null; amount: string | null; assignee: string | null
  source: string | null; region: string | null; interest: string | null
  status: string; memo: string | null; created_at: string
}
interface CustomerOption { id: string; client_name: string; contact: string | null; assignee: string | null; source: string | null }

// ── useClickOutside ──────────────────────────────────
function useClickOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb() }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [ref, cb])
}

// ── CellTooltip ──────────────────────────────────────
function CellTooltip({ text, anchorRef }: { text: string; anchorRef: React.RefObject<HTMLElement | null> }) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (!anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, top: r.bottom + 4, maxWidth: 320, minWidth: 120 }
    if (r.left + 320 > window.innerWidth) s.right = window.innerWidth - r.right; else s.left = r.left
    setStyle(s)
  }, [anchorRef])
  return <div className="pointer-events-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-xl leading-relaxed whitespace-pre-wrap" style={style}>{text}</div>
}

// ── TextCell ──────────────────────────────────────────
function TextCell({ value, onSave, placeholder = '—' }: { value: string | null; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])
  const commit = () => { setEditing(false); if (draft !== (value ?? '')) onSave(draft) }
  if (editing) return (
    <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
      className="w-full rounded border border-blue-400 bg-white px-2 py-0.5 text-xs outline-none focus:ring-2 focus:ring-blue-300" />
  )
  return (
    <>
      <div ref={cellRef} onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }} onMouseLeave={() => setHovered(false)}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db' }}>
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}

// ── LongTextCell ──────────────────────────────────────
function LongTextCell({ value, onSave, placeholder = '—' }: { value: string | null; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [hovered, setHovered] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (editing) { textareaRef.current?.focus(); textareaRef.current?.select() } }, [editing])
  const commit = () => { setEditing(false); if (draft !== (value ?? '')) onSave(draft) }
  if (editing) return (
    <textarea ref={textareaRef} value={draft} onChange={e => setDraft(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
      rows={3} className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300 resize-none min-w-[180px]" />
  )
  return (
    <>
      <div ref={cellRef} onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }} onMouseLeave={() => setHovered(false)}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden"
        style={{ color: value ? '#374151' : '#d1d5db', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}

// ── SelectCell ──────────────────────────────────────────
function SelectCell({ value, options, onSave, colorMap }: {
  value: string | null; options: string[]; onSave: (v: string) => void; colorMap?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))
  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: r.left }
      if (window.innerHeight - r.bottom < 200) s.bottom = window.innerHeight - r.top + 4; else s.top = r.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v)
  }
  return (
    <div ref={ref} className="relative">
      <div ref={btnRef} onClick={handleOpen}
        className={`cursor-pointer rounded px-2 py-0.5 text-xs font-semibold inline-flex items-center hover:opacity-80 ${value ? (colorMap?.[value] ?? 'bg-gray-100 text-gray-600') : 'bg-gray-50 text-gray-300'}`}>
        {value || '—'}
      </div>
      {open && (
        <div className="flex flex-col min-w-[110px] rounded-xl border border-gray-200 bg-white shadow-lg py-1" style={popupStyle}>
          {options.map(opt => (
            <button key={opt} onClick={() => { onSave(opt); setOpen(false) }}
              className={`px-3 py-1.5 text-left text-xs hover:bg-gray-50 font-medium ${opt === value ? 'text-blue-600' : 'text-gray-700'}`}>{opt}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CustomerCell (1차 상담 연결) ──────────────────────
function CustomerCell({ value, customerId, customers, onSave }: {
  value: string; customerId: string | null; customers: CustomerOption[]
  onSave: (name: string, cid: string | null, contact: string | null, assignee: string | null, source: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => { setOpen(false); setQuery('') })
  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: r.left, width: 220 }
      if (window.innerHeight - r.bottom < 240) s.bottom = window.innerHeight - r.top + 4; else s.top = r.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v); setQuery('')
  }
  const filtered = customers.filter(c => !query || c.client_name.toLowerCase().includes(query.toLowerCase()) || c.contact?.includes(query)).slice(0, 8)
  const select = (c: CustomerOption) => { onSave(c.client_name, c.id, c.contact, c.assignee, c.source); setOpen(false); setQuery('') }
  const clearLink = (e: React.MouseEvent) => { e.stopPropagation(); onSave(value, null, null, null, null) }
  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <div ref={btnRef} onClick={handleOpen}
        className="flex-1 cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db', fontWeight: value ? 500 : 400 }}>
        {value || '고객명'}
      </div>
      {customerId && <span title="1차 상담 연결됨" className="flex-shrink-0"><Link2 className="h-3 w-3 text-blue-400" /></span>}
      {open && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden" style={popupStyle}>
          <div className="p-2 border-b border-gray-100">
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="고객 검색..."
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400" />
          </div>
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">검색 결과 없음</div>
            ) : filtered.map(c => (
              <button key={c.id} onClick={() => select(c)}
                className={cn('w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 transition-colors', customerId === c.id && 'bg-blue-50')}>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-800 truncate">{c.client_name}</div>
                  {c.contact && <div className="text-[10px] text-gray-400">{c.contact}</div>}
                </div>
                {customerId === c.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
              </button>
            ))}
          </div>
          {customerId && (
            <div className="border-t border-gray-100 p-1.5">
              <button onClick={clearLink} className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-red-400 hover:bg-red-50 rounded-lg transition-colors">
                <X className="h-3 w-3" />연결 해제
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── ColumnHeader ─────────────────────────────────────
function ColumnHeader({ label, fixed, hasOptions, options, onSetOptions, onHide }: {
  label: string; fixed?: boolean; hasOptions?: boolean
  options?: string[]; onSetOptions?: (opts: string[]) => void; onHide?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [newOpt, setNewOpt] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => setOpen(false))
  const canOpen = !fixed || hasOptions
  const handleOpen = (e: React.MouseEvent) => {
    if (!canOpen) return
    e.stopPropagation()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setStyle({ position: 'fixed', zIndex: 9999, top: r.bottom + 2, left: Math.min(r.left, window.innerWidth - 210), minWidth: 190 })
    }
    setOpen(v => !v)
  }
  const addOpt = () => {
    const v = newOpt.trim()
    if (!v || !options || options.includes(v)) return
    onSetOptions?.([...options, v]); setNewOpt('')
  }
  return (
    <div ref={containerRef} className="relative">
      <div ref={btnRef} onClick={handleOpen} className={cn('flex items-center gap-1 select-none', canOpen && 'cursor-pointer group')}>
        <span className="text-xs font-semibold text-gray-500">{label}</span>
        {canOpen && <ChevronDown className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />}
      </div>
      {open && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={style} onClick={e => e.stopPropagation()}>
          <div className="px-3 py-2 border-b border-gray-100 text-xs font-bold text-gray-700">{label}</div>
          {!fixed && (
            <button onClick={() => { onHide?.(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
              <EyeOff className="h-3.5 w-3.5 text-gray-400" />이 칼럼 숨기기
            </button>
          )}
          {hasOptions && options && (
            <>
              {!fixed && <div className="border-t border-gray-100" />}
              <div className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">선택 항목</div>
              <div className="px-2 pb-1 max-h-44 overflow-y-auto">
                {options.map(opt => (
                  <div key={opt} className="group/opt flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-gray-50">
                    <span className="flex-1 text-xs text-gray-700">{opt}</span>
                    <button onClick={() => onSetOptions?.(options.filter(o => o !== opt))}
                      className="opacity-0 group-hover/opt:opacity-100 flex h-4 w-4 items-center justify-center rounded text-gray-300 hover:text-red-400 transition-all">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-2 pb-2 pt-1 flex gap-1.5 border-t border-gray-100">
                <input value={newOpt} onChange={e => setNewOpt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addOpt() }}
                  placeholder="항목 추가..."
                  className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-400 min-w-0" />
                <button onClick={addOpt} className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 flex-shrink-0">추가</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── ColAdder ──────────────────────────────────────────
function ColAdder({ cols, visibleCols, onShow }: {
  cols: ColDef[]; visibleCols: string[]; onShow: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => setOpen(false))
  const hidden = cols.filter(c => !c.fixed && !visibleCols.includes(c.key))
  if (hidden.length === 0) return null
  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setStyle({ position: 'fixed', zIndex: 9999, top: r.bottom + 2, right: Math.max(4, window.innerWidth - r.right), minWidth: 140 })
    }
    setOpen(v => !v)
  }
  return (
    <div ref={containerRef} className="relative">
      <div ref={btnRef} onClick={handleOpen}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-500 cursor-pointer transition-colors text-sm font-bold leading-none">+</div>
      {open && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={style} onClick={e => e.stopPropagation()}>
          <div className="px-3 py-2 border-b border-gray-100 text-xs font-bold text-gray-700">칼럼 추가</div>
          {hidden.map(col => (
            <button key={col.key} onClick={() => { onShow(col.key); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
              <span className="text-gray-300 font-bold">+</span>{col.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────
export default function BrokerDiaryPage() {
  const supabase = createClient()
  const router = useRouter()

  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [consultations, setConsultations] = useState<Consultation[]>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [monthFilter, setMonthFilter] = useState(() => new Date().toISOString().slice(0, 7))
  const [assigneeFilter, setAssigneeFilter] = useState('전체')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)

  // 칼럼 설정 (localStorage)
  const [visibleCols, setVisibleCols] = useState<string[]>(
    DIARY_COLS.filter(c => !c.fixed).map(c => c.key)
  )
  const [customOpts, setCustomOpts] = useState<Record<string, string[]>>(DEFAULT_OPTS)
  const [colsReady, setColsReady] = useState(false)

  useEffect(() => {
    try {
      const v = localStorage.getItem(VISIBLE_KEY)
      if (v) setVisibleCols(JSON.parse(v))
      const o = localStorage.getItem(OPTS_KEY)
      if (o) setCustomOpts(prev => ({ ...prev, ...JSON.parse(o) }))
    } catch {}
    setColsReady(true)
  }, [])

  useEffect(() => { if (colsReady) localStorage.setItem(VISIBLE_KEY, JSON.stringify(visibleCols)) }, [visibleCols, colsReady])
  useEffect(() => { if (colsReady) localStorage.setItem(OPTS_KEY, JSON.stringify(customOpts)) }, [customOpts, colsReady])

  const showCol = (key: string) => {
    setVisibleCols(prev => {
      const order = DIARY_COLS.filter(c => !c.fixed).map(c => c.key)
      return order.filter(k => k === key || prev.includes(k))
    })
  }
  const hideCol = (key: string) => setVisibleCols(prev => prev.filter(k => k !== key))
  const setOpts = (key: string, opts: string[]) => setCustomOpts(prev => ({ ...prev, [key]: opts }))

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { router.push('/auth/login'); return }
    setUser(u)
    const [{ data: prof }, { data: b }] = await Promise.all([
      supabase.from('profiles').select('name').eq('id', u.id).single(),
      supabase.from('broker_profiles').select('*').eq('user_id', u.id).single(),
    ])
    if (!b) { router.push('/broker/register'); return }
    setProfile(prof); setBroker(b)
    const owner = b.is_owner !== false
    setIsOwner(owner)
    let brokerIds: string[] = [b.id]
    if (owner) {
      const { data: employees } = await supabase.from('broker_profiles').select('id').eq('parent_broker_id', b.id)
      if (employees) brokerIds = [b.id, ...employees.map((e: any) => e.id)]
    }
    const [{ data: cons }, { data: custs }] = await Promise.all([
      supabase.from('broker_consultations').select('*').in('broker_id', brokerIds)
        .order('consulted_at', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('broker_customers').select('id, client_name, contact, assignee, source')
        .in('broker_id', brokerIds).order('received_date', { ascending: false }),
    ])
    setConsultations(cons ?? [])
    setCustomers(custs ?? [])
    setLoading(false)
  }

  const saveField = useCallback(async (id: string, field: string, value: any) => {
    await supabase.from('broker_consultations').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id)
    setConsultations(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }, [])

  const saveCustomerLink = useCallback(async (
    id: string, name: string, customerId: string | null,
    contact: string | null, assignee: string | null, source: string | null
  ) => {
    const updates: any = { client_name: name, customer_id: customerId, updated_at: new Date().toISOString() }
    if (customerId) { updates.contact = contact; updates.assignee = assignee; updates.source = source }
    await supabase.from('broker_consultations').update(updates).eq('id', id)
    setConsultations(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c))
  }, [])

  const addRow = async () => {
    if (!broker) return
    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await supabase.from('broker_consultations').insert({
      broker_id: broker.id, consulted_at: today, client_name: '',
      assignee: profile?.name ?? null, status: customOpts.status?.[0] ?? '잠재',
    }).select().single()
    if (error || !data) return
    setConsultations(prev => [data, ...prev])
    setAddingId(data.id); setTimeout(() => setAddingId(null), 2000)
  }

  const deleteRow = async (id: string) => {
    await supabase.from('broker_consultations').delete().eq('id', id)
    setConsultations(prev => prev.filter(c => c.id !== id))
    setDeleteConfirm(null)
  }

  const months = (() => {
    const set = new Set<string>()
    consultations.forEach(c => { if (c.consulted_at) set.add(c.consulted_at.slice(0, 7)) })
    set.add(new Date().toISOString().slice(0, 7))
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  })()

  const assignees = (() => {
    const set = new Set<string>()
    consultations.forEach(c => { if (c.assignee) set.add(c.assignee) })
    return ['전체', ...Array.from(set).sort()]
  })()

  const filtered = consultations.filter(c => {
    if (monthFilter && !c.consulted_at?.startsWith(monthFilter)) return false
    if (assigneeFilter !== '전체' && c.assignee !== assigneeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return c.client_name?.toLowerCase().includes(q) || c.contact?.includes(q) ||
        c.assignee?.toLowerCase().includes(q) || c.memo?.toLowerCase().includes(q)
    }
    return true
  })

  const formatMonth = (m: string) => { const [y, mo] = m.split('-'); return `${y.slice(2)}년 ${parseInt(mo)}월` }

  // 활성 칼럼
  const activeCols = DIARY_COLS.filter(c => c.fixed || visibleCols.includes(c.key))

  const renderCell = (c: Consultation, col: ColDef) => {
    const opts = customOpts[col.key] ?? col.defaultOpts ?? []
    const colorMap = COL_COLORS[col.key]
    switch (col.key) {
      case 'consulted_at': return <TextCell value={c.consulted_at} onSave={v => saveField(c.id, 'consulted_at', v || null)} placeholder="날짜" />
      case 'client_name':
        return (
          <CustomerCell value={c.client_name} customerId={c.customer_id} customers={customers}
            onSave={(name, cid, contact, assignee, source) => saveCustomerLink(c.id, name, cid, contact, assignee, source)} />
        )
      case 'contact':   return <TextCell value={c.contact} onSave={v => saveField(c.id, 'contact', v || null)} placeholder="연락처" />
      case 'amount':    return <TextCell value={c.amount} onSave={v => saveField(c.id, 'amount', v || null)} placeholder="예: 5000/300" />
      case 'assignee':  return <TextCell value={c.assignee} onSave={v => saveField(c.id, 'assignee', v || null)} placeholder="담당자" />
      case 'source':    return <SelectCell value={c.source} options={opts} onSave={v => saveField(c.id, 'source', v)} colorMap={colorMap} />
      case 'region':    return <TextCell value={c.region} onSave={v => saveField(c.id, 'region', v || null)} placeholder="지역" />
      case 'interest':  return <SelectCell value={c.interest} options={opts} onSave={v => saveField(c.id, 'interest', v)} />
      case 'status':    return <SelectCell value={c.status} options={opts} onSave={v => saveField(c.id, 'status', v)} colorMap={colorMap} />
      case 'memo':      return <LongTextCell value={c.memo} onSave={v => saveField(c.id, 'memo', v || null)} placeholder="상담내용" />
      default: return null
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm">불러오는 중...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-screen-xl px-4 py-6">

        {/* 헤더 */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900">업무일지</h1>
            <p className="text-sm text-gray-400 mt-0.5">{formatMonth(monthFilter)} · {filtered.length}건</p>
          </div>
          <button onClick={addRow}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors shadow-sm">
            <Plus className="h-4 w-4" />상담 추가
          </button>
        </div>

        {/* 월 탭 */}
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {months.map(m => (
            <button key={m} onClick={() => setMonthFilter(m)}
              className={cn('flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                monthFilter === m ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300')}>
              {formatMonth(m)}
              <span className="ml-1.5 text-[10px] opacity-60">{consultations.filter(c => c.consulted_at?.startsWith(m)).length}</span>
            </button>
          ))}
        </div>

        {/* 필터 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="고객명, 연락처, 상담내용..."
              className="w-full rounded-xl border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20" />
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

        {/* 안내 */}
        <div className="mb-3 flex items-center gap-1.5 text-xs text-gray-400">
          <Link2 className="h-3 w-3" />
          <span>고객명 클릭 시 1차 상담(고객목록)에서 연결할 수 있어요</span>
        </div>

        {/* 테이블 */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="w-8 px-3 py-2.5 text-center text-xs font-semibold text-gray-400">#</th>
                  {activeCols.map(col => (
                    <th key={col.key} className="px-3 py-2.5 text-left" style={{ minWidth: col.minWidth }}>
                      <ColumnHeader
                        label={col.label} fixed={col.fixed} hasOptions={col.hasOptions}
                        options={customOpts[col.key]} onSetOptions={opts => setOpts(col.key, opts)}
                        onHide={() => hideCol(col.key)}
                      />
                    </th>
                  ))}
                  <th className="w-10 px-2 py-2.5 text-center">
                    <ColAdder cols={DIARY_COLS} visibleCols={visibleCols} onShow={showCol} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={activeCols.length + 2} className="py-16 text-center text-sm text-gray-400">
                      {consultations.length === 0 ? '상담 추가 버튼으로 첫 기록을 남겨보세요' : '검색 결과가 없어요'}
                    </td>
                  </tr>
                ) : filtered.map((c, idx) => (
                  <tr key={c.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', addingId === c.id && 'animate-pulse bg-blue-50/40')}>
                    <td className="px-3 py-1.5 text-center text-xs text-gray-300 font-mono">{filtered.length - idx}</td>
                    {activeCols.map(col => (
                      <td key={col.key} className="px-3 py-1.5">{renderCell(c, col)}</td>
                    ))}
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => setDeleteConfirm(c.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 삭제 확인 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">상담 기록을 삭제할까요?</h3>
            <p className="text-sm text-gray-500 mb-6">삭제하면 복구할 수 없어요.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">취소</button>
              <button onClick={() => deleteRow(deleteConfirm)} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
