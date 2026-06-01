'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, ChevronLeft, ChevronRight, Eye, MoreHorizontal, X, Download, ArrowUp, ArrowDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useColSettings, ColSettings } from '@/lib/use-col-settings'
import { useSheetDirection } from '@/lib/use-sheet-direction'
import { useClickOutside } from '@/lib/use-click-outside'
import { ColumnHeader } from '@/components/sheet/column-header'
import { SheetActionCell, SheetActionHeader } from '@/components/sheet/action-cell'
import { DateCell } from '@/components/sheet/cells/date-cell'
import { TextCell } from '@/components/sheet/cells/text-cell'
import { LongTextCell } from '@/components/sheet/cells/long-text-cell'
import { SelectCell } from '@/components/sheet/cells/select-cell'
import { notifyOwnerOfBrokerAction } from '@/lib/notify-owner'

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
  { key: 'source',             label: '유입',     fixed: true, minWidth: 90,  hasOptions: true, defaultOpts: ['빠방','당근','플레이스','네이버광고','네이버블로그','공동','지인','특톡','기타'] },
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

const SOURCE_COLORS: Record<string, string> = {
  '빠방':'bg-blue-100 text-blue-700','당근':'bg-orange-100 text-orange-700',
  '플레이스':'bg-sky-100 text-sky-700','네이버광고':'bg-green-100 text-green-700',
  '네이버블로그':'bg-green-100 text-green-700','공동':'bg-purple-100 text-purple-700',
  '지인':'bg-pink-100 text-pink-700','특톡':'bg-yellow-100 text-yellow-700','기타':'bg-gray-100 text-gray-600',
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
}
interface DiaryCustomerRow {
  link_id: string   // broker_diary_customers.id
  sort_order: number
  proposed_property_ids: string[] | null
  id: string; client_name: string; contact: string | null; received_date: string | null
  assignee: string | null; category: string; source: string | null; status: string
  request: string | null; custom_fields: Record<string, string> | null
}

interface SectionDef { id: string; title: string }
const DEFAULT_SECTIONS: SectionDef[] = [
  { id: 's_work',     title: '업무요약' },
  { id: 's_ad',       title: '광고현황' },
  { id: 's_suggest',  title: '건의사항' },
  { id: 's_delivery', title: '전달사항' },
]



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
    if (!open && btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setPopStyle({ position: 'fixed', top: r.bottom + 4, left: Math.max(8, r.right - 210), zIndex: 9999 }) }
    setOpen(v => !v)
  }
  const add = () => { if (name.trim()) { onAdd(name.trim(), type); setName(''); setType('text'); setOpen(false) } }
  return (
    <div ref={containerRef} className="relative">
      <button ref={btnRef} onClick={handleOpen} className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-500 cursor-pointer transition-colors text-sm font-bold leading-none">+</button>
      {open && (
        <div className="flex flex-col gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl p-2.5" style={popStyle}>
          <input ref={inputRef} value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setOpen(false); setName('') } }} placeholder="칼럼 이름 입력" className="rounded-lg border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs outline-none focus:border-blue-400 w-44" />
          <div className="flex gap-1">
            <button onClick={() => setType('text')} className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${type === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>텍스트</button>
            <button onClick={() => setType('select')} className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${type === 'select' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200'}`}>선택</button>
          </div>
          <button onClick={add} disabled={!name.trim()} className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40">추가</button>
        </div>
      )}
    </div>
  )
}

// ── ColVisibility ─────────────────────────────────────
function ColVisibility({ fixedCols, optionalCols, customCols: _customCols, visible, onToggle }: {
  fixedCols: ColDef[]; optionalCols: ColDef[]; customCols: Array<{ id: string; name: string }>; visible: string[]; onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  useClickOutside(containerRef, () => setOpen(false))
  const handleOpen = () => {
    if (!open && btnRef.current) { const r = btnRef.current.getBoundingClientRect(); setPopStyle({ position: 'fixed', top: r.bottom + 4, left: Math.max(8, r.right - 260), zIndex: 9999, width: 260 }) }
    setOpen(v => !v)
  }
  const all = [...fixedCols.map(c => ({ key: c.key, label: c.label, fixed: true })), ...optionalCols.map(c => ({ key: c.key, label: c.label, fixed: false }))]
  const rows = search ? all.filter(c => c.label.includes(search)) : all
  return (
    <div ref={containerRef} className="relative">
      <button ref={btnRef} onClick={handleOpen} aria-label="더보기" className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-gray-200 hover:text-gray-500 cursor-pointer transition-colors"><MoreHorizontal className="h-3.5 w-3.5" /></button>
      {open && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl overflow-hidden" style={popStyle}>
          <div className="p-2 border-b border-gray-100 dark:border-gray-800"><input value={search} onChange={e => setSearch(e.target.value)} placeholder="속성을 검색하세요" autoFocus className="w-full rounded-lg border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-xs focus:outline-none focus:border-blue-400" /></div>
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800"><span className="text-xs font-medium text-gray-500">표에 표시하기</span></div>
          <div className="max-h-64 overflow-y-auto py-1">
            {rows.map(c => (
              <div key={c.key} className={`flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 ${c.fixed ? 'cursor-default' : 'cursor-pointer'}`} onClick={() => !c.fixed && onToggle(c.key)}>
                <span className={`text-xs font-medium ${c.fixed || visible.includes(c.key) ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500'}`}>{c.label}</span>
                <Eye className={`h-3.5 w-3.5 flex-shrink-0 ${c.fixed || visible.includes(c.key) ? 'text-gray-500' : 'text-gray-200'}`} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── ProposedPropertiesCell ────────────────────────────
function ProposedPropertiesCell({ propIds, allProperties, onOpen, onRemove, readOnly }: {
  propIds: string[] | null; allProperties: Property[]
  onOpen: () => void; onRemove: (id: string) => void; readOnly?: boolean
}) {
  const selected = (propIds ?? []).map(id => allProperties.find(p => p.id === id)).filter(Boolean) as Property[]
  const formatDetail = (p: Property) => {
    const price = p.deal_type === '월세'
      ? `${Math.round(p.price / 10000)}/${Math.round((p.monthly_rent ?? 0) / 10000)}만`
      : `${Math.round(p.price / 10000)}만`
    return `${p.deal_type} · ${p.room_type} · ${price}`
  }
  if (selected.length === 0) {
    if (readOnly) return <span className="text-xs text-gray-300 px-1">—</span>
    return (
      <button onClick={onOpen} className="flex items-center gap-1 px-1 py-0.5 text-xs text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors w-full">
        <Plus className="h-3 w-3" />매물 추가
      </button>
    )
  }
  return (
    <div className="flex flex-wrap gap-1 items-center px-1 py-0.5">
      {selected.map(p => (
        <span key={p.id} className="group/chip inline-flex items-center gap-1 rounded-lg bg-indigo-50 pl-1.5 pr-0.5 py-0.5 text-[11px] font-medium text-indigo-700 max-w-[180px]" title={`${p.seq_no != null ? `#${p.seq_no} ` : ''}${p.address || '주소없음'}\n${formatDetail(p)}`}>
          {p.seq_no != null && (
            <span className="flex-shrink-0 rounded bg-indigo-200/70 px-1 text-[10px] font-bold text-indigo-800 tabular-nums">{p.seq_no}</span>
          )}
          <span className="truncate">{p.address || '주소없음'}</span>
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
function PropertyPicker({ allProperties, selectedIds, onConfirm, onClose }: {
  allProperties: Property[]; selectedIds: string[]
  onConfirm: (ids: string[]) => void; onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds))
  const q = search.toLowerCase()
  const qDigits = search.replace(/[^0-9]/g, '')
  const filtered = allProperties.filter(p =>
    !search
    || (p.address ?? '').toLowerCase().includes(q)
    || (p.deal_type ?? '').includes(search)
    || (p.room_type ?? '').includes(search)
    || (qDigits !== '' && p.seq_no != null && String(p.seq_no).includes(qDigits))
  ).slice(0, 30)
  const toggle = (id: string) => {
    setSelected(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s })
  }
  const formatPrice = (p: Property) => {
    if (p.deal_type === '월세') return `${(p.price/10000).toFixed(0)}/${(p.monthly_rent??0)/10000}만`
    return `${(p.price/10000).toFixed(0)}만`
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">제안 매물 선택</h3>
          <button onClick={onClose} aria-label="닫기" className="text-gray-500 hover:text-gray-600 dark:text-gray-500"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800">
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="매물번호, 주소, 유형 검색..." className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0
            ? <div className="py-8 text-center text-sm text-gray-500">매물 없음</div>
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
function CustomerPicker({ allCustomers, linkedIds, ownerName, ownerBrokerId: _ownerBrokerId, onAddExisting, onCreateNew, onClose }: {
  allCustomers: Customer[]; linkedIds: Set<string>
  ownerName: string  // 일지 주인 이름 — 표시용
  ownerBrokerId: string | null  // 일지 주인 broker_id — 그 사람 소유 고객만 필터
  onAddExisting: (c: Customer) => void
  onCreateNew: () => void; onClose: () => void
}) {
  const [search, setSearch] = useState('')

  // 일지 주인 담당자(assignee) 매칭 + 아직 일지에 안 들어간 것만
  // broker_id가 아니라 assignee 이름으로 매칭 — 봇 등 다른 계정이 등록해도 담당자 일지에 보임
  const eligible = allCustomers.filter(c =>
    (!ownerName || c.assignee === ownerName) && !linkedIds.has(c.id)
  )

  const q = search.toLowerCase()
  const filtered = !q ? eligible : eligible.filter(c =>
    (c.request ?? '').toLowerCase().includes(q)
    || c.contact?.includes(search)
    || c.client_name?.toLowerCase().includes(q)
    || c.assignee?.toLowerCase().includes(q)
  )

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
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="요청사항, 연락처로 검색..."
            className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
        </div>

        {/* 테이블 */}
        <div className="flex-1 overflow-auto">
          {filtered.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-500">
              {search ? '검색 결과 없음' : (ownerName ? `${ownerName} 담당의 가능 고객이 없어요` : '추가 가능한 고객이 없어요')}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50/95 backdrop-blur text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <tr className="border-b border-gray-100 dark:border-gray-800">
                  <th className="px-3 py-2.5 text-left">요청사항</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">접수일자</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">연락처</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">담당자</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">구분</th>
                  <th className="px-3 py-2.5 text-left whitespace-nowrap">유입</th>
                  <th className="px-3 py-2.5" style={{ width: 64 }} />
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

// ── DiarySection (동적, 이름변경/삭제 가능) ───────────────
function DiarySection({ def, num, content, onSave, onRename, onDelete, readOnly }: {
  def: SectionDef; num: number; content: string | null
  onSave: (v: string) => void; onRename: (id: string, title: string) => void
  onDelete: (id: string) => void; readOnly?: boolean
}) {
  const [renaming, setRenaming] = useState(false)
  const [titleDraft, setTitleDraft] = useState(def.title)
  const [draft, setDraft] = useState(content ?? '')
  const [saving, setSaving] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  // textarea를 내용 줄 수에 맞춰 자동 늘어나게 (스크롤 없이)
  const autoSize = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
  useEffect(() => { setDraft(content ?? '') }, [content])
  useEffect(() => { setTitleDraft(def.title) }, [def.title])
  useEffect(() => { autoSize() }, [draft, readOnly])
  const commitRename = () => {
    if (titleDraft.trim() && titleDraft !== def.title) onRename(def.id, titleDraft.trim())
    setRenaming(false)
  }
  const handleBlur = async () => {
    if (draft === (content ?? '')) return
    setSaving(true); await onSave(draft); setSaving(false)
  }
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
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
        {!readOnly && !renaming && (
          <button onClick={() => onDelete(def.id)}
            className="ml-auto opacity-0 group-hover/header:opacity-100 flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-400 transition-all">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {readOnly
        ? <div className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap min-h-[60px]">{content || <span className="text-gray-300">—</span>}</div>
        : <textarea ref={taRef} value={draft}
            onChange={e => { setDraft(e.target.value); autoSize() }}
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
  const [_teamMembers, setTeamMembers] = useState<string[]>([])
  const [viewingBrokerId, setViewingBrokerId] = useState<string | null>(null) // null = 자기 자신
  const [viewingExEmployee, setViewingExEmployee] = useState(false) // true면 archive에서 읽음
  const [canEdit, setCanEdit] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [loading, setLoading] = useState(true)

  // Section 1 데이터
  const [diaryCustomers, setDiaryCustomers] = useState<DiaryCustomerRow[]>([])
  const [addingId, setAddingId] = useState<string | null>(null)
  const [allCustomers, setAllCustomers] = useState<Customer[]>([])   // 고객 피커용
  const [allProperties, setAllProperties] = useState<Property[]>([]) // 매물 피커용
  const [showPicker, setShowPicker] = useState(false)
  const [propertyPickerLinkId, setPropertyPickerLinkId] = useState<string | null>(null) // 매물 피커 대상
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null) // link_id
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const wasDragRef = useRef(false)

  // Section 2-5 데이터
  const [sections, setSections] = useState<SectionDef[]>(DEFAULT_SECTIONS)
  const [sectionContent, setSectionContent] = useState<Record<string, string>>({})
  const sectionsDebounceRef = useRef<any>(null)

  // 날짜
  const [diaryDate, setDiaryDate] = useState(() => new Date().toISOString().split('T')[0])
  const [diaryLoading, setDiaryLoading] = useState(false)

  // 알림에서 ?date=YYYY-MM-DD&broker=BROKER_ID 로 진입 시 처리 (한 번만)
  const notifNavRef = useRef(false)
  useEffect(() => {
    if (notifNavRef.current) return
    const dateParam = searchParams.get('date')
    const brokerParam = searchParams.get('broker')
    if (!dateParam && !brokerParam) return
    if (!broker) return  // broker 로드 후에야 본인 매칭 가능
    notifNavRef.current = true
    if (dateParam) setDiaryDate(dateParam)
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
  const { direction, updateDirection } = useSheetDirection(broker?.id ?? null, 'diary')

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id])
  useEffect(() => { if (broker) loadDiaryData(diaryDate) }, [diaryDate, broker?.id, viewingBrokerId, viewingExEmployee])

  // viewingBrokerId 변경 시 그 직원의 일지 섹션 정의를 로드 (직원별 다른 섹션 지원)
  useEffect(() => {
    if (!broker) return
    // 퇴사자는 broker_profiles 행이 없을 수 있고 col_settings도 의미 없음 — 기본 섹션 사용
    if (viewingExEmployee) {
      setSections(DEFAULT_SECTIONS)
      return
    }
    const targetId = viewingBrokerId ?? broker.id
    if (targetId === broker.id) {
      const saved = (broker.col_settings as any)?.diary_sections?.sections
      setSections(Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_SECTIONS)
      return
    }
    ;(async () => {
      const { data } = await supabase
        .from('broker_profiles')
        .select('col_settings')
        .eq('id', targetId)
        .maybeSingle()
      const saved = (data?.col_settings as any)?.diary_sections?.sections
      setSections(Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_SECTIONS)
    })()
  }, [broker?.id, viewingBrokerId, viewingExEmployee, supabase])

  const init = async () => {
    const u = auth.user!
    const b = auth.broker!
    const prof = auth.profile
    setUser(u)
    setProfile(prof); setBroker(b)
    const owner = b.is_owner !== false
    setIsOwner(owner)
    if (!owner) {
      if (b.is_approved === false) { setAccessDenied(true); setLoading(false); return }
      const perms = b.permissions
      if (perms?.diary?.view === false) { setAccessDenied(true); setLoading(false); return }
      setCanEdit(perms ? perms.diary?.edit !== false : true)
    }

    // 본인 섹션 초기 로드 — 직원 일지 viewing 시는 아래 useEffect가 덮어씀
    const savedSections = b.col_settings?.['diary_sections']?.sections
    if (Array.isArray(savedSections) && savedSections.length > 0) setSections(savedSections)

    // 대표: 직원 목록 + 퇴사자 목록 로드
    if (owner) {
      const { data: emps } = await supabase
        .from('broker_profiles')
        .select('id, profiles(name)')
        .eq('parent_broker_id', b.id)
        .eq('is_approved', true)
      if (emps) {
        const empList = emps.map((e: any) => ({ id: e.id, name: (e.profiles as any)?.name ?? '직원' }))
        setEmployees(empList)
        setTeamMembers([prof?.name, ...empList.map(e => e.name)].filter(Boolean) as string[])
      } else {
        setTeamMembers(prof?.name ? [prof.name] : [])
      }
      // archive에서 distinct 퇴사자 목록 — diary archive · customer archive 양쪽 합집합
      const [{ data: archAuthors1 }, { data: archAuthors2 }] = await Promise.all([
        supabase.from('broker_diary_archive')
          .select('author_broker_id, author_name')
          .eq('office_broker_id', b.id),
        supabase.from('broker_diary_customers_archive')
          .select('author_broker_id, author_name')
          .eq('office_broker_id', b.id),
      ])
      const seen = new Set<string>()
      const exList: Array<{ id: string; name: string }> = []
      for (const a of [...(archAuthors1 ?? []), ...(archAuthors2 ?? [])]) {
        const aid = (a as any).author_broker_id
        if (aid && !seen.has(aid)) {
          seen.add(aid)
          exList.push({ id: aid, name: (a as any).author_name ?? '퇴사자' })
        }
      }
      setExEmployees(exList)
    } else {
      setTeamMembers(prof?.name ? [prof.name] : [])
    }

    // 일지 피커용 매물·고객 로드 — 대표는 사무소 전체, 직원도 사무소 전체 fetch
    // (고객 피커는 UI에서 ownerName으로 다시 필터링되므로 본인 것만 노출됨)
    let brokerIds: string[] = [b.id]
    if (owner) {
      const { data: emps } = await supabase.from('broker_profiles').select('id').eq('parent_broker_id', b.id)
      if (emps) brokerIds = [b.id, ...emps.map((e: any) => e.id)]
    } else if (b.parent_broker_id) {
      const { data: sibs } = await supabase.from('broker_profiles').select('id').eq('parent_broker_id', b.parent_broker_id)
      if (sibs) brokerIds = sibs.map((e: any) => e.id)
      if (!brokerIds.includes(b.parent_broker_id)) brokerIds.push(b.parent_broker_id)
    }
    // 매물은 1000건씩 페이지네이션 (PostgREST max-rows 우회)
    const fetchAllProps = async () => {
      const PAGE = 1000
      const all: any[] = []
      for (let from = 0; ; from += PAGE) {
        const { data: page } = await supabase.from('broker_properties')
          .select('id, seq_no, address, deal_type, room_type, price, monthly_rent')
          .in('broker_id', brokerIds).order('created_at', { ascending: false }).range(from, from + PAGE - 1)
        if (!page || page.length === 0) break
        all.push(...page)
        if (page.length < PAGE) break
      }
      return all
    }
    const [{ data: custs }, props] = await Promise.all([
      supabase.from('broker_customers')
        .select('id, broker_id, client_name, contact, received_date, assignee, category, source, status, request, interest, consult_note, custom_fields')
        .in('broker_id', brokerIds).order('created_at', { ascending: false }),
      fetchAllProps(),
    ])
    setAllCustomers(custs ?? [])
    setAllProperties(props)
    setLoading(false)
  }

  const loadDiaryData = async (date: string) => {
    if (!broker) return
    setDiaryLoading(true)

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
          .select('sections_content, work_summary, ad_status, suggestions, delivery_notes')
          .eq('office_broker_id', broker.id)
          .eq('author_broker_id', viewingBrokerId)
          .eq('date', date)
          .maybeSingle(),
      ])
      setDiaryCustomers((archLinks ?? []).map((l: any) => ({
        link_id: l.id,
        sort_order: l.sort_order,
        proposed_property_ids: l.proposed_property_ids ?? [],
        id: l.customer_id ?? l.id,
        client_name: l.customer_name ?? '',
        contact: l.customer_contact ?? null,
        received_date: null,
        assignee: null,
        category: '',
        source: null,
        status: '',
        request: null,
        custom_fields: null,
      })))
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
      setDiaryLoading(false)
      return
    }

    const targetId = viewingBrokerId ?? broker.id
    const [{ data: links }, { data: diaryRow }] = await Promise.all([
      supabase.from('broker_diary_customers')
        .select('id, sort_order, proposed_property_ids, broker_customers(id, client_name, contact, received_date, assignee, category, source, status, request, interest, consult_note, custom_fields)')
        .eq('broker_id', targetId).eq('diary_date', date).order('sort_order'),
      supabase.from('broker_diary').select('sections_content').eq('broker_id', targetId).eq('date', date).maybeSingle(),
    ])
    setDiaryCustomers((links ?? []).map((l: any) => ({ link_id: l.id, sort_order: l.sort_order, proposed_property_ids: l.proposed_property_ids ?? [], ...l.broker_customers as Customer })))
    setSectionContent(diaryRow?.sections_content ?? {})
    setDiaryLoading(false)
  }

  // 고객 피커: 기존 고객 추가 (direction에 따라 위/아래)
  const addExistingCustomer = async (c: Customer) => {
    if (!broker) return
    const orders = diaryCustomers.map(d => d.sort_order)
    const nextOrder = direction === 'up'
      ? (orders.length > 0 ? Math.min(...orders) - 1 : 0)
      : (orders.length > 0 ? Math.max(...orders) + 1 : 0)
    const { data, error } = await supabase.from('broker_diary_customers').insert({ broker_id: broker.id, diary_date: diaryDate, customer_id: c.id, sort_order: nextOrder }).select('id').single()
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
    const { data: newCust, error: ce } = await supabase.from('broker_customers').insert({
      broker_id: broker.id, client_name: '', request: '', contact: null,
      received_date: null, assignee: profile?.name ?? null, source: null,
      category: '', status: '',
    }).select().single()
    if (ce || !newCust) return
    setAllCustomers(prev => [newCust, ...prev])
    const orders = diaryCustomers.map(d => d.sort_order)
    const nextOrder = direction === 'up'
      ? (orders.length > 0 ? Math.min(...orders) - 1 : 0)
      : (orders.length > 0 ? Math.max(...orders) + 1 : 0)
    const { data: link } = await supabase.from('broker_diary_customers').insert({ broker_id: broker.id, diary_date: diaryDate, customer_id: newCust.id, sort_order: nextOrder }).select('id').single()
    if (link) {
      setDiaryCustomers(prev => direction === 'up'
        ? [{ link_id: link.id, sort_order: nextOrder, proposed_property_ids: [], ...newCust as Customer }, ...prev]
        : [...prev, { link_id: link.id, sort_order: nextOrder, proposed_property_ids: [], ...newCust as Customer }])
      setAddingId(newCust.id)
      setTimeout(() => setAddingId(null), 3000)
    }
  }

  // 고객 행 삭제 (diary_customers 링크만 제거)
  const unlinkCustomer = async (linkId: string) => {
    await supabase.from('broker_diary_customers').delete().eq('id', linkId)
    setDiaryCustomers(prev => prev.filter(c => c.link_id !== linkId))
    setDeleteConfirm(null)
  }

  // 일지 행 복사 — 원본 고객 필드를 복제한 새 고객을 생성하고 같은 일지에 link 추가
  const duplicateDiaryCustomer = async (row: any) => {
    if (!broker) return
    const targetBrokerId = viewingBrokerId ?? broker.id
    const { link_id: _lid, sort_order: _so, proposed_property_ids: _ppi, id: _id, created_at: _ca, updated_at: _ua, ...rest } = row
    const { data: newCust, error: ce } = await supabase.from('broker_customers').insert({ ...rest, broker_id: targetBrokerId }).select().single()
    if (ce || !newCust) return
    setAllCustomers(prev => [newCust, ...prev])
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
  const saveCustomerField = useCallback(async (customerId: string, field: string, value: any) => {
    await supabase.from('broker_customers').update({ [field]: value }).eq('id', customerId)
    setDiaryCustomers(prev => prev.map(c => c.id === customerId ? { ...c, [field]: value } : c))
    setAllCustomers(prev => prev.map(c => c.id === customerId ? { ...c, [field]: value } : c))
  }, [])

  const saveCustomField = useCallback(async (customerId: string, colId: string, value: string) => {
    const row = diaryCustomers.find(c => c.id === customerId)
    const newFields = { ...(row?.custom_fields ?? {}), [colId]: value }
    await supabase.from('broker_customers').update({ custom_fields: newFields }).eq('id', customerId)
    setDiaryCustomers(prev => prev.map(c => c.id === customerId ? { ...c, custom_fields: newFields } : c))
  }, [diaryCustomers])

  // 제안 매물 저장
  const saveProposedProperties = async (linkId: string, ids: string[]) => {
    await supabase.from('broker_diary_customers').update({ proposed_property_ids: ids }).eq('id', linkId)
    setDiaryCustomers(prev => prev.map(c => c.link_id === linkId ? { ...c, proposed_property_ids: ids } : c))
    setPropertyPickerLinkId(null)
  }

  // 섹션 내용 저장 — viewing 대상의 broker_id에 저장 (사장님이 직원 일지 편집 가능하도록)
  // 퇴사자 archive 모드면 broker_diary_archive에 update (대표 권한 필요)
  const saveSectionContent = useCallback(async (sectionId: string, value: string) => {
    if (!broker) return
    const newContent = { ...sectionContent, [sectionId]: value || undefined }
    if (!value) delete newContent[sectionId]

    if (viewingExEmployee && viewingBrokerId) {
      const payload = { sections_content: newContent }
      const { data: existing } = await supabase.from('broker_diary_archive')
        .select('id')
        .eq('office_broker_id', broker.id)
        .eq('author_broker_id', viewingBrokerId)
        .eq('date', diaryDate)
        .maybeSingle()
      if (existing) await supabase.from('broker_diary_archive').update(payload).eq('id', existing.id)
      // archive에 해당 날짜 일지 없으면 신규 생성 — author_name도 같이
      else {
        const { data: prof } = await supabase.from('broker_profiles').select('user_id').eq('id', viewingBrokerId).maybeSingle()
        const { data: nameRow } = prof?.user_id
          ? await supabase.from('profiles').select('name').eq('id', prof.user_id).maybeSingle()
          : { data: null }
        await supabase.from('broker_diary_archive').insert({
          office_broker_id: broker.id,
          author_broker_id: viewingBrokerId,
          author_name: (nameRow as any)?.name ?? null,
          date: diaryDate,
          sections_content: newContent,
        })
      }
      setSectionContent(prev => ({ ...prev, [sectionId]: value || '' }))
      return
    }

    const targetBrokerId = viewingBrokerId ?? broker.id
    const payload = { sections_content: newContent, updated_at: new Date().toISOString() }
    const { data: existing } = await supabase.from('broker_diary').select('id').eq('broker_id', targetBrokerId).eq('date', diaryDate).maybeSingle()
    if (existing) await supabase.from('broker_diary').update(payload).eq('id', existing.id)
    else {
      await supabase.from('broker_diary').insert({ broker_id: targetBrokerId, date: diaryDate, ...payload })
      // 그날 첫 일지 작성 시 대표에게 알림 (이후 셀 update는 알림 없음)
      notifyOwnerOfBrokerAction(targetBrokerId, 'diary', `/broker/diary?date=${diaryDate}&broker=${targetBrokerId}`)
    }
    setSectionContent(prev => ({ ...prev, [sectionId]: value || '' }))
  }, [broker, diaryDate, sectionContent, viewingBrokerId, viewingExEmployee])

  // 섹션 이름 변경
  const renameSection = (id: string, title: string) => {
    const newSections = sections.map(s => s.id === id ? { ...s, title } : s)
    setSections(newSections)
    saveSectionConfig(newSections)
  }

  // 섹션 삭제
  const deleteSection = (id: string) => {
    const newSections = sections.filter(s => s.id !== id)
    setSections(newSections)
    saveSectionConfig(newSections)
  }

  // 섹션 추가
  const addSection = () => {
    const id = `s_${Date.now()}`
    const newSections = [...sections, { id, title: '새 섹션' }]
    setSections(newSections)
    saveSectionConfig(newSections)
  }

  // 섹션 설정 저장
  const saveSectionConfig = async (newSections: SectionDef[]) => {
    if (!broker) return
    if (sectionsDebounceRef.current) clearTimeout(sectionsDebounceRef.current)
    sectionsDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase.from('broker_profiles').select('col_settings').eq('id', broker.id).single()
      const existing = data?.col_settings ?? {}
      await supabase.from('broker_profiles').update({ col_settings: { ...existing, diary_sections: { sections: newSections } } }).eq('id', broker.id)
    }, 500)
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
  const [importing, setImporting] = useState(false)

  const importFromDate = async () => {
    if (!broker || !importDate) return
    setImporting(true)
    const [{ data: sourceLinks }, { data: sourceDiary }] = await Promise.all([
      supabase.from('broker_diary_customers')
        .select('sort_order, proposed_property_ids, broker_customers(id, client_name, contact, received_date, assignee, category, source, status, request, interest, consult_note, custom_fields)')
        .eq('broker_id', broker.id).eq('diary_date', importDate).order('sort_order'),
      supabase.from('broker_diary').select('sections_content').eq('broker_id', broker.id).eq('date', importDate).maybeSingle(),
    ])
    // 현재 날짜 고객 링크 삭제 후 재삽입
    await supabase.from('broker_diary_customers').delete().eq('broker_id', broker.id).eq('diary_date', diaryDate)
    if (sourceLinks && sourceLinks.length > 0) {
      const inserts = sourceLinks.map((l: any, idx: number) => ({
        broker_id: broker.id, diary_date: diaryDate,
        customer_id: (l.broker_customers as any).id, sort_order: idx,
        proposed_property_ids: l.proposed_property_ids ?? [],
      }))
      const { data: newLinks } = await supabase.from('broker_diary_customers')
        .insert(inserts)
        .select('id, sort_order, broker_customers(id, client_name, contact, received_date, assignee, category, source, status, request, interest, consult_note, custom_fields)')
      setDiaryCustomers((newLinks ?? []).map((l: any) => ({ link_id: l.id, sort_order: l.sort_order, proposed_property_ids: l.proposed_property_ids ?? [], ...l.broker_customers as Customer })))
    } else {
      setDiaryCustomers([])
    }
    // 섹션 내용 복사
    const newContent = sourceDiary?.sections_content ?? {}
    const payload = { sections_content: newContent, updated_at: new Date().toISOString() }
    const { data: existingDiary } = await supabase.from('broker_diary').select('id').eq('broker_id', broker.id).eq('date', diaryDate).maybeSingle()
    if (existingDiary) await supabase.from('broker_diary').update(payload).eq('id', existingDiary.id)
    else {
      await supabase.from('broker_diary').insert({ broker_id: broker.id, date: diaryDate, ...payload })
      notifyOwnerOfBrokerAction(broker.id, 'diary', `/broker/diary?date=${diaryDate}&broker=${broker.id}`)
    }
    setSectionContent(newContent)
    setImporting(false)
    setShowImport(false)
  }

  // 날짜 포맷
  const changeDate = (delta: number) => { const d = new Date(diaryDate); d.setDate(d.getDate() + delta); setDiaryDate(d.toISOString().split('T')[0]) }
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
    const ro = !effectiveCanEdit
    if (col.type === 'custom') {
      const cd = settings.customCols.find(cc => cc.id === col.id)
      if (cd?.type === 'select') return <SelectCell value={c.custom_fields?.[col.id] ?? ''} options={settings.options[col.id] ?? []} onSave={v => saveCustomField(c.id, col.id, v)} readOnly={ro} multi={settings.multi[col.id]} />
      return <TextCell value={c.custom_fields?.[col.id] ?? ''} onSave={v => saveCustomField(c.id, col.id, v)} placeholder="—" readOnly={ro} />
    }
    const def = col.def; const opts = settings.options[def.key] ?? def.defaultOpts ?? []; const colorMap = COL_COLORS[def.key]
    switch (def.key) {
      case 'request':       return <LongTextCell value={c.request} onSave={v => saveCustomerField(c.id, 'request', v || null)} placeholder="요청사항" readOnly={ro} />
      case 'received_date': return <TextCell value={c.received_date} onSave={v => saveCustomerField(c.id, 'received_date', v || null)} placeholder="접수일자" readOnly={ro} />
      case 'contact':       return <TextCell value={c.contact} onSave={v => saveCustomerField(c.id, 'contact', v || null)} placeholder="연락처" readOnly={ro} />
      case 'interest':      return <SelectCell value={(c as any).interest ?? ''} options={opts} onSave={v => saveCustomerField(c.id, 'interest', v || null)} colorMap={colorMap} readOnly={ro} placeholder="관심물건" multi={settings.multi['interest']} />
      case 'source':        return <SelectCell value={c.source} options={opts} onSave={v => saveCustomerField(c.id, 'source', v)} colorMap={colorMap} readOnly={ro} placeholder="유입" multi={settings.multi['source']} />
      case 'status':        return <SelectCell value={c.status} options={opts} onSave={v => saveCustomerField(c.id, 'status', v)} colorMap={colorMap} readOnly={ro} placeholder="진행상황" multi={settings.multi['status']} />
      case 'consult_note':  return <LongTextCell value={(c as any).consult_note ?? ''} onSave={v => saveCustomerField(c.id, 'consult_note', v || null)} placeholder="상담내용" readOnly={ro} />
      case 'proposed_properties': return <ProposedPropertiesCell propIds={c.proposed_property_ids} allProperties={allProperties} onOpen={() => setPropertyPickerLinkId(c.link_id)} onRemove={id => saveProposedProperties(c.link_id, (c.proposed_property_ids ?? []).filter(x => x !== id))} readOnly={ro} />
      default: return null
    }
  }

  const linkedIds = new Set(diaryCustomers.map(c => c.id))

  if (loading) return <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center"><div className="text-gray-500 text-sm">불러오는 중...</div></div>
  if (accessDenied) return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="text-5xl">🔒</div>
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-300">업무일지 접근 권한이 없어요</h2>
        <p className="text-sm text-gray-500">대표에게 권한 설정을 요청해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="mx-auto max-w-screen-xl px-3 py-4 sm:px-4 sm:py-6 space-y-4">

        {/* 날짜 헤더 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <h1 className="text-lg sm:text-2xl font-black text-gray-900 dark:text-white">{formatDateHeader(diaryDate)} 업무일지</h1>
            {/* 대표: 직원/퇴사자 선택 드롭다운 */}
            {isOwner && (employees.length > 0 || exEmployees.length > 0) && (
              <select
                value={viewingExEmployee ? `ex:${viewingBrokerId}` : (viewingBrokerId ?? '')}
                onChange={e => {
                  const v = e.target.value
                  if (!v) { setViewingBrokerId(null); setViewingExEmployee(false) }
                  else if (v.startsWith('ex:')) { setViewingBrokerId(v.slice(3)); setViewingExEmployee(true) }
                  else { setViewingBrokerId(v); setViewingExEmployee(false) }
                }}
                className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 outline-none focus:border-blue-400 cursor-pointer"
              >
                <option value="">내 일지</option>
                {employees.length > 0 && (
                  <optgroup label="재직">
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
                {exEmployees.length > 0 && (
                  <optgroup label="퇴사">
                    {exEmployees.map(e => (
                      <option key={e.id} value={`ex:${e.id}`}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
            {viewingExEmployee && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
                퇴사자 일지 · 읽기 전용
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {effectiveCanEdit && (
              <button onClick={() => { setImportDate(''); setShowImport(true) }}
                className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors">
                <Download className="h-3.5 w-3.5" />불러오기
              </button>
            )}
            <button onClick={() => changeDate(-1)} aria-label="이전 날짜" className="flex items-center justify-center h-9 w-9 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"><ChevronLeft className="h-4 w-4" /></button>
            <div className="min-w-[8rem] rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium">
              <DateCell value={diaryDate} onSave={v => { if (v) setDiaryDate(v) }} />
            </div>
            <button onClick={() => changeDate(1)} aria-label="다음 날짜" className="flex items-center justify-center h-9 w-9 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>

        {/* Section 1: 고객정보 */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50">
            <span className="text-sm font-bold text-gray-800 dark:text-gray-100">1. 고객정보({viewingName})</span>
            <span className="text-xs text-gray-500">{diaryCustomers.length}명</span>
          </div>
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
                            })() : <ColumnHeader label={col.def.label} isFixed={col.def.fixed} hasOptions={col.def.hasOptions} options={settings.options[col.def.key] ?? col.def.defaultOpts ?? []} onSetOptions={opts => setOpts(col.def.key, opts)} isMulti={settings.multi[col.def.key]} onChangeMulti={col.def.hasOptions ? m => setMulti(col.def.key, m) : undefined} onHide={() => hideCol(col.def.key)} />}
                          </div>
                          <div onMouseDown={e => startResize(key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 transition-all" />
                        </th>
                      )
                    })}
                    <SheetActionHeader>
                      <AddColBtn onAdd={addCustomCol} />
                      <ColVisibility fixedCols={fixedCols} optionalCols={optionalCols} customCols={settings.customCols} visible={settings.visible} onToggle={key => settings.visible.includes(key) ? hideCol(key) : showCol(key)} />
                    </SheetActionHeader>
                  </tr>
                </thead>
                <tbody>
                  {diaryCustomers.length === 0 ? (
                    <tr><td colSpan={activeCols.length + 1} className="py-12 text-center text-sm text-gray-500">아래 버튼으로 고객을 추가하세요</td></tr>
                  ) : diaryCustomers.map((c) => (
                    <tr key={c.link_id} data-row-id={c.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', addingId === c.id && 'animate-pulse bg-blue-50/40')}>
                      {activeCols.map(col => (
                        <td key={getColKey(col)} className="px-3 py-1.5 border-r border-gray-100 dark:border-gray-800" style={{ width: getColWidth(col), maxWidth: getColWidth(col) }}>{renderCell(c, col)}</td>
                      ))}
                      <SheetActionCell canEdit={effectiveCanEdit} onCopy={() => duplicateDiaryCustomer(c)} onDelete={() => setDeleteConfirm(c.link_id)} />
                    </tr>
                  ))}
                  {effectiveCanEdit && (
                    <tr><td colSpan={activeCols.length + 1} className="border-t border-gray-100 dark:border-gray-800">
                      <div className="flex items-center divide-x divide-gray-100">
                        <button onClick={() => setShowPicker(true)} className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-blue-600 hover:bg-blue-50/50 transition-colors">
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

        {/* Sections 2-5 */}
        {!diaryLoading && (<>
          {sections.map((def, idx) => (
            <DiarySection key={def.id} def={def} num={idx + 2} content={sectionContent[def.id] ?? null}
              onSave={v => saveSectionContent(def.id, v)} onRename={renameSection} onDelete={deleteSection} readOnly={!canEditSections} />
          ))}
          {effectiveCanEdit && (
            <button onClick={addSection} className="w-full flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-800 py-3 text-sm font-medium text-gray-500 hover:border-blue-300 hover:text-blue-500 transition-colors">
              <Plus className="h-4 w-4" />섹션 추가
            </button>
          )}
        </>)}

      </div>

      {/* 고객 피커 */}
      {showPicker && (
        <CustomerPicker allCustomers={allCustomers} linkedIds={linkedIds} ownerName={viewingName} ownerBrokerId={viewingBrokerId ?? broker?.id ?? null}
          onAddExisting={addExistingCustomer} onCreateNew={createAndAddCustomer} onClose={() => setShowPicker(false)} />
      )}

      {/* 제안 매물 피커 */}
      {propertyPickerLinkId && (() => {
        const row = diaryCustomers.find(c => c.link_id === propertyPickerLinkId)
        return (
          <PropertyPicker
            allProperties={allProperties}
            selectedIds={row?.proposed_property_ids ?? []}
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
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">불러올 날짜</label>
              <input type="date" value={importDate} max={diaryDate}
                onChange={e => setImportDate(e.target.value)}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 cursor-pointer" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowImport(false)} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
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
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">오늘 일지에서 제거할까요?</h3>
            <p className="text-sm text-gray-500 mb-6">고객 정보는 유지되고, 오늘 일지에서만 사라져요.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
              <button onClick={() => unlinkCustomer(deleteConfirm)} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">제거</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
