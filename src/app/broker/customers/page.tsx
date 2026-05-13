'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Search, Users, TrendingUp, CheckCircle, ChevronDown, EyeOff, Eye, MoreHorizontal, X, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useColSettings, ColSettings } from '@/lib/use-col-settings'

// ── 컬럼 정의 ──────────────────────────────────────────
interface ColDef {
  key: string; label: string; fixed?: boolean; minWidth?: number
  hasOptions?: boolean; defaultOpts?: string[]
}

const CUST_COLS: ColDef[] = [
  { key: 'request',        label: '요청사항', fixed: true, minWidth: 160 },
  { key: 'received_date',  label: '접수일자', fixed: true, minWidth: 100 },
  { key: 'contact',        label: '연락처',   fixed: true, minWidth: 130 },
  { key: 'assignee',       label: '담당자',   fixed: true, minWidth: 90 },
  { key: 'category',       label: '구분',     fixed: true, minWidth: 80, hasOptions: true, defaultOpts: ['비주거', '주거용'] },
  { key: 'source',         label: '유입',     fixed: true, minWidth: 90, hasOptions: true, defaultOpts: ['빠방', '당근', '플레이스', '네이버광고', '네이버블로그', '공동', '지인', '특톡', '기타'] },
  { key: 'status',         label: '진행상황', fixed: true, minWidth: 100, hasOptions: true, defaultOpts: ['잠재', '진행중', '종료', '계약완료'] },
]

const DEFAULT_WIDTHS: Record<string, number> = Object.fromEntries(CUST_COLS.map(c => [c.key, c.minWidth ?? 100]))

const DEFAULT_COL_SETTINGS: ColSettings = {
  visible:    CUST_COLS.filter(c => !c.fixed).map(c => c.key),
  order:      CUST_COLS.map(c => c.key),
  widths:     DEFAULT_WIDTHS,
  customCols: [],
  options:    Object.fromEntries(CUST_COLS.filter(c => c.hasOptions).map(c => [c.key, c.defaultOpts!])),
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

// ── DateCell ──────────────────────────────────────────
function DateCell({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [viewYear, setViewYear] = useState(() => {
    const d = value ? new Date(value) : new Date()
    return isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear()
  })
  const [viewMonth, setViewMonth] = useState(() => {
    const d = value ? new Date(value) : new Date()
    return isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth()
  })
  const btnRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) {
        commit(); setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, draft])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])

  const handleOpen = () => {
    if (open) return
    setDraft(value ?? '')
    const d = value ? new Date(value) : new Date()
    const base = isNaN(d.getTime()) ? new Date() : d
    setViewYear(base.getFullYear()); setViewMonth(base.getMonth())
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const top = r.bottom + 4; const left = r.left
      setPopStyle({
        position: 'fixed', zIndex: 9999,
        top: top + 260 > window.innerHeight ? r.top - 264 : top,
        left: left + 240 > window.innerWidth ? window.innerWidth - 248 : left,
      })
    }
    setOpen(true)
  }

  const commit = () => {
    if (draft && draft !== (value ?? '')) onSave(draft)
    setOpen(false)
  }

  const selectDate = (y: number, m: number, d: number) => {
    const str = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    setDraft(str); onSave(str); setOpen(false)
  }

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) } else setViewMonth(m => m - 1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) } else setViewMonth(m => m + 1) }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const selectedStr = value ?? ''

  return (
    <div className="relative w-full">
      <div ref={btnRef} onClick={handleOpen}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db' }}>
        {value || '날짜'}
      </div>
      {open && (
        <div ref={popupRef} className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={{ ...popStyle, width: 240 }}>
          {/* 직접 입력 */}
          <div className="p-2 border-b border-gray-100">
            <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setOpen(false) }}
              placeholder="2026-05-13"
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20" />
          </div>
          {/* 월 네비게이션 */}
          <div className="flex items-center justify-between px-3 py-2">
            <button onClick={prevMonth} className="flex h-6 w-6 items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-xs font-bold">‹</button>
            <span className="text-xs font-semibold text-gray-700">{viewYear}년 {viewMonth + 1}월</span>
            <button onClick={nextMonth} className="flex h-6 w-6 items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-xs font-bold">›</button>
          </div>
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 px-2 pb-1">
            {['일','월','화','수','목','금','토'].map((d, i) => (
              <div key={d} className={`text-center text-[10px] font-medium pb-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-400'}`}>{d}</div>
            ))}
          </div>
          {/* 날짜 그리드 */}
          <div className="grid grid-cols-7 px-2 pb-2 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />
              const str = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const isSelected = str === selectedStr
              const isToday = str === todayStr
              const col = i % 7
              return (
                <button key={i} onClick={() => selectDate(viewYear, viewMonth, day)}
                  className={`flex h-7 w-7 mx-auto items-center justify-center rounded-full text-xs transition-colors
                    ${isSelected ? 'bg-blue-600 text-white font-bold' :
                      isToday ? 'border border-blue-400 text-blue-600 font-semibold hover:bg-blue-50' :
                      col === 0 ? 'text-red-400 hover:bg-red-50' :
                      col === 6 ? 'text-blue-400 hover:bg-blue-50' :
                      'text-gray-700 hover:bg-gray-100'}`}>
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
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
        className={`cursor-pointer rounded px-2 py-0.5 text-xs font-semibold inline-flex items-center hover:opacity-80 ${colorMap?.[value] ?? 'bg-gray-100 text-gray-600'}`}>
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

// ── ColumnHeader ─────────────────────────────────────
function ColumnHeader({ label, isFixed, isCustom, hasOptions, options, onSetOptions, onHide, onRename, onDelete }: {
  label: string; isFixed?: boolean; isCustom?: boolean; hasOptions?: boolean
  options?: string[]; onSetOptions?: (opts: string[]) => void
  onHide?: () => void; onRename?: (name: string) => void; onDelete?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [newOpt, setNewOpt] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(label)
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => { setOpen(false); setRenaming(false) })

  const canOpen = !isFixed || hasOptions || isCustom
  const wasDragRef = useRef(false)

  const handleOpen = (e: React.MouseEvent) => {
    if (!canOpen || wasDragRef.current) return
    e.stopPropagation()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setStyle({ position: 'fixed', zIndex: 9999, top: r.bottom + 2, left: Math.min(r.left, window.innerWidth - 230), minWidth: 210 })
    }
    setOpen(v => !v)
  }

  const addOpt = () => {
    const v = newOpt.trim()
    if (!v || !options || options.includes(v)) return
    onSetOptions?.([...options, v]); setNewOpt('')
  }

  const commitRename = () => {
    const v = renameVal.trim()
    if (v && v !== label) onRename?.(v)
    setRenaming(false); setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <div ref={btnRef} onClick={handleOpen}
        className={cn('flex items-center gap-1 select-none', canOpen && 'cursor-pointer group')}>
        {isFixed && <Lock className="h-2.5 w-2.5 text-gray-300 flex-shrink-0" />}
        <span className="text-xs font-semibold text-gray-500">{label}</span>
        {canOpen && !isFixed && <ChevronDown className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />}
      </div>
      {open && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={style}
          onClick={e => e.stopPropagation()}>
          <div className="px-3 py-2 border-b border-gray-100 text-xs font-bold text-gray-700 flex items-center gap-1.5">
            {isFixed && <Lock className="h-3 w-3 text-gray-400" />}
            {label}
          </div>

          {!isFixed && !isCustom && (
            <button onClick={() => { onHide?.(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
              <EyeOff className="h-3.5 w-3.5 text-gray-400" />이 칼럼 숨기기
            </button>
          )}

          {isCustom && (
            <>
              {renaming ? (
                <div className="px-3 py-2 flex gap-1.5 border-b border-gray-100">
                  <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenaming(false); setRenameVal(label) } }}
                    className="flex-1 rounded-lg border border-blue-400 px-2 py-1 text-xs outline-none min-w-0" />
                  <button onClick={commitRename} className="rounded-lg bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700">확인</button>
                </div>
              ) : (
                <button onClick={() => { setRenaming(true); setRenameVal(label) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                  <span className="text-gray-400">✏️</span>칼럼 이름 변경
                </button>
              )}
              <button onClick={() => { onHide?.(); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                <EyeOff className="h-3.5 w-3.5 text-gray-400" />이 칼럼 숨기기
              </button>
              <button onClick={() => { onDelete?.(); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors border-t border-gray-100">
                <X className="h-3.5 w-3.5" />칼럼 완전 삭제
              </button>
            </>
          )}

          {hasOptions && options && (
            <>
              {(!isFixed || isCustom) && <div className="border-t border-gray-100" />}
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
        <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={style}
          onClick={e => e.stopPropagation()}>

          {/* 고정 칼럼 섹션 */}
          <div className="px-3 py-1.5 flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
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
              <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">선택 칼럼</div>
              {hiddenOptional.map(col => (
                <button key={col.key} onClick={() => { onShow(col.key); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                  <span className="text-gray-300 font-bold">+</span>{col.label}
                </button>
              ))}
            </>
          )}

          {/* 내 칼럼 섹션 */}
          {hiddenCustom.length > 0 && (
            <>
              <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">내 칼럼</div>
              {hiddenCustom.map(col => (
                <button key={col.id} onClick={() => { onShow(col.id); setOpen(false) }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
                  <span className="text-gray-300 font-bold">+</span>{col.name}
                </button>
              ))}
            </>
          )}

          {/* 새 칼럼 만들기 */}
          <div className="border-t border-gray-100">
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
        <div className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white shadow-xl p-2.5" style={popStyle}>
          <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setOpen(false); setName('') } }}
            placeholder="칼럼 이름 입력"
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 w-44" />
          <div className="flex gap-1">
            <button onClick={() => setType('text')}
              className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${type === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
              텍스트
            </button>
            <button onClick={() => setType('select')}
              className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${type === 'select' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
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
    ...customCols.map(c => ({ key: c.id, label: c.name, fixed: false })),
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
        <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={popStyle}>
          <div className="p-2 border-b border-gray-100">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="속성을 검색하세요" autoFocus
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20" />
          </div>
          <div className="px-3 py-2 border-b border-gray-100">
            <span className="text-xs font-medium text-gray-500">표에 표시하기</span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {rows.map(c => (
              <div key={c.key}
                className={`flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 ${c.fixed ? 'cursor-default' : 'cursor-pointer'}`}
                onClick={() => !c.fixed && onToggle(c.key)}>
                <span className={`text-xs font-medium ${c.fixed || visible.includes(c.key) ? 'text-gray-700' : 'text-gray-400'}`}>{c.label}</span>
                <Eye className={`h-3.5 w-3.5 flex-shrink-0 ${c.fixed || visible.includes(c.key) ? 'text-gray-400' : 'text-gray-200'}`} />
              </div>
            ))}
          </div>
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
  const [profile, setProfile] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [monthFilter, setMonthFilter] = useState('전체')
  const [assigneeFilter, setAssigneeFilter] = useState('전체')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)

  // 칼럼 드래그
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const wasDragRef = useRef(false)

  // 칼럼 설정 (DB)
  const { settings, update, loaded } = useColSettings('customers', broker?.id ?? null, DEFAULT_COL_SETTINGS)

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
    const { data } = await supabase.from('broker_customers').select('*')
      .in('broker_id', brokerIds).order('received_date', { ascending: false }).order('created_at', { ascending: false })
    setCustomers(data ?? [])
    setLoading(false)
  }

  const saveField = useCallback(async (id: string, field: string, value: any) => {
    await supabase.from('broker_customers').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id)
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }, [])

  const saveCustomField = useCallback(async (id: string, colId: string, value: string) => {
    const row = customers.find(c => c.id === id)
    const newFields = { ...(row?.custom_fields ?? {}), [colId]: value }
    await supabase.from('broker_customers').update({ custom_fields: newFields }).eq('id', id)
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, custom_fields: newFields } : c))
  }, [customers])

  const addRow = async () => {
    if (!broker) return
    const today = new Date().toISOString().split('T')[0]
    const opts = settings.options
    const { data, error } = await supabase.from('broker_customers').insert({
      broker_id: broker.id, client_name: '', received_date: today,
      assignee: profile?.name ?? null,
      category: opts.category?.[0] ?? '비주거',
      status: opts.status?.[0] ?? '잠재',
    }).select().single()
    if (error || !data) return
    setCustomers(prev => [data, ...prev])
    setAddingId(data.id); setTimeout(() => setAddingId(null), 2000)
  }

  const deleteRow = async (id: string) => {
    await supabase.from('broker_customers').delete().eq('id', id)
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
      return c.client_name?.toLowerCase().includes(q) || c.contact?.includes(q) || c.assignee?.toLowerCase().includes(q)
    }
    return true
  })
  const thisMonth = new Date().toISOString().slice(0, 7)
  const statsBase = assigneeFilter !== '전체' ? customers.filter(c => c.assignee === assigneeFilter) : customers
  const newThisMonth = statsBase.filter(c => c.received_date?.startsWith(thisMonth)).length
  const inProgress = statsBase.filter(c => c.status === '진행중').length
  const contracted = statsBase.filter(c => c.status === '계약완료').length

  // 활성 칼럼 (order 기준으로 정렬)
  const fixedCols = CUST_COLS.filter(c => c.fixed)
  const optionalCols = CUST_COLS.filter(c => !c.fixed)

  type ActiveCol =
    | { type: 'fixed'; def: ColDef }
    | { type: 'optional'; def: ColDef }
    | { type: 'custom'; id: string; name: string }

  const activeCols: ActiveCol[] = loaded
    ? (() => {
        const fromOrder = settings.order.flatMap((key): ActiveCol[] => {
          const fixedDef = fixedCols.find(c => c.key === key)
          if (fixedDef) return [{ type: 'fixed', def: fixedDef }]
          const optDef = optionalCols.find(c => c.key === key)
          if (optDef && settings.visible.includes(key)) return [{ type: 'optional', def: optDef }]
          const customDef = settings.customCols.find(c => c.id === key)
          if (customDef && settings.visible.includes(key)) return [{ type: 'custom', id: customDef.id, name: customDef.name }]
          return []
        })
        const missingFixed = fixedCols
          .filter(c => !settings.order.includes(c.key))
          .map(def => ({ type: 'fixed' as const, def }))
        return [...fromOrder, ...missingFixed]
      })()
    : fixedCols.map(def => ({ type: 'fixed' as const, def }))

  const renderCell = (c: Customer, col: ActiveCol) => {
    if (col.type === 'custom') {
      const customDef = settings.customCols.find(cc => cc.id === col.id)
      if (customDef?.type === 'select') {
        const opts = settings.options[col.id] ?? []
        return <SelectCell value={c.custom_fields?.[col.id] ?? ''} options={opts} onSave={v => saveCustomField(c.id, col.id, v)} />
      }
      return <TextCell value={c.custom_fields?.[col.id] ?? ''} onSave={v => saveCustomField(c.id, col.id, v)} placeholder="—" />
    }
    const def = col.def
    const opts = settings.options[def.key] ?? def.defaultOpts ?? []
    const colorMap = COL_COLORS[def.key]
    switch (def.key) {
      case 'request':       return <TextCell value={c.request} onSave={v => saveField(c.id, 'request', v || null)} placeholder="요청사항" />
      case 'received_date': return <DateCell value={c.received_date} onSave={v => saveField(c.id, 'received_date', v || null)} />
      case 'contact':       return <TextCell value={c.contact} onSave={v => saveField(c.id, 'contact', v || null)} placeholder="연락처" />
      case 'assignee':      return <TextCell value={c.assignee} onSave={v => saveField(c.id, 'assignee', v || null)} placeholder="담당자" />
      case 'category':      return <SelectCell value={c.category} options={opts} onSave={v => saveField(c.id, 'category', v)} colorMap={colorMap} />
      case 'source':        return <SelectCell value={c.source ?? ''} options={opts} onSave={v => saveField(c.id, 'source', v)} colorMap={colorMap} />
      case 'status':        return <SelectCell value={c.status} options={opts} onSave={v => saveField(c.id, 'status', v)} colorMap={colorMap} />
      default: return null
    }
  }

  const getColKey = (col: ActiveCol) => col.type === 'custom' ? col.id : col.def.key
  const getColWidth = (col: ActiveCol) => {
    const key = getColKey(col)
    return settings.widths[key] ?? (col.type === 'custom' ? 120 : (col.def.minWidth ?? 100))
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
            <h1 className="text-2xl font-black text-gray-900">고객목록</h1>
            <p className="text-sm text-gray-400 mt-0.5">전체 {customers.length}명 · 검색 {filtered.length}명</p>
          </div>
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
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="고객명, 연락처, 담당자..."
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
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="border-collapse table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
              <thead>
                <tr className="border-b-2 border-gray-100 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wide select-none">
                  <th className="px-3 py-2.5 text-center border-r border-gray-100" style={{ width: 32 }}>#</th>
                  {activeCols.map(col => {
                    const key = getColKey(col)
                    const w = getColWidth(col)
                    return (
                      <th key={key}
                        className={`px-2 py-2.5 text-left relative border-r border-gray-100 transition-colors ${dragOverCol === key ? 'bg-blue-50' : 'hover:bg-gray-100'} cursor-grab`}
                        style={{ width: w, maxWidth: w }}
                        draggable
                        onDragStart={e => onColDragStart(key, e)}
                        onDragOver={e => onColDragOver(key, e)}
                        onDrop={() => onColDrop(key)}
                        onDragEnd={onColDragEnd}
                      >
                        <div className="pr-2">
                          {col.type === 'custom' ? (
                            <ColumnHeader
                              label={col.name} isCustom
                              hasOptions={settings.customCols.find(cc => cc.id === col.id)?.type === 'select'}
                              options={settings.options[col.id] ?? []}
                              onSetOptions={opts => setOpts(col.id, opts)}
                              onHide={() => hideCol(col.id)}
                              onRename={name => renameCustomCol(col.id, name)}
                              onDelete={() => deleteCustomCol(col.id)}
                            />
                          ) : (
                            <ColumnHeader
                              label={col.def.label}
                              isFixed={col.def.fixed}
                              hasOptions={col.def.hasOptions}
                              options={settings.options[col.def.key] ?? col.def.defaultOpts ?? []}
                              onSetOptions={opts => setOpts(col.def.key, opts)}
                              onHide={() => hideCol(col.def.key)}
                            />
                          )}
                        </div>
                        <div onMouseDown={e => startResize(key, e)}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 transition-all" />
                      </th>
                    )
                  })}
                  <th className="px-2 py-2.5 bg-gray-50" style={{ width: 56, minWidth: 56 }}>
                    <div className="flex items-center justify-end gap-0.5">
                      <AddColBtn onAdd={addCustomCol} />
                      <ColVisibility
                        fixedCols={fixedCols}
                        optionalCols={optionalCols}
                        customCols={settings.customCols}
                        visible={settings.visible}
                        onToggle={key => settings.visible.includes(key) ? hideCol(key) : showCol(key)}
                      />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={activeCols.length + 3} className="py-16 text-center text-sm text-gray-400">
                      {customers.length === 0 ? '아직 등록된 고객이 없어요' : '검색 결과가 없어요'}
                    </td>
                  </tr>
                ) : filtered.map((c, idx) => (
                  <tr key={c.id} className={cn('border-b border-gray-50 hover:bg-gray-50/50 transition-colors', addingId === c.id && 'animate-pulse bg-blue-50/40')}>
                    <td className="px-3 py-1.5 text-center text-xs text-gray-300 font-mono border-r border-gray-100">{filtered.length - idx}</td>
                    {activeCols.map(col => (
                      <td key={getColKey(col)} className="px-3 py-1.5 border-r border-gray-100"
                        style={{ width: getColWidth(col), maxWidth: getColWidth(col) }}>
                        {renderCell(c, col)}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 border-r border-gray-100" />
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => setDeleteConfirm(c.id)}
                        className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={activeCols.length + 3} className="border-t border-gray-100">
                    <button onClick={addRow}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50/80 transition-colors">
                      <Plus className="h-3.5 w-3.5" />고객 등록
                    </button>
                  </td>
                </tr>
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
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">취소</button>
              <button onClick={() => deleteRow(deleteConfirm)} className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
