'use client'

import { useEffect, useState, useMemo, useRef, useCallback, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { formatPrice, cn } from '@/lib/utils'
import {
  Plus, Trash2, Search, ChevronLeft, ChevronRight, ImagePlus, X, Lock, HelpCircle, Copy, SlidersHorizontal, ArrowLeft, Eye, MoreHorizontal, Map, List, Loader2, EyeOff, ChevronDown, Wand2,
} from 'lucide-react'
import { ImageLightbox } from '@/components/image-lightbox'
import { useColSettings, ColSettings } from '@/lib/use-col-settings'

interface Property {
  id: string
  broker_id: string
  deal_type: string
  room_type: string
  address: string
  price: number
  monthly_rent: number | null
  management_fee: number | null
  premium: number | null
  size_pyeong: string | null
  area_type: string | null
  area_unit: string | null
  area_supplied: number | null
  floor: number | null
  total_floors: string | null
  options: string[]
  images: string[]
  brief_memo: string | null
  description: string | null
  memo: string | null
  assignee: string | null
  move_in_date: string | null
  rooms_bathrooms: string | null
  approval_date: string | null
  parking: string | null
  direction: string | null
  status: 'available' | 'contracted' | 'hidden'
  created_at: string
  custom_fields: Record<string, string> | null
}

interface CustomColumn {
  id: string
  name: string
  type?: 'text' | 'select'
}

const STATUS_OPTS = ['available', 'contracted', 'hidden'] as const
const STATUS_LABEL: Record<string, string> = { available: '매물있음', contracted: '계약완료', hidden: '숨김' }
const STATUS_COLOR: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  contracted: 'bg-gray-100 text-gray-600',
  hidden: 'bg-yellow-100 text-yellow-700',
}
const DEAL_TYPES = ['매매', '전세', '월세']
const ROOM_TYPES = ['원룸', '투룸', '쓰리룸 이상', '아파트', '오피스텔', '빌라/연립', '상가', '사무실', '창고/공장', '토지', '기타']
const DIRECTION_OPTS = ['남향', '북향', '동향', '서향', '남동향', '남서향', '북동향', '북서향']
const PARKING_OPTS = ['주차가능', '주차불가', '협의']
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// 고정 칼럼만 (지울 수 없음, 숨길 수는 있음)
const ALL_COLUMNS = [
  { key: 'address',         label: '소재지' },
  { key: 'size_pyeong',     label: '면적(전용/공급)' },
  { key: 'price',           label: '가격' },
  { key: 'room_type',       label: '중개대상물종류' },
  { key: 'deal_type',       label: '거래형태' },
  { key: 'total_floors',    label: '총 층수' },
  { key: 'move_in_date',    label: '입주가능일' },
  { key: 'rooms_bathrooms', label: '방수/욕실수' },
  { key: 'approval_date',   label: '사용승인일' },
  { key: 'parking',         label: '주차' },
  { key: 'management_fee',  label: '관리비' },
  { key: 'direction',       label: '방향' },
  { key: 'images',          label: '사진' },
  { key: 'brief_memo',      label: '매물설명' },
  { key: 'memo',            label: '중개사메모' },
  { key: 'assignee',        label: '담당자' },
] as const
type ColKey = typeof ALL_COLUMNS[number]['key']
const FIXED_COLS: ColKey[] = ALL_COLUMNS.map(c => c.key)
const DEFAULT_VISIBLE: ColKey[] = [...FIXED_COLS]

// 초기 커스텀 칼럼 (기본값 없음)
const DEFAULT_CUSTOM_COLS: CustomColumn[] = []

const DEFAULT_PROP_SETTINGS: ColSettings = {
  visible:    [...FIXED_COLS],
  order:      [...FIXED_COLS],
  widths: {
    address: 200, size_pyeong: 70, price: 96, room_type: 110, deal_type: 72,
    total_floors: 70, move_in_date: 90, rooms_bathrooms: 80,
    approval_date: 90, parking: 72, management_fee: 72,
    direction: 68, images: 56, brief_memo: 140, memo: 140, assignee: 80,
  },
  customCols: [],
  options:    { room_type: [...ROOM_TYPES], deal_type: [...DEAL_TYPES], direction: [...DIRECTION_OPTS] },
  colTypes:   {},
}

// 팝오버를 닫기 위한 훅
function useClickOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, cb])
}

// ── 공통 호버 툴팁 카드 ──────────────────────────────────────────
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

// ── 인라인 텍스트 셀 ──────────────────────────────────────────
function TextCell({ value, onSave, placeholder = '—', className = '' }: {
  value: string | null, onSave: (v: string) => void, placeholder?: string, className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => { setEditing(false); if (draft !== (value ?? '')) onSave(draft) }

  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
        className={`w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300 ${className}`}
      />
    )
  }
  return (
    <>
      <div ref={cellRef} onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className={`w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-gray-100 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis ${className}`}
        style={{ color: value ? '#374151' : '#d1d5db' }}
      >
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}

// ── 소재지 셀 (다음 우편번호 검색 지원) ────────────────────────
function AddressCell({ value, onSave, onAutoFill, autoFilling = false, placeholder = '소재지 입력' }: {
  value: string | null
  onSave: (v: string) => void
  onAutoFill?: () => void
  autoFilling?: boolean
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)
  const skipBlurRef = useRef(false)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    if (skipBlurRef.current) { skipBlurRef.current = false; return }
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  const openPostcode = () => {
    const w = window as any
    if (!w.daum?.Postcode) { alert('주소 검색 모듈을 불러오는 중입니다. 잠시 후 다시 시도해주세요.'); return }
    new w.daum.Postcode({
      oncomplete: (data: any) => {
        const addr = data.jibunAddress || data.roadAddress || data.address || ''
        if (!addr) return
        setDraft(addr)
        setEditing(true)
        setTimeout(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(addr.length, addr.length) }, 0)
      },
    }).open()
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
          className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300"
        />
        <button type="button"
          onMouseDown={e => { e.preventDefault(); skipBlurRef.current = true }}
          onClick={openPostcode}
          className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-500 hover:bg-gray-50 hover:text-blue-600"
          title="주소 검색"
        >
          <Search className="h-3 w-3" />
        </button>
        {onAutoFill && (
          <button type="button"
            onMouseDown={e => { e.preventDefault(); skipBlurRef.current = true }}
            onClick={onAutoFill}
            disabled={autoFilling || !value}
            className="shrink-0 rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-500 hover:bg-gray-50 hover:text-indigo-600 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-gray-500"
            title={value ? '건축물대장에서 면적·층·승인일·주차·유형 자동채움' : '주소를 먼저 입력하세요'}
          >
            {autoFilling
              ? <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
              : <Wand2 className="h-3 w-3" />}
          </button>
        )}
      </div>
    )
  }
  return (
    <>
      <div ref={cellRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="group flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-gray-100 min-h-[22px]"
      >
        <span onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
          className="min-w-0 flex-1 cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis"
          style={{ color: value ? '#374151' : '#d1d5db' }}
        >
          {value || placeholder}
        </span>
        <button type="button" onClick={openPostcode}
          className="shrink-0 rounded p-0.5 text-gray-300 opacity-0 transition-opacity hover:text-blue-500 group-hover:opacity-100"
          title="주소 검색"
        >
          <Search className="h-3 w-3" />
        </button>
        {onAutoFill && (
          <button type="button" onClick={onAutoFill} disabled={autoFilling || !value}
            className={cn(
              'shrink-0 rounded p-0.5 transition-opacity hover:text-indigo-500 group-hover:opacity-100 disabled:cursor-not-allowed disabled:hover:text-gray-300',
              autoFilling ? 'opacity-100 text-indigo-500' : 'opacity-0 text-gray-300'
            )}
            title={value ? '건축물대장에서 면적·층·승인일·주차·유형 자동채움' : '주소를 먼저 입력하세요'}
          >
            {autoFilling
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Wand2 className="h-3 w-3" />}
          </button>
        )}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}

// ── 인라인 숫자 셀 ──────────────────────────────────────────
function NumberCell({ value, onSave, suffix = '만' }: {
  value: number | null, onSave: (v: number | null) => void, suffix?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    const num = draft.trim() === '' ? null : Number(draft)
    if (num !== value) onSave(isNaN(num as number) ? null : num)
  }

  if (editing) {
    return (
      <input ref={inputRef} type="number" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value != null ? String(value) : ''); setEditing(false) } }}
        className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs text-right outline-none focus:ring-2 focus:ring-blue-300"
      />
    )
  }
  const displayText = value != null ? `${value.toLocaleString()}${suffix}` : '—'
  return (
    <>
      <div ref={cellRef} onClick={() => { setDraft(value != null ? String(value) : ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (!!value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className={`w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap ${value ? 'text-gray-800 font-semibold' : 'text-gray-300'}`}
      >
        {displayText}
      </div>
      {hovered && !!value && <CellTooltip text={displayText} anchorRef={cellRef} />}
    </>
  )
}

// ── 팝오버 선택 셀 ──────────────────────────────────────────
function SelectCell({ value, options, onSave, colorMap }: {
  value: string, options: string[], onSave: (v: string) => void, colorMap?: Record<string, string>
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
        {value}
      </div>
      {open && (
        <div className={`rounded-xl border border-gray-200 bg-white shadow-lg py-1 ${options.length > 5 ? 'grid grid-cols-2 min-w-[200px]' : 'flex flex-col min-w-[120px]'}`} style={popupStyle}>
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

// ── 면적 셀 (전용·공급 각각 입력) ──────────────────────────
function AreaCell({ size, supplied, areaUnit, onSave }: {
  size: string | null          // 전용 면적
  supplied: number | null      // 공급 면적
  areaUnit: string | null
  onSave: (dedicated: string | null, supplied: string | null, unit: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const [draftDedicated, setDraftDedicated] = useState(size ?? '')
  const [draftSupplied, setDraftSupplied] = useState(supplied != null ? String(supplied) : '')
  const [draftUnit, setDraftUnit] = useState<'평' | 'm²'>((areaUnit as any) ?? '평')
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    onSave(draftDedicated || null, draftSupplied || null, draftUnit)
    setOpen(false)
  }

  useClickOutside(ref, () => { if (open) commit() })
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const handleOpen = () => {
    setDraftDedicated(size ?? '')
    setDraftSupplied(supplied != null ? String(supplied) : '')
    setDraftUnit((areaUnit as any) ?? '평')
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const openUp = window.innerHeight - rect.bottom < 180
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: rect.left }
      if (openUp) s.bottom = window.innerHeight - rect.top + 4
      else s.top = rect.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v)
    setHovered(false)
  }

  // 표시 텍스트 조합
  const unit = areaUnit ?? '평'
  const hasDed = !!size
  const hasSup = supplied != null
  const displayText = hasDed && hasSup
    ? `${size}/${supplied}${unit}`
    : hasDed ? `${size}${unit}`
    : hasSup ? `${supplied}${unit}`
    : null

  return (
    <div ref={ref} className="relative">
      <div ref={btnRef}
        onClick={handleOpen}
        onMouseEnter={() => { if (!open && displayText) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-gray-100 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: displayText ? '#374151' : '#d1d5db' }}
      >
        {displayText ?? '전용/공급'}
      </div>
      {hovered && displayText && <CellTooltip text={displayText} anchorRef={btnRef} />}
      {open && (
        <div className="w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-2 space-y-1.5" style={popupStyle}>
          {/* 단위 토글 */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['평', 'm²'] as const).map(u => (
              <button key={u} type="button" onClick={() => setDraftUnit(u)}
                className={cn('flex-1 py-1 text-xs font-semibold transition-colors',
                  draftUnit === u ? 'bg-blue-500 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                )}>{u}</button>
            ))}
          </div>
          {/* 전용 */}
          <div className="flex items-center gap-1">
            <span className="w-7 flex-shrink-0 text-xs text-gray-500">전용</span>
            <input
              ref={inputRef}
              type="number"
              value={draftDedicated}
              placeholder=""
              onChange={e => setDraftDedicated(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setOpen(false) }}
              className="w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
            />
            <span className="w-6 flex-shrink-0 text-right text-xs text-gray-400">{draftUnit}</span>
          </div>
          {/* 공급 */}
          <div className="flex items-center gap-1">
            <span className="w-7 flex-shrink-0 text-xs text-gray-500">공급</span>
            <input
              type="number"
              value={draftSupplied}
              placeholder=""
              onChange={e => setDraftSupplied(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setOpen(false) }}
              className="w-0 flex-1 rounded border border-gray-200 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
            />
            <span className="w-6 flex-shrink-0 text-right text-xs text-gray-400">{draftUnit}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 긴 텍스트 셀 (메모/설명용 — textarea 편집 + 공통 툴팁) ──────────
function LongTextCell({ value, onSave, placeholder = '—' }: {
  value: string | null, onSave: (v: string) => void, placeholder?: string
}) {
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
        className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300 resize-none"
      />
    )
  }
  return (
    <>
      <div ref={cellRef} onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-gray-100 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db' }}
      >
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}

// ── 날짜 셀 ──────────────────────────────────────────
function DateCell({ value, onSave }: { value: string | null; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [viewYear, setViewYear] = useState(() => { const d = value ? new Date(value) : new Date(); return isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear() })
  const [viewMonth, setViewMonth] = useState(() => { const d = value ? new Date(value) : new Date(); return isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth() })
  const btnRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!btnRef.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) { commit(); setOpen(false) } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open, draft])
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])
  const handleOpen = () => {
    if (open) return
    setDraft(value ?? '')
    const d = value ? new Date(value) : new Date(); const base = isNaN(d.getTime()) ? new Date() : d
    setViewYear(base.getFullYear()); setViewMonth(base.getMonth())
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopStyle({ position: 'fixed', zIndex: 9999, top: r.bottom + 4 + 260 > window.innerHeight ? r.top - 264 : r.bottom + 4, left: r.left + 240 > window.innerWidth ? window.innerWidth - 248 : r.left })
    }
    setOpen(true)
  }
  const commit = () => { if (draft && draft !== (value ?? '')) onSave(draft); setOpen(false) }
  const selectDate = (y: number, m: number, d: number) => { const str = `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; setDraft(str); onSave(str); setOpen(false) }
  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11) } else setViewMonth(m => m-1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0) } else setViewMonth(m => m+1) }
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i+1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const today = new Date(); const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const selectedStr = value ?? ''
  return (
    <div className="relative w-full">
      <div ref={btnRef} onClick={handleOpen} className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis" style={{ color: value ? '#374151' : '#d1d5db' }}>{value || '날짜'}</div>
      {open && (
        <div ref={popupRef} className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={{ ...popStyle, width: 240 }}>
          <div className="p-2 border-b border-gray-100">
            <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setOpen(false) }} placeholder="2026-05-13" className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20" />
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <button onClick={prevMonth} className="flex h-6 w-6 items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-xs font-bold">‹</button>
            <span className="text-xs font-semibold text-gray-700">{viewYear}년 {viewMonth+1}월</span>
            <button onClick={nextMonth} className="flex h-6 w-6 items-center justify-center rounded hover:bg-gray-100 text-gray-500 text-xs font-bold">›</button>
          </div>
          <div className="grid grid-cols-7 px-2 pb-1">{['일','월','화','수','목','금','토'].map((d,i) => <div key={d} className={`text-center text-[10px] font-medium pb-1 ${i===0?'text-red-400':i===6?'text-blue-400':'text-gray-400'}`}>{d}</div>)}</div>
          <div className="grid grid-cols-7 px-2 pb-2 gap-y-0.5">
            {cells.map((day, i) => { if (!day) return <div key={i} />; const str = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`; const isSelected = str===selectedStr; const isToday = str===todayStr; const col = i%7; return (<button key={i} onClick={() => selectDate(viewYear, viewMonth, day)} className={`flex h-7 w-7 mx-auto items-center justify-center rounded-full text-xs transition-colors ${isSelected?'bg-blue-600 text-white font-bold':isToday?'border border-blue-400 text-blue-600 font-semibold hover:bg-blue-50':col===0?'text-red-400 hover:bg-red-50':col===6?'text-blue-400 hover:bg-blue-50':'text-gray-700 hover:bg-gray-100'}`}>{day}</button>) })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 사진 셀 ──────────────────────────────────────────
function ImageCell({ images, onSave, onView }: {
  images: string[], onSave: (imgs: string[]) => void, onView: (idx: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const [newPreviews, setNewPreviews] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [localImgs, setLocalImgs] = useState<string[]>(images)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  useEffect(() => { setLocalImgs(images) }, [images])
  useClickOutside(ref, () => { if (open) { saveAndClose() } })

  const handleAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (localImgs.length + newFiles.length + files.length > 5) return
    setNewFiles(p => [...p, ...files])
    files.forEach(f => { const r = new FileReader(); r.onload = ev => setNewPreviews(p => [...p, ev.target?.result as string]); r.readAsDataURL(f) })
  }

  const saveAndClose = async () => {
    let uploaded: string[] = []
    if (newFiles.length > 0) {
      const { data } = await supabase.auth.getUser()
      const uid = data.user?.id ?? 'unknown'
      for (const file of newFiles) {
        const ext = file.name.split('.').pop()
        const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage.from('property-images').upload(path, file, { upsert: false })
        if (!error) {
          const { data: { publicUrl } } = supabase.storage.from('property-images').getPublicUrl(path)
          uploaded.push(publicUrl)
        }
      }
    }
    const all = [...localImgs, ...uploaded]
    setNewFiles([]); setNewPreviews([]); setOpen(false)
    onSave(all)
  }

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const openUp = window.innerHeight - rect.bottom < 260
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: rect.left }
      if (openUp) s.bottom = window.innerHeight - rect.top + 4
      else s.top = rect.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v)
  }

  return (
    <div ref={ref} className="relative">
      <div ref={btnRef} onClick={handleOpen} className="cursor-pointer flex gap-1 items-center hover:bg-blue-50 rounded px-1 py-0.5 min-h-[22px]">
        {localImgs.length === 0
          ? <span className="text-xs text-gray-300">—</span>
          : <>
              <div className="h-6 w-6 overflow-hidden rounded border border-gray-200 flex-shrink-0">
                <img src={localImgs[0]} alt="" className="h-full w-full object-cover" />
              </div>
              {localImgs.length > 1 && <span className="text-[10px] text-gray-400">+{localImgs.length - 1}</span>}
            </>
        }
      </div>
      {open && (
        <div className="w-64 rounded-xl border border-gray-200 bg-white shadow-lg p-3" style={popupStyle}>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {localImgs.map((src, i) => (
              <div key={i} className="relative h-14 w-14 overflow-hidden rounded-lg border border-gray-200 group">
                <img src={src} alt="" className="h-full w-full object-cover cursor-pointer" onClick={() => { setOpen(false); onView(i) }} />
                <button onClick={() => { const next = localImgs.filter((_, idx) => idx !== i); setLocalImgs(next) }}
                  className="absolute top-0.5 right-0.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-black/50 text-white text-[9px]"
                >✕</button>
              </div>
            ))}
            {newPreviews.map((src, i) => (
              <div key={`n-${i}`} className="relative h-14 w-14 overflow-hidden rounded-lg border border-blue-200">
                <img src={src} alt="" className="h-full w-full object-cover" />
                <button onClick={() => { setNewFiles(p => p.filter((_, idx) => idx !== i)); setNewPreviews(p => p.filter((_, idx) => idx !== i)) }}
                  className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/50 text-white text-[9px]"
                >✕</button>
              </div>
            ))}
            {localImgs.length + newFiles.length < 5 && (
              <label className="flex h-14 w-14 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:border-blue-400 transition-colors">
                <ImagePlus className="h-4 w-4" />
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleAdd} />
              </label>
            )}
          </div>
          <button onClick={saveAndClose} className="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors">
            저장
          </button>
        </div>
      )}
    </div>
  )
}

// ── 컬럼 헤더 툴팁 아이콘 ──────────────────────────────────────────
function TooltipIcon({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  const [tipStyle, setTipStyle] = useState<React.CSSProperties>({})
  const iconRef = useRef<HTMLSpanElement>(null)

  const handleMouseEnter = () => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect()
      const style: React.CSSProperties = {
        position: 'fixed',
        top: rect.bottom + 6,
        zIndex: 9999,
        whiteSpace: 'nowrap',
      }
      // 화면 왼쪽 절반 → 오른쪽으로, 오른쪽 절반 → 왼쪽으로 정렬
      if (rect.left < window.innerWidth / 2) {
        style.left = rect.left
      } else {
        style.right = window.innerWidth - rect.right
      }
      setTipStyle(style)
    }
    setShow(true)
  }

  return (
    <span
      ref={iconRef}
      className="inline-flex flex-shrink-0"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setShow(false)}
    >
      <HelpCircle className="h-3.5 w-3.5 text-gray-400 cursor-help" />
      {show && (
        <span
          className="pointer-events-none rounded-lg bg-gray-800 px-2.5 py-1.5 text-[11px] leading-tight text-white shadow-xl"
          style={tipStyle}
        >
          {text}
        </span>
      )}
    </span>
  )
}

// ── ColumnHeader (헤더 클릭 설정) ────────────────────────
function PropColHeader({ label, isCustom, hasOptions, options, onSetOptions, colType, onChangeType, onHide, onRename, onDelete }: {
  label: string; isCustom?: boolean; hasOptions?: boolean
  options?: string[]; onSetOptions?: (opts: string[]) => void
  colType?: 'text' | 'select'; onChangeType?: (type: 'text' | 'select') => void
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

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setStyle({ position: 'fixed', zIndex: 9999, top: r.bottom + 2, left: Math.min(r.left, window.innerWidth - 220), minWidth: 200 })
    }
    setOpen(v => !v)
  }

  const commitRename = () => {
    const v = renameVal.trim()
    if (v && v !== label) onRename?.(v)
    setRenaming(false); setOpen(false)
  }

  const addOpt = () => {
    const v = newOpt.trim()
    if (!v || !options || options.includes(v)) return
    onSetOptions?.([...options, v]); setNewOpt('')
  }

  return (
    <div ref={containerRef} className="relative">
      <div ref={btnRef} onClick={handleOpen}
        className="flex items-center gap-1 select-none cursor-pointer group">
        <span className="text-xs font-semibold text-gray-500 truncate">{label}</span>
        <ChevronDown className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
      </div>
      {open && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={style}
          onClick={e => e.stopPropagation()}>
          <div className="px-3 py-2 border-b border-gray-100 text-xs font-bold text-gray-700">{label}</div>
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
            </>
          )}
          {onChangeType && colType && (
            <div className="px-3 py-2 border-t border-gray-100">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">칼럼 유형</div>
              <div className="flex gap-1">
                <button onClick={() => onChangeType('text')}
                  className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${colType === 'text' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  텍스트
                </button>
                <button onClick={() => onChangeType('select')}
                  className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors ${colType === 'select' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  선택
                </button>
              </div>
            </div>
          )}
          <button onClick={() => { onHide?.(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 transition-colors border-t border-gray-100">
            <EyeOff className="h-3.5 w-3.5 text-gray-400" />이 칼럼 숨기기
          </button>
          {hasOptions && options && (
            <>
              <div className="border-t border-gray-100" />
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
          {isCustom && (
            <button onClick={() => { onDelete?.(); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors border-t border-gray-100">
              <X className="h-3.5 w-3.5" />칼럼 완전 삭제
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── ColAdder (숨김 복원 + 새 칼럼) ───────────────────────
function PropColAdder({ hiddenFixed, customCols, visibleCustom, onShowFixed, onShowCustom, onAddCustom, asHeaderButton }: {
  hiddenFixed: Array<{ key: string; label: string }>
  customCols: CustomColumn[]
  visibleCustom: string[]
  onShowFixed: (key: string) => void
  onShowCustom: (id: string) => void
  onAddCustom: (name: string) => void
  asHeaderButton?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})
  const [showInput, setShowInput] = useState(false)
  const [addingName, setAddingName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => { setOpen(false); setShowInput(false); setAddingName('') })

  const hiddenCustom = customCols.filter(c => !visibleCustom.includes(c.id))

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setStyle({ position: 'fixed', zIndex: 9999, top: r.bottom + 2, right: Math.max(4, window.innerWidth - r.right), minWidth: 200 })
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
          {hiddenFixed.length > 0 ? hiddenFixed.map(col => (
            <button key={col.key} onClick={() => { onShowFixed(col.key); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
              <span className="text-gray-300 font-bold">+</span>{col.label}
            </button>
          )) : (
            <div className="px-3 py-1.5 text-xs text-gray-400">모두 표시 중</div>
          )}

          {/* 내 칼럼 섹션 */}
          <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">내 칼럼</div>
          {hiddenCustom.map(col => (
            <button key={col.id} onClick={() => { onShowCustom(col.id); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
              <span className="text-gray-300 font-bold">+</span>{col.name}
            </button>
          ))}

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
  const popupRef = useRef<HTMLDivElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) {
        setOpen(false); setName(''); setType('text')
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
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
    <div className="relative">
      <button ref={btnRef} onClick={handleOpen}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-500 cursor-pointer transition-colors text-sm font-bold leading-none">
        +
      </button>
      {open && createPortal(
        <div ref={popupRef} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white shadow-xl p-2.5" style={popStyle}>
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
        </div>,
        document.body
      )}
    </div>
  )
}

// ── PropColVisibility ─────────────────────────────────────
function PropColVisibility({ allFixed, customCols, visible, onToggle }: {
  allFixed: ReadonlyArray<{ readonly key: string; readonly label: string }>
  customCols: CustomColumn[]
  visible: string[]
  onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopStyle({ position: 'fixed', top: r.bottom + 4, left: Math.max(8, r.right - 260), zIndex: 9999, width: 260 })
    }
    setOpen(v => !v)
  }

  const all = [
    ...allFixed.map(c => ({ key: c.key, label: c.label })),
    ...customCols.map(c => ({ key: c.id, label: c.name })),
  ]
  const rows = search ? all.filter(c => c.label.includes(search)) : all

  return (
    <div className="relative">
      <button ref={btnRef} onClick={handleOpen}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-gray-200 hover:text-gray-500 cursor-pointer transition-colors">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && createPortal(
        <div ref={popupRef} className="rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden" style={popStyle}>
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
                className="flex items-center justify-between px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                onClick={() => onToggle(c.key)}>
                <span className={`text-xs font-medium ${visible.includes(c.key) ? 'text-gray-700' : 'text-gray-400'}`}>{c.label}</span>
                <Eye className={`h-3.5 w-3.5 flex-shrink-0 ${visible.includes(c.key) ? 'text-gray-400' : 'text-gray-200'}`} />
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────
export default function BrokerPropertiesPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    }>
      <BrokerPropertiesContent />
    </Suspense>
  )
}

function BrokerPropertiesContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [canEdit, setCanEdit] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [isAdminView, setIsAdminView] = useState(false)
  const [isOwner, setIsOwner] = useState(true)
  const [adminViewBrokerName, setAdminViewBrokerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [filterDealType, setFilterDealType] = useState('')
  const [filterRoomType, setFilterRoomType] = useState('')
  const [showFilter, setShowFilter] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [isMapView, setIsMapView] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const overlaysRef = useRef<any[]>([])
  const infoOverlaysRef = useRef<any[]>([])
  const [addingId, setAddingId] = useState<string | null>(null)
  const [autoFillingId, setAutoFillingId] = useState<string | null>(null)
  const [autoFillToast, setAutoFillToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'property' | 'column'; id: string; label?: string } | null>(null)
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([])
  const [settingsBrokerId, setSettingsBrokerId] = useState<string | null>(null)
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const wasDragRef = useRef(false)

  // 칼럼 설정 (DB)
  const { settings, update, loaded: colLoaded } = useColSettings('properties', settingsBrokerId, DEFAULT_PROP_SETTINGS)

  // 고정 칼럼이 settings.order에 없는 경우 추가 (첫 로드 또는 새 칼럼 추가시)
  const syncedOrder = useMemo(() => {
    const order = settings.order
    const missingFixed = FIXED_COLS.filter(k => !order.includes(k))
    const missingCustom = customColumns.filter(c => !order.includes(c.id)).map(c => c.id)
    const missing = [...missingFixed, ...missingCustom]
    return missing.length > 0 ? [...order, ...missing] : order
  }, [settings.order, customColumns])

  // 칼럼 너비 드래그 조절
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const startX = e.clientX
    const startW = settings.widths[key] ?? 100
    const onMove = (ev: MouseEvent) => update(prev => ({ ...prev, widths: { ...prev.widths, [key]: Math.max(40, startW + ev.clientX - startX) } }))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }

  // 칼럼 순서 드래그
  const onColDragStart = (key: string, e: React.DragEvent) => { wasDragRef.current = true; setDragCol(key); e.dataTransfer.effectAllowed = 'move' }
  const onColDragOver = (key: string, e: React.DragEvent) => { e.preventDefault(); setDragOverCol(key) }
  const onColDrop = (key: string) => {
    if (!dragCol || dragCol === key) return
    update(prev => {
      const arr = [...prev.order]; const fi = arr.indexOf(dragCol); const ti = arr.indexOf(key)
      if (fi < 0 || ti < 0) return prev; arr.splice(fi, 1); arr.splice(ti, 0, dragCol); return { ...prev, order: arr }
    })
    setDragCol(null); setDragOverCol(null)
  }
  const onColDragEnd = () => { setDragCol(null); setDragOverCol(null); setTimeout(() => { wasDragRef.current = false }, 50) }

  // 칼럼 표시/숨김
  const hideCol = (key: string) => update(prev => ({ ...prev, visible: prev.visible.filter(k => k !== key) }))
  const showCol = (key: string) => update(prev => ({
    ...prev,
    visible: [...prev.visible, key],
    order: prev.order.includes(key) ? prev.order : [...prev.order, key],
  }))

  useEffect(() => { init() }, [])
  useEffect(() => { setPage(1) }, [filterDealType, filterRoomType, searchQuery, pageSize])

  // 카카오맵 SDK 로드
  useEffect(() => {
    if (typeof window === 'undefined') return
    const w = window as any

    const KAKAO_KEY = '700a493a80faeb786caaa05bea56e4ad'

    const onReady = () => {
      w.kakao.maps.load(() => setMapReady(true))
    }

    // 이미 SDK 로드됨
    if (w.kakao?.maps) { onReady(); return }

    // 스크립트 태그 이미 있음 → 로드 완료 대기
    if (document.querySelector('script[data-kakao-map]')) {
      const poll = setInterval(() => {
        if ((window as any).kakao?.maps) { clearInterval(poll); onReady() }
      }, 200)
      return () => clearInterval(poll)
    }

    const script = document.createElement('script')
    script.setAttribute('data-kakao-map', 'true')
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services&autoload=false`
    script.async = true
    script.onload = onReady
    script.onerror = (e) => console.error('[KakaoMap] SDK 로드 실패', { src: script.src, event: e })
    document.head.appendChild(script)
  }, [])

  // 다음 우편번호 SDK 로드 (소재지 검색용)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ((window as any).daum?.Postcode) return
    if (document.querySelector('script[data-daum-postcode]')) return
    const script = document.createElement('script')
    script.setAttribute('data-daum-postcode', 'true')
    script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
    script.async = true
    script.onerror = () => console.error('[DaumPostcode] SDK 로드 실패')
    document.head.appendChild(script)
  }, [])

  const init = async () => {
    let u: any = null
    try { const { data } = await supabase.auth.getUser(); u = data.user } catch { router.push('/auth/login'); return }
    if (!u) { router.push('/auth/login'); return }
    setUser(u)

    const targetBrokerId = searchParams.get('broker_id')

    // 어드민이 다른 중개사 매물장을 보는 경우
    if (targetBrokerId) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', u.id).single()
      if (profile?.role !== 'admin') { router.push('/broker/properties'); return }

      const { data: b } = await supabase.from('broker_profiles').select('id, custom_columns, office_name, profiles(name)').eq('id', targetBrokerId).single()
      if (!b) { router.push('/admin'); return }
      setBroker(b)
      setIsAdminView(true)
      setAdminViewBrokerName((b.profiles as any)?.name || b.office_name || '(이름 없음)')
      const cols: CustomColumn[] = b.custom_columns?.length > 0 ? b.custom_columns : DEFAULT_CUSTOM_COLS
      setCustomColumns(cols)
      // 어드민 본인의 broker profile ID로 settings 로드
      const { data: ownBroker } = await supabase.from('broker_profiles').select('id').eq('user_id', u.id).single()
      if (ownBroker) setSettingsBrokerId(ownBroker.id)
      const { data } = await supabase.from('broker_properties').select('*').eq('broker_id', b.id).order('created_at', { ascending: false })
      setProperties(data ?? [])
      setLoading(false)
      return
    }

    // 일반 중개사 본인 매물장
    const { data: b } = await supabase.from('broker_profiles').select('id, custom_columns, is_owner, parent_broker_id, permissions, is_approved').eq('user_id', u.id).single()
    if (!b) { router.push('/broker/register'); return }
    setBroker(b)
    setSettingsBrokerId(b.id)

    // ── 권한 체크 (직원만) ──────────────────────────────
    const owner = b.is_owner !== false
    setIsOwner(owner)
    if (!owner) {
      if (b.is_approved === false) { setAccessDenied(true); setLoading(false); return }
      const perms = b.permissions
      if (perms?.properties?.view === false) { setAccessDenied(true); setLoading(false); return }
      setCanEdit(perms ? perms.properties?.edit !== false : true)
    }

    // ── 커스텀 칼럼 로드 ───────────────────────────────
    const cols: CustomColumn[] = b.custom_columns?.length > 0 ? b.custom_columns : DEFAULT_CUSTOM_COLS
    setCustomColumns(cols)

    // ── 데이터 범위 결정 ───────────────────────────────
    let brokerIds: string[] = [b.id]
    if (owner) {
      const { data: employees } = await supabase.from('broker_profiles').select('id').eq('parent_broker_id', b.id)
      if (employees) brokerIds = [b.id, ...employees.map((e: any) => e.id)]
    } else if (b.permissions?.can_see_others !== false && b.parent_broker_id) {
      const { data: siblings } = await supabase.from('broker_profiles').select('id').eq('parent_broker_id', b.parent_broker_id)
      if (siblings) brokerIds = siblings.map((e: any) => e.id)
      if (!brokerIds.includes(b.parent_broker_id)) brokerIds.push(b.parent_broker_id)
    }

    const { data } = await supabase.from('broker_properties').select('*').in('broker_id', brokerIds).order('created_at', { ascending: false })
    setProperties(data ?? [])
    setLoading(false)
  }

  // 단일 필드 저장
  const saveField = useCallback(async (id: string, field: string, value: any) => {
    await supabase.from('broker_properties').update({ [field]: value }).eq('id', id)
    setProperties(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }, [])

  // 행 자동 채움: 주소 → 카카오 지오코딩 → 세움터 API → 같은 행 다중 필드 일괄 업데이트
  const autoFillRow = useCallback(async (id: string, addr: string) => {
    if (!addr?.trim()) {
      setAutoFillToast({ type: 'error', text: '소재지를 먼저 입력해주세요' })
      setTimeout(() => setAutoFillToast(null), 2500)
      return
    }
    setAutoFillingId(id)
    try {
      // 카카오 SDK 보장: 스크립트 로드 + services 라이브러리 초기화까지
      const kakao: any = await (async () => {
        const w = window as any
        if (w.kakao?.maps?.services) return w.kakao

        // SDK 스크립트가 아예 없으면 직접 삽입
        if (!document.querySelector('script[data-kakao-map]')) {
          const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY || '700a493a80faeb786caaa05bea56e4ad'
          const script = document.createElement('script')
          script.setAttribute('data-kakao-map', 'true')
          script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`
          script.async = true
          document.head.appendChild(script)
        }

        // kakao.maps.load 함수 등장까지 대기 (최대 10초)
        await new Promise<void>((resolve, reject) => {
          const start = Date.now()
          const check = () => {
            if (w.kakao?.maps?.load) return resolve()
            if (Date.now() - start >= 10000) return reject(new Error('지도 SDK 스크립트 로드 실패. 새로고침 후 다시 시도해주세요'))
            setTimeout(check, 200)
          }
          check()
        })

        // services 라이브러리 초기화 (load 콜백 안에서 services 사용 가능)
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('지도 services 라이브러리 초기화 시간 초과')), 8000)
          w.kakao.maps.load(() => { clearTimeout(timeout); resolve() })
        })

        if (!w.kakao?.maps?.services) {
          throw new Error('지도 services 라이브러리를 사용할 수 없습니다')
        }
        return w.kakao
      })()
      const hoMatch = addr.match(/(\d+)\s*호/)
      const ho = hoMatch ? hoMatch[1] : ''
      let searchAddr = addr.replace(/\s*[Bb]?\d+층\s*/g, ' ').trim()
      if (hoMatch) searchAddr = searchAddr.slice(0, hoMatch.index).trim()
      searchAddr = searchAddr.replace(/\s+/g, ' ')

      const geo: { b_code: string; bun: string; ji: string; road: string; jibun: string } =
        await new Promise((resolve, reject) => {
          const geocoder = new kakao.maps.services.Geocoder()
          const candidates = [searchAddr]
          const stripped = searchAddr.replace(/\s+\d+(-\d+)?$/, '').trim()
          if (stripped && stripped !== searchAddr) candidates.push(stripped)
          let idx = 0
          const tryNext = () => {
            if (idx >= candidates.length) return reject(new Error('주소를 찾을 수 없습니다'))
            const q = candidates[idx++]
            geocoder.addressSearch(q, (result: any[], status: string) => {
              if (status === kakao.maps.services.Status.OK && result.length > 0) {
                const r = result[0]
                resolve({
                  b_code: r.address?.b_code ?? '',
                  bun: r.address?.main_address_no ?? '',
                  ji: r.address?.sub_address_no || '0',
                  road: r.road_address?.address_name ?? '',
                  jibun: r.address?.address_name ?? '',
                })
              } else {
                tryNext()
              }
            })
          }
          tryNext()
        })

      if (!geo.b_code || geo.b_code.length !== 10) {
        throw new Error('법정동 코드 변환 실패')
      }

      const res = await fetch('/api/properties/auto-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sigunguCd: geo.b_code.slice(0, 5),
          bjdongCd: geo.b_code.slice(5),
          bun: geo.bun,
          ji: geo.ji,
          ho,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '세움터 조회 실패')

      const normalizedAddr = geo.road
        ? (ho ? `${geo.road} ${ho}호` : geo.road)
        : (geo.jibun ? (ho ? `${geo.jibun} ${ho}호` : geo.jibun) : addr)

      const updates: Record<string, any> = {}
      if (normalizedAddr && normalizedAddr !== addr) updates.address = normalizedAddr
      if (data.size_pyeong != null) {
        updates.size_pyeong = String(data.size_pyeong)
        updates.area_unit = '평'
        updates.area_type = '전용'
      }
      if (data.total_floors != null) {
        updates.total_floors = data.floor != null
          ? `${data.floor}/${data.total_floors}`
          : String(data.total_floors)
      }
      if (data.approval_date) updates.approval_date = data.approval_date
      if (data.parking) updates.parking = data.parking
      if (data.room_type) updates.room_type = data.room_type

      const keys = Object.keys(updates)
      if (keys.length > 0) {
        await supabase.from('broker_properties').update(updates).eq('id', id)
        setProperties(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))
      }

      const labels: Record<string, string> = {
        address: '주소', size_pyeong: '면적', total_floors: '층',
        approval_date: '승인일', parking: '주차', room_type: '유형',
      }
      const filledNames = Object.keys(updates)
        .map(k => labels[k]).filter(Boolean) as string[]
      setAutoFillToast({
        type: 'success',
        text: filledNames.length > 0
          ? `자동채움: ${filledNames.join(' · ')}${data.building_name ? ` (${data.building_name})` : ''}`
          : '건축물대장 조회됨 (변경 없음)',
      })
    } catch (e: any) {
      setAutoFillToast({ type: 'error', text: e?.message ?? '자동채움 실패' })
    } finally {
      setAutoFillingId(null)
      setTimeout(() => setAutoFillToast(null), 3500)
    }
  }, [supabase])

  // 커스텀 필드 값 저장
  const saveCustomField = useCallback(async (propertyId: string, colId: string, value: string) => {
    const prop = properties.find(p => p.id === propertyId)
    const updated = { ...(prop?.custom_fields ?? {}), [colId]: value }
    await supabase.from('broker_properties').update({ custom_fields: updated }).eq('id', propertyId)
    setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, custom_fields: updated } : p))
  }, [properties])

  // 커스텀 칼럼 추가
  const addCustomColumn = async (name: string, type: 'text' | 'select' = 'text') => {
    if (!name.trim() || !broker) return
    const newCol: CustomColumn = { id: `col_${Date.now()}`, name: name.trim(), type }
    const updated = [...customColumns, newCol]
    await supabase.from('broker_profiles').update({ custom_columns: updated }).eq('id', broker.id)
    setCustomColumns(updated)
    update(prev => ({
      ...prev,
      order: [...prev.order, newCol.id],
      visible: [...prev.visible, newCol.id],
      widths: { ...prev.widths, [newCol.id]: 120 },
      options: type === 'select' ? { ...prev.options, [newCol.id]: [] } : prev.options,
    }))
  }

  // 커스텀 칼럼 이름 수정
  const renameCustomColumn = async (id: string, name: string) => {
    if (!name.trim() || !broker) return
    const updated = customColumns.map(c => c.id === id ? { ...c, name: name.trim() } : c)
    await supabase.from('broker_profiles').update({ custom_columns: updated }).eq('id', broker.id)
    setCustomColumns(updated)
  }

  // 칼럼 옵션 저장
  const setOpts = (key: string, opts: string[]) => update(prev => ({ ...prev, options: { ...prev.options, [key]: opts } }))

  // 고정 칼럼 타입 변경
  const changeFixedColType = (key: string, type: 'text' | 'select') => {
    update(prev => ({ ...prev, colTypes: { ...prev.colTypes, [key]: type } }))
  }

  // 커스텀 칼럼 타입 변경
  const changeCustomColumnType = async (id: string, type: 'text' | 'select') => {
    if (!broker) return
    const updated = customColumns.map(c => c.id === id ? { ...c, type } : c)
    await supabase.from('broker_profiles').update({ custom_columns: updated }).eq('id', broker.id)
    setCustomColumns(updated)
    update(prev => ({
      ...prev,
      options: type === 'select' && !prev.options[id] ? { ...prev.options, [id]: [] } : prev.options,
    }))
  }

  // 커스텀 칼럼 삭제
  const deleteCustomColumn = (id: string) => {
    if (!broker) return
    const col = customColumns.find(c => c.id === id)
    setDeleteConfirm({ type: 'column', id, label: col?.name })
  }

  const addNewRow = async () => {
    if (!broker) return
    const { data, error } = await supabase.from('broker_properties').insert({
      broker_id: broker.id,
      deal_type: '매매',
      room_type: '아파트',
      address: '',
      price: 0,
      status: 'available',
      options: [],
      images: [],
    }).select().single()
    if (error || !data) return
    setProperties(prev => [data, ...prev])
    setAddingId(data.id)
    setPage(1)
    setTimeout(() => setAddingId(null), 2000)
  }

  const deleteProperty = (id: string) => {
    setDeleteConfirm({ type: 'property', id })
  }

  const confirmDelete = async () => {
    if (!deleteConfirm) return
    if (deleteConfirm.type === 'property') {
      await supabase.from('broker_properties').delete().eq('id', deleteConfirm.id)
      setProperties(prev => prev.filter(p => p.id !== deleteConfirm.id))
    } else if (deleteConfirm.type === 'column') {
      const id = deleteConfirm.id
      const updated = customColumns.filter(c => c.id !== id)
      await supabase.from('broker_profiles').update({ custom_columns: updated }).eq('id', broker!.id)
      setCustomColumns(updated)
      update(prev => ({
        ...prev,
        order: prev.order.filter(k => k !== id),
        visible: prev.visible.filter(k => k !== id),
      }))
    }
    setDeleteConfirm(null)
  }

  const duplicateProperty = async (prop: Property) => {
    if (!broker) return
    const { id, created_at, ...rest } = prop
    const { data, error } = await supabase.from('broker_properties').insert({ ...rest, broker_id: broker.id }).select().single()
    if (error || !data) return
    setProperties(prev => [data, ...prev])
    setAddingId(data.id)
    setPage(1)
    setTimeout(() => setAddingId(null), 2000)
  }

  const filtered = useMemo(() => {
    let list = properties
    if (filterDealType) list = list.filter(p => p.deal_type === filterDealType)
    if (filterRoomType) list = list.filter(p => p.room_type === filterRoomType)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(p => {
        // 현재 표시 중인 필드만 검색 (숨겨진 DB 컬럼 제외)
        const fields = [
          p.address, p.deal_type, p.room_type, p.size_pyeong,
          p.price != null ? String(p.price) : null,
          p.total_floors, p.move_in_date, p.rooms_bathrooms,
          p.approval_date, p.parking,
          p.management_fee != null ? String(p.management_fee) : null,
          p.direction, p.brief_memo, p.memo, p.assignee,
        ]
        if (fields.some(f => f?.toLowerCase().includes(q))) return true
        // 커스텀 필드 값 검색
        if (p.custom_fields) {
          return Object.values(p.custom_fields).some((v: any) => v?.toLowerCase?.().includes(q))
        }
        return false
      })
    }
    return list
  }, [properties, filterDealType, filterRoomType, searchQuery])

  // 지도 뷰 전환 시 지도 초기화 & 마커 렌더링
  useEffect(() => {
    if (!isMapView || !mapReady) return
    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return
      const kakao = (window as any).kakao

      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new kakao.maps.Map(mapContainerRef.current, {
          center: new kakao.maps.LatLng(37.5665, 126.9780),
          level: 9,
        })
        kakao.maps.event.addListener(mapInstanceRef.current, 'click', () => {
          infoOverlaysRef.current.forEach((o: any) => o.setMap(null))
        })
      }

      const map = mapInstanceRef.current
      overlaysRef.current.forEach((o: any) => o.setMap(null))
      infoOverlaysRef.current.forEach((o: any) => o.setMap(null))
      overlaysRef.current = []
      infoOverlaysRef.current = []

      const geocoder = new kakao.maps.services.Geocoder()
      const targets = filtered.filter(p => p.address)
      if (targets.length === 0) { setGeocoding(false); return }

      setGeocoding(true)
      let done = 0
      const colorMap: Record<string, string> = { 매매: '#2563eb', 전세: '#7c3aed', 월세: '#ea580c' }

      const fmtPrice = (p: Property) => {
        if (p.price == null) return '미정'
        if (p.price >= 10000) {
          const uk = Math.floor(p.price / 10000)
          const man = p.price % 10000
          return uk + '억' + (man > 0 ? ' ' + man + '만' : '')
        }
        return p.price.toLocaleString() + '만'
      }

      targets.forEach(prop => {
        geocoder.addressSearch(prop.address!, (result: any, status: any) => {
          done++
          if (done === targets.length) setGeocoding(false)
          if (status !== kakao.maps.services.Status.OK) return

          const pos = new kakao.maps.LatLng(result[0].y, result[0].x)
          const color = colorMap[prop.deal_type] ?? '#374151'

          const markerEl = document.createElement('div')
          markerEl.innerHTML = `<div style="background:${color};color:#fff;border-radius:20px;padding:4px 10px;font-size:11px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.25);cursor:pointer;border:2px solid #fff">${prop.deal_type} ${fmtPrice(prop)}</div>`
          const markerOverlay = new kakao.maps.CustomOverlay({ position: pos, content: markerEl, yAnchor: 1.2 })
          markerOverlay.setMap(map)
          overlaysRef.current.push(markerOverlay)

          const infoEl = document.createElement('div')
          infoEl.innerHTML = `<div style="background:#fff;border-radius:12px;padding:12px 14px;box-shadow:0 4px 20px rgba(0,0,0,0.18);min-width:170px;font-family:inherit">
            <div style="font-size:11px;font-weight:600;color:#111;margin-bottom:6px;line-height:1.5">${prop.address}</div>
            <div style="display:flex;gap:5px;align-items:center;margin-bottom:3px">
              <span style="background:${color};color:#fff;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">${prop.deal_type}</span>
              <span style="font-size:12px;font-weight:700;color:${color}">${fmtPrice(prop)}</span>
            </div>
            <div style="font-size:10px;color:#6b7280">${prop.room_type}${prop.size_pyeong ? ' · ' + prop.size_pyeong : ''}${prop.total_floors ? ' · ' + prop.total_floors : ''}</div>
            ${prop.brief_memo ? `<div style="font-size:10px;color:#9ca3af;margin-top:4px;border-top:1px solid #f3f4f6;padding-top:4px">${prop.brief_memo}</div>` : ''}
          </div>`
          const infoOverlay = new kakao.maps.CustomOverlay({ position: pos, content: infoEl, yAnchor: 2.9, zIndex: 5 })
          infoOverlaysRef.current.push(infoOverlay)

          markerEl.addEventListener('click', (e) => {
            e.stopPropagation()
            infoOverlaysRef.current.forEach((o: any) => o.setMap(null))
            infoOverlay.setMap(map)
          })
        })
      })
    }, 100)
    return () => clearTimeout(timer)
  }, [isMapView, mapReady, filtered])


  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
    </div>
  )

  if (accessDenied) return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="text-5xl">🔒</div>
        <h2 className="text-lg font-bold text-gray-700">매물목록 접근 권한이 없어요</h2>
        <p className="text-sm text-gray-400">대표에게 권한 설정을 요청해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />

      {lightbox && (
        <ImageLightbox
          images={lightbox.images} index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNext={() => setLightbox(lb => lb && lb.index < lb.images.length - 1 ? { ...lb, index: lb.index + 1 } : lb)}
          onPrev={() => setLightbox(lb => lb && lb.index > 0 ? { ...lb, index: lb.index - 1 } : lb)}
          onGoTo={i => setLightbox(lb => lb ? { ...lb, index: i } : lb)}
        />
      )}

      <div className="px-4 py-6">
        {/* 어드민 뷰 배너 */}
        {isAdminView && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
            <Eye className="h-4 w-4 text-orange-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-orange-800">{adminViewBrokerName}</span>
              <span className="ml-1.5 text-sm text-orange-600">의 매물장 — 읽기 전용 (관리자 뷰)</span>
            </div>
            <button
              onClick={() => router.push('/admin')}
              className="flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-50 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              어드민으로
            </button>
          </div>
        )}

        {/* 상단 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{isAdminView ? `${adminViewBrokerName}의 매물목록` : '매물목록'}</h1>
            <p className="mt-0.5 text-sm text-gray-500">전체 {properties.length}건 · 검색 {filtered.length}건</p>
          </div>
          <div className="flex items-center gap-2">
            {/* 목록/지도 토글 */}
            <div className="flex rounded-xl border border-gray-200 bg-white overflow-hidden">
              <button
                onClick={() => setIsMapView(false)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors ${!isMapView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                <List className="h-4 w-4" />목록
              </button>
              <button
                onClick={() => setIsMapView(true)}
                className={`flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors ${isMapView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                <Map className="h-4 w-4" />지도
              </button>
            </div>
          </div>
        </div>

        {/* 검색 + 필터 */}
        <div className="mb-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="전체 검색..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilter(v => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors ${(filterDealType || filterRoomType) ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            필터{(filterDealType || filterRoomType) ? ' · ON' : ''}
          </button>
        </div>

        {/* 필터 패널 */}
        {showFilter && (
          <div className="mb-3 rounded-xl border border-gray-200 bg-white p-4 space-y-3 shadow-sm">
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-500">거래형태</p>
              <div className="flex flex-wrap gap-1.5">
                {DEAL_TYPES.map(t => (
                  <button key={t} onClick={() => setFilterDealType(filterDealType === t ? '' : t)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${filterDealType === t ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >{t}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-500">중개대상물종류</p>
              <div className="flex flex-wrap gap-1.5">
                {ROOM_TYPES.map(t => (
                  <button key={t} onClick={() => setFilterRoomType(filterRoomType === t ? '' : t)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${filterRoomType === t ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}
                  >{t}</button>
                ))}
              </div>
            </div>
            {(filterDealType || filterRoomType) && (
              <button onClick={() => { setFilterDealType(''); setFilterRoomType('') }}
                className="text-xs text-red-500 hover:text-red-600 font-medium">
                필터 초기화
              </button>
            )}
          </div>
        )}

        {/* 지도 뷰 */}
        {isMapView && (
          <div className="relative rounded-xl border border-gray-200 overflow-hidden shadow-sm" style={{ height: 560 }}>
            <div ref={mapContainerRef} className="w-full h-full" />
            {/* 로딩 오버레이 */}
            {(!mapReady || geocoding) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm z-10">
                <Loader2 className="h-7 w-7 animate-spin text-blue-600 mb-2" />
                <p className="text-sm text-gray-500">{!mapReady ? '지도 불러오는 중...' : `주소 변환 중... (${filtered.filter(p=>p.address).length}건)`}</p>
              </div>
            )}
            {/* 범례 */}
            {mapReady && !geocoding && (
              <div className="absolute bottom-4 left-4 flex gap-2 z-10">
                {[['매매','#2563eb'],['전세','#7c3aed'],['월세','#ea580c']].map(([label, color]) => (
                  <span key={label} style={{ background: color }} className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white shadow">
                    {label}
                  </span>
                ))}
              </div>
            )}
            {/* 검색 결과 없음 */}
            {mapReady && !geocoding && filtered.filter(p => p.address).length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
                <p className="text-sm text-gray-400">주소가 있는 매물이 없습니다</p>
              </div>
            )}
          </div>
        )}

        {/* 테이블 */}
        <div className={`overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm ${isMapView ? 'hidden' : ''}`}>
          <table className="border-collapse table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
            <thead>
              <tr className="border-b-2 border-gray-100 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wide select-none">
                <th className="px-2 py-2.5 text-center border-r border-gray-100" style={{ width: 32 }}>#</th>
                {syncedOrder.map(key => {
                  // 고정 칼럼
                  const fixedCol = ALL_COLUMNS.find(c => c.key === key)
                  if (fixedCol) {
                    if (!settings.visible.includes(key)) return null
                    const w = settings.widths[key] ?? 100
                    return (
                      <th key={key}
                        className={`px-2 py-2.5 text-left relative cursor-grab transition-colors border-r border-gray-100 hover:bg-gray-100 ${dragOverCol === key ? 'bg-blue-50' : ''}`}
                        style={{ width: w, maxWidth: w }}
                        draggable onDragStart={e => onColDragStart(key, e)}
                        onDragOver={e => onColDragOver(key, e)} onDrop={() => onColDrop(key)}
                        onDragEnd={onColDragEnd}
                      >
                        <div className="pr-2 flex items-center gap-1">
                          {(() => {
                            const TOGGLE_COLS: Record<string, 'text' | 'select'> = { room_type: 'select', deal_type: 'select', direction: 'text', brief_memo: 'text', memo: 'text' }
                            const defaultType = TOGGLE_COLS[key]
                            const effectiveType = settings.colTypes[key] ?? defaultType
                            return (
                              <PropColHeader label={fixedCol.label}
                                colType={defaultType !== undefined ? effectiveType : undefined}
                                onChangeType={defaultType !== undefined ? type => changeFixedColType(key, type) : undefined}
                                hasOptions={effectiveType === 'select'}
                                options={settings.options[key] ?? []}
                                onSetOptions={opts => setOpts(key, opts)}
                                onHide={() => hideCol(key)}
                              />
                            )
                          })()}
                          {(key === 'memo' || key === 'address') && (
                            <TooltipIcon text={key === 'memo' ? '매물제안시 나에게만 보이는 메모입니다' : '고객제안시 읍면동리까지만 표현됩니다'} />
                          )}
                        </div>
                        <div onMouseDown={e => startResize(key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 transition-all" />
                      </th>
                    )
                  }
                  // 커스텀 칼럼
                  const customCol = customColumns.find(c => c.id === key)
                  if (customCol && settings.visible.includes(key)) {
                    const w = settings.widths[key] ?? 120
                    return (
                      <th key={key}
                        className={`px-2 py-2.5 text-left relative cursor-grab transition-colors border-r border-gray-100 hover:bg-gray-100 ${dragOverCol === key ? 'bg-blue-50' : ''}`}
                        style={{ width: w, maxWidth: w }}
                        draggable onDragStart={e => onColDragStart(key, e)}
                        onDragOver={e => onColDragOver(key, e)} onDrop={() => onColDrop(key)}
                        onDragEnd={onColDragEnd}
                      >
                        <div className="pr-2">
                          <PropColHeader label={customCol.name} isCustom
                            colType={customCol.type ?? 'text'}
                            onChangeType={type => changeCustomColumnType(key, type)}
                            hasOptions={customCol.type === 'select'}
                            options={settings.options[key] ?? []}
                            onSetOptions={opts => setOpts(key, opts)}
                            onHide={() => hideCol(key)}
                            onRename={name => renameCustomColumn(key, name)}
                            onDelete={() => deleteCustomColumn(key)}
                          />
                        </div>
                        <div onMouseDown={e => startResize(key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 transition-all" />
                      </th>
                    )
                  }
                  return null
                })}
                {!isAdminView && (
                  <th className="px-2 py-2.5 bg-gray-50 sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.08)]" style={{ width: 64, minWidth: 64 }}>
                    <div className="flex items-center justify-end gap-0.5">
                      <AddColBtn onAdd={addCustomColumn} />
                      <PropColVisibility
                        allFixed={ALL_COLUMNS}
                        customCols={customColumns}
                        visible={settings.visible}
                        onToggle={key => settings.visible.includes(key) ? hideCol(key) : showCol(key)}
                      />
                    </div>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={syncedOrder.length + 2} className="py-20 text-center text-sm text-gray-400">
                    {searchQuery || filterDealType || filterRoomType ? '검색 결과가 없습니다' : '등록된 매물이 없습니다'}
                  </td>
                </tr>
              ) : paginated.map((p, idx) => (
                <tr key={p.id}
                  className={`border-b transition-colors ${p.id === addingId ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 hover:bg-gray-50/60'} ${p.status === 'hidden' ? 'opacity-50' : ''}`}
                >
                  <td className="px-2 py-1.5 border-r border-gray-100 text-center text-xs text-gray-300 select-none">
                    {filtered.length - ((page - 1) * pageSize + idx)}
                  </td>
                  {syncedOrder.map(key => {
                    const fixedCol = ALL_COLUMNS.find(c => c.key === key)
                    if (fixedCol) {
                      if (!settings.visible.includes(key)) return null
                      const w = settings.widths[key] ?? 100
                      // 읽기 전용 셀 (어드민 뷰 또는 편집 권한 없는 직원)
                      if (isAdminView || !canEdit) {
                        const readVal = (() => {
                          if (key === 'price') return p.price != null ? `${p.price.toLocaleString()}만` : '—'
                          if (key === 'management_fee') return p.management_fee != null ? `${p.management_fee.toLocaleString()}만` : '—'
                          if (key === 'deal_type') {
                            const colorMap: Record<string, string> = { 매매: 'bg-blue-100 text-blue-700', 전세: 'bg-purple-100 text-purple-700', 월세: 'bg-orange-100 text-orange-700' }
                            return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${colorMap[p.deal_type] ?? 'bg-gray-100 text-gray-600'}`}>{p.deal_type}</span>
                          }
                          if (key === 'room_type') return <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{p.room_type}</span>
                          if (key === 'images') return p.images?.length > 0
                            ? <div className="flex items-center gap-1"><img src={p.images[0]} alt="" className="h-6 w-6 rounded border border-gray-200 object-cover" />{p.images.length > 1 && <span className="text-[10px] text-gray-400">+{p.images.length - 1}</span>}</div>
                            : <span className="text-xs text-gray-300">—</span>
                          const raw: any = (p as any)[key]
                          return raw != null && raw !== '' ? String(raw) : '—'
                        })()
                        return (
                          <td key={key} className="px-2 py-1.5 border-r border-gray-100" style={{ width: w, maxWidth: w }}>
                            <div className="w-full overflow-hidden whitespace-nowrap text-ellipsis text-xs text-gray-700 px-1 min-h-[22px]">{readVal}</div>
                          </td>
                        )
                      }
                      return (
                        <td key={key} className="px-2 py-1.5 border-r border-gray-100" style={{ width: w, maxWidth: w }}>
                          {key === 'address'         && <AddressCell value={p.address} onSave={v => saveField(p.id, 'address', v)} onAutoFill={() => autoFillRow(p.id, p.address || '')} autoFilling={autoFillingId === p.id} placeholder="소재지 입력" />}
                          {key === 'size_pyeong'     && <AreaCell size={p.size_pyeong} supplied={p.area_supplied} areaUnit={p.area_unit} onSave={(ded, sup, unit) => { saveField(p.id, 'size_pyeong', ded); saveField(p.id, 'area_supplied', sup ? Number(sup) : null); saveField(p.id, 'area_unit', unit) }} />}
                          {key === 'price'           && <NumberCell value={p.price} onSave={v => saveField(p.id, 'price', v ?? 0)} />}
                          {key === 'room_type'       && (settings.colTypes['room_type'] === 'text' ? <TextCell value={p.room_type} onSave={v => saveField(p.id, 'room_type', v)} placeholder="건물 유형" /> : <SelectCell value={p.room_type} options={settings.options['room_type'] ?? ROOM_TYPES} onSave={v => saveField(p.id, 'room_type', v)} />)}
                          {key === 'deal_type'       && (settings.colTypes['deal_type'] === 'text' ? <TextCell value={p.deal_type} onSave={v => saveField(p.id, 'deal_type', v)} placeholder="거래 형태" /> : <SelectCell value={p.deal_type} options={settings.options['deal_type'] ?? DEAL_TYPES} onSave={v => saveField(p.id, 'deal_type', v)} colorMap={{ 매매: 'bg-blue-100 text-blue-700', 전세: 'bg-purple-100 text-purple-700', 월세: 'bg-orange-100 text-orange-700' }} />)}
                          {key === 'total_floors'    && <TextCell value={p.total_floors} onSave={v => saveField(p.id, 'total_floors', v || null)} placeholder="예: 3/15" />}
                          {key === 'move_in_date'    && <DateCell value={p.move_in_date} onSave={v => saveField(p.id, 'move_in_date', v || null)} />}
                          {key === 'rooms_bathrooms' && <TextCell value={p.rooms_bathrooms} onSave={v => saveField(p.id, 'rooms_bathrooms', v || null)} placeholder="예: 2/1" />}
                          {key === 'approval_date'   && <DateCell value={p.approval_date} onSave={v => saveField(p.id, 'approval_date', v || null)} />}
                          {key === 'parking'         && <TextCell value={p.parking} onSave={v => saveField(p.id, 'parking', v || null)} placeholder="예: 1대" />}
                          {key === 'management_fee'  && <NumberCell value={p.management_fee} onSave={v => saveField(p.id, 'management_fee', v)} />}
                          {key === 'direction'       && (settings.colTypes['direction'] === 'select' ? <SelectCell value={p.direction ?? ''} options={settings.options['direction'] ?? DIRECTION_OPTS} onSave={v => saveField(p.id, 'direction', v)} /> : <TextCell value={p.direction} onSave={v => saveField(p.id, 'direction', v || null)} placeholder="예: 남향" />)}
                          {key === 'images'          && <ImageCell images={p.images ?? []} onSave={imgs => saveField(p.id, 'images', imgs)} onView={i => setLightbox({ images: p.images, index: i })} />}
                          {key === 'brief_memo'      && (settings.colTypes['brief_memo'] === 'select' ? <SelectCell value={p.brief_memo ?? ''} options={settings.options['brief_memo'] ?? []} onSave={v => saveField(p.id, 'brief_memo', v)} /> : <LongTextCell value={p.brief_memo} onSave={v => saveField(p.id, 'brief_memo', v || null)} placeholder="매물설명" />)}
                          {key === 'memo'            && (() => {
                            const isMine = isOwner || isAdminView || p.broker_id === broker?.id
                            if (!isMine) return <span className="text-gray-200 text-xs select-none">—</span>
                            return settings.colTypes['memo'] === 'select'
                              ? <SelectCell value={p.memo ?? ''} options={settings.options['memo'] ?? []} onSave={v => saveField(p.id, 'memo', v)} />
                              : <LongTextCell value={p.memo} onSave={v => saveField(p.id, 'memo', v || null)} placeholder="중개사 메모" />
                          })()}
                          {key === 'assignee'        && <TextCell value={p.assignee} onSave={v => saveField(p.id, 'assignee', v || null)} placeholder="담당자" />}
                        </td>
                      )
                    }
                    const customCol = customColumns.find(c => c.id === key)
                    if (customCol && settings.visible.includes(key)) {
                      const w = settings.widths[key] ?? 120
                      return (
                        <td key={key} className="px-2 py-1.5 border-r border-gray-100" style={{ width: w, maxWidth: w }}>
                          {(isAdminView || !canEdit)
                            ? <div className="w-full overflow-hidden whitespace-nowrap text-ellipsis text-xs text-gray-700 px-1 min-h-[22px]">{(p.custom_fields ?? {})[key] || '—'}</div>
                            : customCol.type === 'select'
                              ? <SelectCell value={(p.custom_fields ?? {})[key] ?? ''} options={settings.options[key] ?? []} onSave={v => saveCustomField(p.id, key, v)} />
                              : <TextCell value={(p.custom_fields ?? {})[key] ?? null} onSave={v => saveCustomField(p.id, key, v)} placeholder={customCol.name} />
                          }
                        </td>
                      )
                    }
                    return null
                  })}
                  {!isAdminView && (
                    <td className="px-2 py-1.5 bg-white sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)]">
                      <div className="flex items-center justify-center gap-1.5">
                        {canEdit && <button onClick={() => duplicateProperty(p)} className="text-gray-300 hover:text-blue-400 transition-colors" title="복사">
                          <Copy className="h-3.5 w-3.5" />
                        </button>}
                        {canEdit && <button onClick={() => deleteProperty(p.id)} className="text-gray-300 hover:text-red-400 transition-colors" title="삭제">
                          <X className="h-3.5 w-3.5" />
                        </button>}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {!isAdminView && canEdit && (
                <tr>
                  <td colSpan={syncedOrder.filter(k => settings.visible.includes(k)).length + 2} className="border-t border-gray-100">
                    <button onClick={addNewRow}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50/80 transition-colors">
                      <Plus className="h-3.5 w-3.5" />매물 등록
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        <div className={`mt-5 flex items-center justify-center gap-2 flex-wrap ${isMapView ? 'hidden' : ''}`}>
          {/* 페이지 이동 */}
          {totalPages > 1 && (
            <>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
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
                      className={`h-9 w-9 rounded-xl border text-sm font-semibold transition-colors ${page === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                    >{n}</button>
                )
              }
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              ><ChevronRight className="h-4 w-4" /></button>
            </>
          )}
          {/* 페이지당 개수 선택 */}
          <div className="flex items-center gap-1 ml-3">
            <span className="text-sm text-gray-400">페이지당</span>
            {PAGE_SIZE_OPTIONS.map(n => (
              <button key={n} onClick={() => setPageSize(n)}
                className={`h-8 px-2.5 rounded-lg border text-xs font-semibold transition-colors ${pageSize === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
              >{n}개</button>
            ))}
            <span className="text-sm text-gray-400 ml-1">| 총 {filtered.length}개</span>
          </div>
        </div>
      </div>

      {/* 자동채움 토스트 */}
      {autoFillToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className={cn(
            'rounded-xl px-4 py-2.5 text-sm font-medium shadow-lg flex items-center gap-2',
            autoFillToast.type === 'success'
              ? 'bg-green-600 text-white'
              : 'bg-red-600 text-white'
          )}>
            {autoFillToast.type === 'success' ? <Wand2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {autoFillToast.text}
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-2">
              {deleteConfirm.type === 'property' ? '매물을 삭제할까요?' : `'${deleteConfirm.label}' 칼럼을 삭제할까요?`}
            </h3>
            <p className="text-sm text-gray-500 mb-6">
              {deleteConfirm.type === 'column' ? '해당 칼럼의 모든 데이터가 삭제됩니다.' : '삭제하면 복구할 수 없어요.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50">취소</button>
              <button onClick={confirmDelete}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
