'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Search, Link2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── 상수 ──────────────────────────────────────────────
const SOURCES = ['당근', '플레이스', '네이버광고', '네이버블로그', '공동', '지인', '특톡', '기타']
const INTERESTS = ['상가', '주거용', '공장', '창고', '사무실', '토지', '기타']
const STATUSES = ['잠재', '진행중', '종료', '계약완료']

const SOURCE_COLORS: Record<string, string> = {
  '당근': 'bg-orange-100 text-orange-700',
  '플레이스': 'bg-sky-100 text-sky-700',
  '네이버광고': 'bg-green-100 text-green-700',
  '네이버블로그': 'bg-green-100 text-green-700',
  '공동': 'bg-purple-100 text-purple-700',
  '지인': 'bg-pink-100 text-pink-700',
  '특톡': 'bg-yellow-100 text-yellow-700',
  '기타': 'bg-gray-100 text-gray-600',
}
const STATUS_COLORS: Record<string, string> = {
  '잠재': 'bg-gray-100 text-gray-600',
  '진행중': 'bg-blue-100 text-blue-700',
  '종료': 'bg-red-100 text-red-600',
  '계약완료': 'bg-green-100 text-green-700',
}

// ── 타입 ──────────────────────────────────────────────
interface Consultation {
  id: string
  customer_id: string | null
  consulted_at: string
  client_name: string
  contact: string | null
  amount: string | null
  assignee: string | null
  source: string | null
  region: string | null
  interest: string | null
  status: string
  memo: string | null
  created_at: string
}

interface CustomerOption {
  id: string
  client_name: string
  contact: string | null
  assignee: string | null
  source: string | null
}

// ── useClickOutside ──────────────────────────────────
function useClickOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, cb])
}

// ── CellTooltip ──────────────────────────────────────
function CellTooltip({ text, anchorRef }: { text: string; anchorRef: React.RefObject<HTMLElement | null> }) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (!anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, top: rect.bottom + 4, maxWidth: 320, minWidth: 120 }
    if (rect.left + 320 > window.innerWidth) s.right = window.innerWidth - rect.right
    else s.left = rect.left
    setStyle(s)
  }, [anchorRef])
  return (
    <div className="pointer-events-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700 shadow-xl leading-relaxed whitespace-pre-wrap" style={style}>
      {text}
    </div>
  )
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

  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
        className="w-full rounded border border-blue-400 bg-white px-2 py-0.5 text-xs outline-none focus:ring-2 focus:ring-blue-300"
      />
    )
  }
  return (
    <>
      <div ref={cellRef}
        onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db' }}
      >
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

  if (editing) {
    return (
      <textarea ref={textareaRef} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
        rows={3}
        className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300 resize-none min-w-[180px]"
      />
    )
  }
  return (
    <>
      <div ref={cellRef}
        onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden"
        style={{ color: value ? '#374151' : '#d1d5db', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}
      >
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
      const rect = btnRef.current.getBoundingClientRect()
      const openUp = window.innerHeight - rect.bottom < 200
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: rect.left }
      if (openUp) s.bottom = window.innerHeight - rect.top + 4
      else s.top = rect.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v)
  }

  const display = value || '—'
  return (
    <div ref={ref} className="relative">
      <div ref={btnRef} onClick={handleOpen}
        className={`cursor-pointer rounded px-2 py-0.5 text-xs font-semibold inline-flex items-center hover:opacity-80 ${value ? (colorMap?.[value] ?? 'bg-gray-100 text-gray-600') : 'bg-gray-50 text-gray-300'}`}
      >
        {display}
      </div>
      {open && (
        <div className="flex flex-col min-w-[110px] rounded-xl border border-gray-200 bg-white shadow-lg py-1" style={popupStyle}>
          {options.map(opt => (
            <button key={opt} onClick={() => { onSave(opt); setOpen(false) }}
              className={`px-3 py-1.5 text-left text-xs hover:bg-gray-50 font-medium ${opt === value ? 'text-blue-600' : 'text-gray-700'}`}
            >{opt}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CustomerCell (1차 상담 연결) ──────────────────────
function CustomerCell({ value, customerId, customers, onSave }: {
  value: string; customerId: string | null; customers: CustomerOption[];
  onSave: (name: string, customerId: string | null, contact: string | null, assignee: string | null, source: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => { setOpen(false); setQuery('') })

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const openUp = window.innerHeight - rect.bottom < 240
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: rect.left, width: 220 }
      if (openUp) s.bottom = window.innerHeight - rect.top + 4
      else s.top = rect.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v)
    setQuery('')
  }

  const filtered = customers.filter(c =>
    !query || c.client_name.toLowerCase().includes(query.toLowerCase()) || c.contact?.includes(query)
  ).slice(0, 8)

  const select = (c: CustomerOption) => {
    onSave(c.client_name, c.id, c.contact, c.assignee, c.source)
    setOpen(false); setQuery('')
  }

  const clearLink = (e: React.MouseEvent) => {
    e.stopPropagation()
    onSave(value, null, null, null, null)
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <div ref={btnRef} onClick={handleOpen}
        className="flex-1 cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db', fontWeight: value ? 500 : 400 }}
      >
        {value || '고객명'}
      </div>
      {customerId && (
        <span title="1차 상담 연결됨" className="flex-shrink-0">
          <Link2 className="h-3 w-3 text-blue-400" />
        </span>
      )}
      {open && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden" style={popupStyle}>
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="고객 검색..."
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400"
            />
          </div>
          <div className="max-h-44 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-xs text-gray-400 text-center">검색 결과 없음</div>
            ) : (
              filtered.map(c => (
                <button key={c.id} onClick={() => select(c)}
                  className={cn('w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blue-50 transition-colors',
                    customerId === c.id && 'bg-blue-50')}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-gray-800 truncate">{c.client_name}</div>
                    {c.contact && <div className="text-[10px] text-gray-400">{c.contact}</div>}
                  </div>
                  {customerId === c.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
          {customerId && (
            <div className="border-t border-gray-100 p-1.5">
              <button onClick={clearLink}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-red-400 hover:bg-red-50 rounded-lg transition-colors"
              >
                <X className="h-3 w-3" />연결 해제
              </button>
            </div>
          )}
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
    setProfile(prof)
    setBroker(b)

    const owner = b.is_owner !== false
    setIsOwner(owner)

    let brokerIds: string[] = [b.id]
    if (owner) {
      const { data: employees } = await supabase
        .from('broker_profiles').select('id').eq('parent_broker_id', b.id)
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
      broker_id: broker.id,           // 항상 본인 ID
      consulted_at: today,
      client_name: '',
      assignee: profile?.name ?? null, // 담당자 자동 입력
      status: '잠재',
    }).select().single()
    if (error || !data) return
    setConsultations(prev => [data, ...prev])
    setAddingId(data.id)
    setTimeout(() => setAddingId(null), 2000)
  }

  const deleteRow = async (id: string) => {
    await supabase.from('broker_consultations').delete().eq('id', id)
    setConsultations(prev => prev.filter(c => c.id !== id))
    setDeleteConfirm(null)
  }

  // 월 목록
  const months = (() => {
    const set = new Set<string>()
    consultations.forEach(c => { if (c.consulted_at) set.add(c.consulted_at.slice(0, 7)) })
    // 이번달 없어도 항상 포함
    const thisMonth = new Date().toISOString().slice(0, 7)
    set.add(thisMonth)
    return Array.from(set).sort((a, b) => b.localeCompare(a))
  })()

  // 담당자 목록
  const assignees = (() => {
    const set = new Set<string>()
    consultations.forEach(c => { if (c.assignee) set.add(c.assignee) })
    return ['전체', ...Array.from(set).sort()]
  })()

  // 필터링
  const filtered = consultations.filter(c => {
    if (monthFilter && !c.consulted_at?.startsWith(monthFilter)) return false
    if (assigneeFilter !== '전체' && c.assignee !== assigneeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (c.client_name?.toLowerCase().includes(q) ||
        c.contact?.includes(q) ||
        c.assignee?.toLowerCase().includes(q) ||
        c.memo?.toLowerCase().includes(q))
    }
    return true
  })

  // 월 표시 형식
  const formatMonth = (m: string) => {
    const [y, mo] = m.split('-')
    return `${y.slice(2)}년 ${parseInt(mo)}월`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">불러오는 중...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />

      <div className="mx-auto max-w-screen-xl px-4 py-6">

        {/* 헤더 */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900">업무일지</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              {formatMonth(monthFilter)} · {filtered.length}건
            </p>
          </div>
          <button onClick={addRow}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            상담 추가
          </button>
        </div>

        {/* 월 탭 */}
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {months.map(m => (
            <button key={m} onClick={() => setMonthFilter(m)}
              className={cn('flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                monthFilter === m ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
              )}
            >
              {formatMonth(m)}
              <span className="ml-1.5 text-[10px] opacity-60">
                {consultations.filter(c => c.consulted_at?.startsWith(m)).length}
              </span>
            </button>
          ))}
        </div>

        {/* 필터 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="고객명, 연락처, 상담내용..."
              className="w-full rounded-xl border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
            />
          </div>
          {/* 담당자 필터 — 대표만 표시 */}
          {isOwner && assignees.length > 1 && (
            <div className="flex gap-1 flex-wrap">
              {assignees.map(a => (
                <button key={a} onClick={() => setAssigneeFilter(a)}
                  className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                    assigneeFilter === a ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
                  )}
                >{a}</button>
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
                  <th className="w-24 px-3 py-2.5 text-left text-xs font-semibold text-gray-500">날짜</th>
                  <th className="min-w-[130px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">고객명</th>
                  <th className="min-w-[120px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">연락처</th>
                  <th className="min-w-[90px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">금액</th>
                  <th className="min-w-[80px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">담당자</th>
                  <th className="min-w-[90px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">유입경로</th>
                  <th className="min-w-[80px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">지역</th>
                  <th className="min-w-[80px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">관심물건</th>
                  <th className="min-w-[90px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">진행상황</th>
                  <th className="min-w-[200px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">상담내용</th>
                  <th className="w-8 px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="py-16 text-center text-sm text-gray-400">
                      {consultations.length === 0
                        ? '상담 추가 버튼으로 첫 기록을 남겨보세요'
                        : '검색 결과가 없어요'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((c, idx) => (
                    <tr key={c.id}
                      className={cn(
                        'border-b border-gray-50 hover:bg-gray-50/50 transition-colors',
                        addingId === c.id && 'animate-pulse bg-blue-50/40'
                      )}
                    >
                      <td className="px-3 py-1.5 text-center text-xs text-gray-300 font-mono">{filtered.length - idx}</td>
                      <td className="px-3 py-1.5">
                        <TextCell value={c.consulted_at} onSave={v => saveField(c.id, 'consulted_at', v || null)} placeholder="날짜" />
                      </td>
                      <td className="px-3 py-1.5">
                        <CustomerCell
                          value={c.client_name}
                          customerId={c.customer_id}
                          customers={customers}
                          onSave={(name, cid, contact, assignee, source) =>
                            saveCustomerLink(c.id, name, cid, contact, assignee, source)
                          }
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <TextCell value={c.contact} onSave={v => saveField(c.id, 'contact', v || null)} placeholder="연락처" />
                      </td>
                      <td className="px-3 py-1.5">
                        <TextCell value={c.amount} onSave={v => saveField(c.id, 'amount', v || null)} placeholder="예: 5000/300" />
                      </td>
                      <td className="px-3 py-1.5">
                        <TextCell value={c.assignee} onSave={v => saveField(c.id, 'assignee', v || null)} placeholder="담당자" />
                      </td>
                      <td className="px-3 py-1.5">
                        <SelectCell value={c.source} options={SOURCES} onSave={v => saveField(c.id, 'source', v)} colorMap={SOURCE_COLORS} />
                      </td>
                      <td className="px-3 py-1.5">
                        <TextCell value={c.region} onSave={v => saveField(c.id, 'region', v || null)} placeholder="지역" />
                      </td>
                      <td className="px-3 py-1.5">
                        <SelectCell value={c.interest} options={INTERESTS} onSave={v => saveField(c.id, 'interest', v)} />
                      </td>
                      <td className="px-3 py-1.5">
                        <SelectCell value={c.status} options={STATUSES} onSave={v => saveField(c.id, 'status', v)} colorMap={STATUS_COLORS} />
                      </td>
                      <td className="px-3 py-1.5">
                        <LongTextCell value={c.memo} onSave={v => saveField(c.id, 'memo', v || null)} placeholder="상담내용" />
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => setDeleteConfirm(c.id)}
                          className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
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
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
              >취소</button>
              <button onClick={() => deleteRow(deleteConfirm)}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600"
              >삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
