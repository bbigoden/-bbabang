'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Search, Users, TrendingUp, CheckCircle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── 상수 ──────────────────────────────────────────────
const CATEGORIES = ['비주거', '주거용']
const SOURCES = ['당근', '플레이스', '네이버광고', '네이버블로그', '공동', '지인', '특톡', '기타']
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
const CATEGORY_COLORS: Record<string, string> = {
  '비주거': 'bg-amber-100 text-amber-700',
  '주거용': 'bg-sky-100 text-sky-700',
}

// ── 타입 ──────────────────────────────────────────────
interface Customer {
  id: string
  client_name: string
  contact: string | null
  received_date: string | null
  assignee: string | null
  category: string
  source: string | null
  status: string
  created_at: string
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

// ── SelectCell ──────────────────────────────────────────
function SelectCell({ value, options, onSave, colorMap }: {
  value: string; options: string[]; onSave: (v: string) => void; colorMap?: Record<string, string>
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

  return (
    <div ref={ref} className="relative">
      <div ref={btnRef} onClick={handleOpen}
        className={`cursor-pointer rounded px-2 py-0.5 text-xs font-semibold inline-flex items-center gap-1 hover:opacity-80 ${colorMap?.[value] ?? 'bg-gray-100 text-gray-600'}`}
      >
        {value || '—'}
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

// ── 메인 페이지 ──────────────────────────────────────
export default function BrokerCustomersPage() {
  const supabase = createClient()
  const router = useRouter()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [monthFilter, setMonthFilter] = useState('전체')
  const [assigneeFilter, setAssigneeFilter] = useState('전체')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)

  useEffect(() => { init() }, [])

  const getRootBrokerId = (b: any) =>
    b.is_owner !== false ? b.id : (b.parent_broker_id ?? b.id)

  const init = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
    if (!u) { router.push('/auth/login'); return }
    setUser(u)
    const { data: b } = await supabase.from('broker_profiles').select('*').eq('user_id', u.id).single()
    if (!b) { router.push('/broker/register'); return }
    setBroker(b)
    const rootId = b.is_owner !== false ? b.id : (b.parent_broker_id ?? b.id)
    const { data } = await supabase
      .from('broker_customers')
      .select('*')
      .eq('broker_id', rootId)
      .order('received_date', { ascending: false })
      .order('created_at', { ascending: false })
    setCustomers(data ?? [])
    setLoading(false)
  }

  const saveField = useCallback(async (id: string, field: string, value: any) => {
    await supabase.from('broker_customers').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id)
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }, [])

  const addRow = async () => {
    if (!broker) return
    const rootId = getRootBrokerId(broker)
    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await supabase.from('broker_customers').insert({
      broker_id: rootId,
      client_name: '',
      received_date: today,
      category: '비주거',
      status: '잠재',
    }).select().single()
    if (error || !data) return
    setCustomers(prev => [data, ...prev])
    setAddingId(data.id)
    setTimeout(() => setAddingId(null), 2000)
  }

  const deleteRow = async (id: string) => {
    await supabase.from('broker_customers').delete().eq('id', id)
    setCustomers(prev => prev.filter(c => c.id !== id))
    setDeleteConfirm(null)
  }

  // 월 목록 생성
  const months = (() => {
    const set = new Set<string>()
    customers.forEach(c => {
      if (c.received_date) set.add(c.received_date.slice(0, 7))
    })
    return ['전체', ...Array.from(set).sort((a, b) => b.localeCompare(a))]
  })()

  // 담당자 목록
  const assignees = (() => {
    const set = new Set<string>()
    customers.forEach(c => { if (c.assignee) set.add(c.assignee) })
    return ['전체', ...Array.from(set).sort()]
  })()

  // 필터링
  const filtered = customers.filter(c => {
    if (monthFilter !== '전체' && (!c.received_date || !c.received_date.startsWith(monthFilter))) return false
    if (assigneeFilter !== '전체' && c.assignee !== assigneeFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (c.client_name?.toLowerCase().includes(q) ||
        c.contact?.includes(q) ||
        c.assignee?.toLowerCase().includes(q))
    }
    return true
  })

  // 통계
  const thisMonth = new Date().toISOString().slice(0, 7)
  const statsBase = assigneeFilter !== '전체'
    ? customers.filter(c => c.assignee === assigneeFilter)
    : customers
  const newThisMonth = statsBase.filter(c => c.received_date?.startsWith(thisMonth)).length
  const inProgress = statsBase.filter(c => c.status === '진행중').length
  const contracted = statsBase.filter(c => c.status === '계약완료').length

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
            <h1 className="text-2xl font-black text-gray-900">고객목록</h1>
            <p className="text-sm text-gray-400 mt-0.5">전체 {customers.length}명 · 검색 {filtered.length}명</p>
          </div>
          <button onClick={addRow}
            className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            고객 추가
          </button>
        </div>

        {/* 통계 */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          {[
            { icon: Users, label: '이번달 신규', value: newThisMonth, color: 'text-blue-600', bg: 'bg-blue-50' },
            { icon: TrendingUp, label: '진행중', value: inProgress, color: 'text-orange-600', bg: 'bg-orange-50' },
            { icon: CheckCircle, label: '계약완료', value: contracted, color: 'text-green-600', bg: 'bg-green-50' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl bg-white border border-gray-100 px-4 py-4 shadow-sm">
              <div className="flex items-center gap-2 mb-1">
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${s.bg}`}>
                  <s.icon className={`h-3.5 w-3.5 ${s.color}`} />
                </div>
                <span className="text-xs text-gray-500">{s.label}</span>
              </div>
              <div className={`text-2xl font-black ${s.color}`}>{s.value}<span className="text-sm font-normal text-gray-400 ml-1">명</span></div>
            </div>
          ))}
        </div>

        {/* 필터 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* 검색 */}
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="고객명, 연락처, 담당자..."
              className="w-full rounded-xl border border-gray-200 bg-white pl-8 pr-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
            />
          </div>

          {/* 담당자 필터 */}
          {assignees.length > 1 && (
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

        {/* 월 탭 */}
        <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {months.map(m => (
            <button key={m} onClick={() => setMonthFilter(m)}
              className={cn('flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                monthFilter === m ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
              )}
            >
              {m === '전체' ? '전체' : (() => {
                const [y, mo] = m.split('-')
                return `${y.slice(2)}년 ${parseInt(mo)}월`
              })()}
              {m !== '전체' && (
                <span className="ml-1.5 text-[10px] opacity-60">
                  {customers.filter(c => c.received_date?.startsWith(m)).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 테이블 */}
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="w-8 px-3 py-2.5 text-center text-xs font-semibold text-gray-400">#</th>
                  <th className="min-w-[140px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">고객명</th>
                  <th className="min-w-[90px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">접수일자</th>
                  <th className="min-w-[120px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">연락처</th>
                  <th className="min-w-[80px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">담당자</th>
                  <th className="min-w-[72px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">구분</th>
                  <th className="min-w-[90px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">유입경로</th>
                  <th className="min-w-[90px] px-3 py-2.5 text-left text-xs font-semibold text-gray-500">진행상황</th>
                  <th className="w-8 px-2 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-16 text-center text-sm text-gray-400">
                      {customers.length === 0 ? '아직 등록된 고객이 없어요' : '검색 결과가 없어요'}
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
                        <TextCell value={c.client_name} onSave={v => saveField(c.id, 'client_name', v)} placeholder="고객명" />
                      </td>
                      <td className="px-3 py-1.5">
                        <TextCell value={c.received_date} onSave={v => saveField(c.id, 'received_date', v || null)} placeholder="날짜" />
                      </td>
                      <td className="px-3 py-1.5">
                        <TextCell value={c.contact} onSave={v => saveField(c.id, 'contact', v || null)} placeholder="연락처" />
                      </td>
                      <td className="px-3 py-1.5">
                        <TextCell value={c.assignee} onSave={v => saveField(c.id, 'assignee', v || null)} placeholder="담당자" />
                      </td>
                      <td className="px-3 py-1.5">
                        <SelectCell value={c.category} options={CATEGORIES} onSave={v => saveField(c.id, 'category', v)} colorMap={CATEGORY_COLORS} />
                      </td>
                      <td className="px-3 py-1.5">
                        <SelectCell value={c.source ?? '기타'} options={SOURCES} onSave={v => saveField(c.id, 'source', v)} colorMap={SOURCE_COLORS} />
                      </td>
                      <td className="px-3 py-1.5">
                        <SelectCell value={c.status} options={STATUSES} onSave={v => saveField(c.id, 'status', v)} colorMap={STATUS_COLORS} />
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
            <h3 className="text-lg font-bold text-gray-900 mb-2">고객을 삭제할까요?</h3>
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
