'use client'

import { useEffect, useState, useMemo, useRef, useCallback, Suspense, memo } from 'react'
import { createPortal } from 'react-dom'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { formatPrice, cn } from '@/lib/utils'
import { ColumnHeader } from '@/components/sheet/column-header'
import { useSheetDirection } from '@/lib/use-sheet-direction'
import { useClickOutside } from '@/lib/use-click-outside'
import { CellTooltip } from '@/components/sheet/cells/cell-tooltip'
import { TextCell } from '@/components/sheet/cells/text-cell'
import { SelectCell } from '@/components/sheet/cells/select-cell'
import { DateCell } from '@/components/sheet/cells/date-cell'
import { LongTextCell } from '@/components/sheet/cells/long-text-cell'
import {
  Plus, Trash2, Search, ChevronLeft, ChevronRight, ImagePlus, X, Lock, HelpCircle, Copy, SlidersHorizontal, ArrowLeft, Eye, MoreHorizontal, Map, List, Loader2, EyeOff, ChevronDown, Wand2, ArrowUp, ArrowDown,
} from 'lucide-react'
import { ImageLightbox } from '@/components/image-lightbox'
import { useColSettings, ColSettings } from '@/lib/use-col-settings'
import { useKakaoMapSdk } from '@/lib/use-kakao-map'

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
  received_date: string | null
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
const DEAL_TYPES = ['매매', '전세', '월세', '분양', '분양권']
const ROOM_TYPES = ['원룸', '투룸', '쓰리룸 이상', '아파트', '오피스텔', '빌라/연립', '상가', '사무실', '창고/공장', '토지', '기타']
const DIRECTION_OPTS = ['남향', '북향', '동향', '서향', '남동향', '남서향', '북동향', '북서향']
const PARKING_OPTS = ['주차가능', '주차불가', '협의']
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
// 거래형태 색상 (셀 라벨용 tailwind 클래스 — 매 렌더 재생성 방지하려 모듈 상수)
const DEAL_TYPE_COLOR_MAP: Record<string, string> = {
  매매: 'bg-blue-100 text-blue-700',
  전세: 'bg-purple-100 text-purple-700',
  월세: 'bg-orange-100 text-orange-700',
  분양: 'bg-pink-100 text-pink-700',
  분양권: 'bg-rose-100 text-rose-700',
}
// 지도용 거래형태 hex 색
const DEAL_TYPE_HEX_MAP: Record<string, string> = {
  매매: '#2563eb', 전세: '#7c3aed', 월세: '#ea580c', 분양: '#db2777', 분양권: '#e11d48',
}

// 고정 칼럼만 (지울 수 없음, 숨길 수는 있음)
const ALL_COLUMNS = [
  { key: 'address',         label: '소재지' },
  { key: 'received_date',   label: '접수일자' },
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
    address: 200, received_date: 95, size_pyeong: 70, price: 96, room_type: 110, deal_type: 110,
    total_floors: 70, move_in_date: 90, rooms_bathrooms: 80,
    approval_date: 90, parking: 72, management_fee: 72,
    direction: 68, images: 56, brief_memo: 140, memo: 140, assignee: 80,
  },
  customCols: [],
  options:    { room_type: [...ROOM_TYPES], deal_type: [...DEAL_TYPES], direction: [...DIRECTION_OPTS] },
  colTypes:   {},
  multi:      {},
  areaUnit:   '평',
}

// ── 소재지 셀 (다음 우편번호 검색 지원) ────────────────────────
function AddressCell({ value, onSave, onAutoFill, autoFilling = false, placeholder = '소재지 입력' }: {
  value: string | null
  onSave: (v: string) => void
  onAutoFill?: (bcode?: string) => void
  autoFilling?: boolean
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)
  const skipBlurRef = useRef(false)
  const bcodeRef = useRef('')

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
        bcodeRef.current = data.bcode ?? ''
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
            onClick={() => onAutoFill(bcodeRef.current || undefined)}
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
          className="shrink-0 rounded p-0.5 text-gray-300 opacity-50 sm:opacity-0 transition-opacity hover:text-blue-500 sm:group-hover:opacity-100"
          title="주소 검색"
        >
          <Search className="h-3 w-3" />
        </button>
        {onAutoFill && (
          <button type="button" onClick={() => onAutoFill(bcodeRef.current || undefined)} disabled={autoFilling || !value}
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
function NumberCell({ value, onSave, suffix = '만', placeholder }: {
  value: number | null, onSave: (v: number | null) => void, suffix?: string, placeholder?: string
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
  const displayText = value != null ? `${value.toLocaleString()}${suffix}` : (placeholder ?? '—')
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

// ── 층/총층 셀 (floor / total_floors 합쳐서 "2/5" 형태로) ─────
function FloorCell({ floor, totalFloors, onSave }: {
  floor: number | null
  totalFloors: string | null
  onSave: (floor: number | null, totalFloors: string | null) => void
}) {
  const display = (() => {
    const t = totalFloors ?? ''
    // total_floors에 이미 "f/t" 형식이 들어있으면 그대로 (옛 데이터/타 클라이언트 보호)
    if (t.includes('/')) return t
    const f = floor != null ? String(floor) : ''
    if (f && t) return `${f}/${t}`
    return f || t
  })()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(display)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft === display) return
    const v = draft.trim()
    if (!v) { onSave(null, null); return }
    const m = v.match(/^(-?\d+)\s*\/\s*(.+)$/)
    if (m) onSave(parseInt(m[1], 10), m[2].trim())
    else onSave(null, v)
  }

  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(display); setEditing(false) } }}
        className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="예: 3/15"
      />
    )
  }
  return (
    <div onClick={() => { setDraft(display); setEditing(true) }}
      className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-gray-100 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
      style={{ color: display ? '#374151' : '#d1d5db' }}>
      {display || '예: 3/15'}
    </div>
  )
}

// ── 월세 보증금/임차료 셀 ──────────────────────────────────
function RentPriceCell({ price, rent, onSavePrice, onSaveRent }: {
  price: number | null; rent: number | null
  onSavePrice: (v: number | null) => void; onSaveRent: (v: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftPrice, setDraftPrice] = useState(price != null ? String(price) : '')
  const [draftRent, setDraftRent] = useState(rent != null ? String(rent) : '')
  const rentInputRef = useRef<HTMLInputElement>(null)

  const commitPrice = (moveNext = false) => {
    const num = draftPrice.trim() === '' ? null : Number(draftPrice)
    if (num !== price) onSavePrice(isNaN(num as number) ? null : num)
    if (moveNext) { rentInputRef.current?.focus(); rentInputRef.current?.select() }
  }
  const commitRent = () => {
    const num = draftRent.trim() === '' ? null : Number(draftRent)
    if (num !== rent) onSaveRent(isNaN(num as number) ? null : num)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-0.5">
        <input autoFocus type="number" value={draftPrice} onChange={e => setDraftPrice(e.target.value)}
          onBlur={() => commitPrice(false)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitPrice(true) }
            if (e.key === 'Escape') { setDraftPrice(price != null ? String(price) : ''); setEditing(false) }
          }}
          className="w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-blue-300"
          placeholder="보증금"
        />
        <span className="text-gray-400 text-xs flex-shrink-0">/</span>
        <input ref={rentInputRef} type="number" value={draftRent} onChange={e => setDraftRent(e.target.value)}
          onBlur={commitRent}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRent()
            if (e.key === 'Escape') { setDraftRent(rent != null ? String(rent) : ''); setEditing(false) }
          }}
          className="w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-blue-300"
          placeholder="임차료"
        />
      </div>
    )
  }
  const dep = price != null ? `${price.toLocaleString()}만` : '—'
  const mo = rent != null ? `${rent.toLocaleString()}만` : '—'
  return (
    <div className="w-full cursor-pointer rounded px-1 py-0.5 hover:bg-blue-50 min-h-[22px] text-xs overflow-hidden whitespace-nowrap text-ellipsis"
      onClick={() => { setDraftPrice(price != null ? String(price) : ''); setDraftRent(rent != null ? String(rent) : ''); setEditing(true) }}>
      <span className={`font-semibold ${price ? 'text-gray-800' : 'text-gray-300'}`}>{dep}</span>
      <span className="text-gray-400 mx-0.5">/</span>
      <span className={`font-semibold ${rent ? 'text-gray-800' : 'text-gray-300'}`}>{mo}</span>
    </div>
  )
}

// ── 팝오버 선택 셀 ──────────────────────────────────────────
// 평 ↔ m² 환산 상수 (1평 = 3.305785 m²)
const PYEONG_TO_M2 = 3.305785

function AreaCell({ size, supplied, globalUnit, onSave }: {
  size: string | null          // 전용 면적 (DB 저장값, 항상 평 단위)
  supplied: number | null      // 공급 면적 (DB 저장값, 항상 평 단위)
  globalUnit: '평' | 'm²'      // 칼럼 단위 (전체 통일)
  onSave: (dedicatedPyeong: string | null, suppliedPyeong: string | null) => void
}) {
  const toDisplay = (pyeong: string | number | null | undefined): string => {
    if (pyeong == null || pyeong === '') return ''
    const n = Number(pyeong)
    if (Number.isNaN(n)) return ''
    return globalUnit === 'm²' ? (n * PYEONG_TO_M2).toFixed(2) : String(pyeong)
  }
  const toStorage = (input: string): string | null => {
    if (!input.trim()) return null
    const n = Number(input)
    if (Number.isNaN(n)) return null
    return globalUnit === 'm²' ? (n / PYEONG_TO_M2).toFixed(2) : input
  }

  const [open, setOpen] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const [draftDedicated, setDraftDedicated] = useState(toDisplay(size))
  const [draftSupplied, setDraftSupplied] = useState(toDisplay(supplied))
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    onSave(toStorage(draftDedicated), toStorage(draftSupplied))
    setOpen(false)
  }

  useClickOutside(ref, () => { if (open) commit() })
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const handleOpen = () => {
    setDraftDedicated(toDisplay(size))
    setDraftSupplied(toDisplay(supplied))
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
  const displaySize = toDisplay(size)
  const displaySupplied = toDisplay(supplied)
  const hasDed = !!displaySize
  const hasSup = !!displaySupplied
  const displayText = hasDed && hasSup
    ? `${displaySize}/${displaySupplied}${globalUnit}`
    : hasDed ? `${displaySize}${globalUnit}`
    : hasSup ? `${displaySupplied}${globalUnit}`
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
            <span className="w-6 flex-shrink-0 text-right text-xs text-gray-400">{globalUnit}</span>
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
            <span className="w-6 flex-shrink-0 text-right text-xs text-gray-400">{globalUnit}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 긴 텍스트 셀 (메모/설명용 — textarea 편집 + 공통 툴팁) ──────────
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
      const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      for (const file of newFiles) {
        if (!ALLOWED_TYPES.includes(file.type) || file.size > 10 * 1024 * 1024) continue
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
          ? <span className="text-xs text-gray-300">사진</span>
          : <>
              <div className="h-6 w-6 overflow-hidden rounded border border-gray-200 flex-shrink-0">
                <img src={localImgs[0]} alt="매물 사진" loading="lazy" decoding="async" className="h-full w-full object-cover" />
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
                <img src={src} alt="매물 사진" loading="lazy" decoding="async" className="h-full w-full object-cover cursor-pointer" onClick={() => { setOpen(false); onView(i) }} />
                <button onClick={() => { const next = localImgs.filter((_, idx) => idx !== i); setLocalImgs(next) }}
                  className="absolute top-0.5 right-0.5 hidden group-hover:flex h-4 w-4 items-center justify-center rounded-full bg-black/50 text-white text-[9px]"
                >✕</button>
              </div>
            ))}
            {newPreviews.map((src, i) => (
              <div key={`n-${i}`} className="relative h-14 w-14 overflow-hidden rounded-lg border border-blue-200">
                <img src={src} alt="매물 사진" className="h-full w-full object-cover" />
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

// ── 매물 행 (React.memo로 셀 편집 시 다른 행 re-render 차단) ──────────
interface PropertyRowProps {
  p: Property
  rowNumber: number
  syncedOrder: readonly string[]
  customColumns: CustomColumn[]
  settings: ColSettings
  isAdminView: boolean
  canEdit: boolean
  isOwner: boolean
  brokerSelfId: string | null
  isAdding: boolean
  isAutoFilling: boolean
  teamMembers: string[]
  saveField: (id: string, field: string, value: any) => void
  autoFillRow: (id: string, addr: string, bcode?: string) => void
  saveCustomField: (propertyId: string, colId: string, value: string) => void
  setLightbox: React.Dispatch<React.SetStateAction<{ images: string[]; index: number } | null>>
  onDelete: (id: string) => void
  onCopy: (p: Property) => void
}

const PropertyRow = memo(function PropertyRow({
  p, rowNumber, syncedOrder, customColumns, settings,
  isAdminView, canEdit, isOwner, brokerSelfId,
  isAdding, isAutoFilling, teamMembers,
  saveField, autoFillRow, saveCustomField, setLightbox,
  onDelete, onCopy,
}: PropertyRowProps) {
  return (
    <tr data-row-id={p.id}
      className={`border-b transition-colors ${isAdding ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 hover:bg-gray-50/60'} ${p.status === 'hidden' ? 'opacity-50' : ''}`}
    >
      <td className="px-2 py-1.5 border-r border-gray-100 text-center text-xs text-gray-300 select-none">
        {rowNumber}
      </td>
      {syncedOrder.map(key => {
        const fixedCol = ALL_COLUMNS.find(c => c.key === key)
        if (fixedCol) {
          if (!settings.visible.includes(key)) return null
          const w = settings.widths[key] ?? 100
          // 읽기 전용 셀 (어드민 뷰 또는 편집 권한 없는 직원)
          if (isAdminView || !canEdit) {
            const readVal = (() => {
              if (key === 'price') {
                if (p.deal_type === '월세') {
                  const dep = p.price != null ? `${p.price.toLocaleString()}만` : '—'
                  const mo = p.monthly_rent != null ? `${p.monthly_rent.toLocaleString()}만` : '—'
                  return `${dep}/${mo}`
                }
                return p.price != null ? `${p.price.toLocaleString()}만` : '—'
              }
              if (key === 'management_fee') return p.management_fee != null ? `${p.management_fee.toLocaleString()}만` : '—'
              if (key === 'deal_type') {
                return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${DEAL_TYPE_COLOR_MAP[p.deal_type] ?? 'bg-gray-100 text-gray-600'}`}>{p.deal_type}</span>
              }
              if (key === 'room_type') return <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{p.room_type}</span>
              if (key === 'images') return p.images?.length > 0
                ? <div className="flex items-center gap-1"><img src={p.images[0]} alt="매물 사진" loading="lazy" decoding="async" className="h-6 w-6 rounded border border-gray-200 object-cover" />{p.images.length > 1 && <span className="text-[10px] text-gray-400">+{p.images.length - 1}</span>}</div>
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
              {key === 'address'         && <AddressCell value={p.address} onSave={v => saveField(p.id, 'address', v)} onAutoFill={(bcode) => autoFillRow(p.id, p.address || '', bcode)} autoFilling={isAutoFilling} placeholder="소재지 입력" />}
              {key === 'size_pyeong'     && <AreaCell size={p.size_pyeong} supplied={p.area_supplied} globalUnit={settings.areaUnit ?? '평'} onSave={(ded, sup) => { saveField(p.id, 'size_pyeong', ded); saveField(p.id, 'area_supplied', sup ? Number(sup) : null) }} />}
              {key === 'price'           && (p.deal_type === '월세'
                ? <RentPriceCell price={p.price} rent={p.monthly_rent} onSavePrice={v => saveField(p.id, 'price', v ?? 0)} onSaveRent={v => saveField(p.id, 'monthly_rent', v)} />
                : <NumberCell value={p.price} onSave={v => saveField(p.id, 'price', v ?? 0)} />)}
              {key === 'room_type'       && (settings.colTypes['room_type'] === 'text' ? <TextCell value={p.room_type} onSave={v => saveField(p.id, 'room_type', v)} placeholder="건물 유형" /> : <SelectCell value={p.room_type} options={settings.options['room_type'] ?? ROOM_TYPES} onSave={v => saveField(p.id, 'room_type', v)} placeholder="중개대상물" multi={settings.multi['room_type']} />)}
              {key === 'deal_type'       && (settings.colTypes['deal_type'] === 'text' ? <TextCell value={p.deal_type} onSave={v => saveField(p.id, 'deal_type', v)} placeholder="거래 형태" /> : <SelectCell value={p.deal_type} options={settings.options['deal_type'] ?? DEAL_TYPES} onSave={v => saveField(p.id, 'deal_type', v)} colorMap={DEAL_TYPE_COLOR_MAP} placeholder="거래형태" multi={settings.multi['deal_type']} />)}
              {key === 'received_date'   && <DateCell value={p.received_date} onSave={v => saveField(p.id, 'received_date', v || null)} />}
              {key === 'total_floors'    && <FloorCell floor={p.floor} totalFloors={p.total_floors} onSave={(f, t) => { saveField(p.id, 'floor', f); saveField(p.id, 'total_floors', t) }} />}
              {key === 'move_in_date'    && <DateCell value={p.move_in_date} onSave={v => saveField(p.id, 'move_in_date', v || null)} />}
              {key === 'rooms_bathrooms' && <TextCell value={p.rooms_bathrooms} onSave={v => saveField(p.id, 'rooms_bathrooms', v || null)} placeholder="예: 2/1" />}
              {key === 'approval_date'   && <DateCell value={p.approval_date} onSave={v => saveField(p.id, 'approval_date', v || null)} />}
              {key === 'parking'         && <TextCell value={p.parking} onSave={v => saveField(p.id, 'parking', v || null)} placeholder="예: 1대" />}
              {key === 'management_fee'  && <NumberCell value={p.management_fee} onSave={v => saveField(p.id, 'management_fee', v)} placeholder="관리비" />}
              {key === 'direction'       && (settings.colTypes['direction'] === 'select' ? <SelectCell value={p.direction ?? ''} options={settings.options['direction'] ?? DIRECTION_OPTS} onSave={v => saveField(p.id, 'direction', v)} multi={settings.multi['direction']} /> : <TextCell value={p.direction} onSave={v => saveField(p.id, 'direction', v || null)} placeholder="예: 남향" />)}
              {key === 'images'          && <ImageCell images={p.images ?? []} onSave={imgs => saveField(p.id, 'images', imgs)} onView={i => setLightbox({ images: p.images, index: i })} />}
              {key === 'brief_memo'      && (settings.colTypes['brief_memo'] === 'select' ? <SelectCell value={p.brief_memo ?? ''} options={settings.options['brief_memo'] ?? []} onSave={v => saveField(p.id, 'brief_memo', v)} multi={settings.multi['brief_memo']} /> : <LongTextCell value={p.brief_memo} onSave={v => saveField(p.id, 'brief_memo', v || null)} placeholder="매물설명" />)}
              {key === 'memo'            && (() => {
                const isMine = isOwner || isAdminView || p.broker_id === brokerSelfId
                if (!isMine) return <span className="text-gray-200 text-xs select-none">—</span>
                return settings.colTypes['memo'] === 'select'
                  ? <SelectCell value={p.memo ?? ''} options={settings.options['memo'] ?? []} onSave={v => saveField(p.id, 'memo', v)} multi={settings.multi['memo']} />
                  : <LongTextCell value={p.memo} onSave={v => saveField(p.id, 'memo', v || null)} placeholder="중개사 메모" />
              })()}
              {key === 'assignee'        && <SelectCell value={p.assignee ?? ''} options={teamMembers} onSave={v => saveField(p.id, 'assignee', v || null)} placeholder="담당자" multi={settings.multi['assignee']} />}
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
                  ? <SelectCell value={(p.custom_fields ?? {})[key] ?? ''} options={settings.options[key] ?? []} onSave={v => saveCustomField(p.id, key, v)} multi={settings.multi[key]} />
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
            {canEdit && <button onClick={() => onCopy(p)} className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-blue-50 hover:text-blue-400 transition-colors" title="복사">
              <Copy className="h-3.5 w-3.5" />
            </button>}
            {canEdit && <button onClick={() => onDelete(p.id)} className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors" title="삭제">
              <Trash2 className="h-3.5 w-3.5" />
            </button>}
          </div>
        </td>
      )}
    </tr>
  )
})

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
  const auth = useAuth()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [canEdit, setCanEdit] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [isAdminView, setIsAdminView] = useState(false)
  const [isOwner, setIsOwner] = useState(true)
  const [teamMembers, setTeamMembers] = useState<string[]>([])
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
  const { status: mapStatus, errorReason: mapErr, ready: mapReady } = useKakaoMapSdk()
  const [geocoding, setGeocoding] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersRef = useRef<any[]>([])         // 카카오 Marker 인스턴스들
  const clustererRef = useRef<any>(null)        // MarkerClusterer
  const infoOverlaysRef = useRef<any[]>([])     // 클릭 시 뜨는 정보 카드
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
  const { direction, updateDirection } = useSheetDirection(broker?.id ?? null, 'properties')

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

  useEffect(() => {
    // 어드민 뷰는 targetBrokerId 기반으로 별도 처리 — auth와 무관하게 mount 시 init
    if (searchParams.get('broker_id')) { init(); return }
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (!auth.broker) { router.push('/broker/register'); return }
    init()
  }, [auth.loading, auth.user?.id, auth.broker?.id])
  useEffect(() => { setPage(1) }, [filterDealType, filterRoomType, searchQuery, pageSize])

  // 카카오맵 SDK는 useKakaoMapSdk 훅에서 로드

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
    const targetBrokerId = searchParams.get('broker_id')

    // 어드민이 다른 중개사 매물장을 보는 경우 — auth 우회 (직접 fetch)
    if (targetBrokerId) {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) { router.push('/auth/login'); return }
      setUser(u)
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', u.id).single()
      if (profile?.role !== 'admin') { router.push('/broker/properties'); return }

      const { data: b } = await supabase.from('broker_profiles').select('id, custom_columns, office_name, profiles(name)').eq('id', targetBrokerId).single()
      if (!b) { router.push('/admin'); return }
      setBroker(b)
      setIsAdminView(true)
      setAdminViewBrokerName((b.profiles as any)?.name || b.office_name || '(이름 없음)')
      const cols: CustomColumn[] = b.custom_columns?.length > 0 ? b.custom_columns : DEFAULT_CUSTOM_COLS
      setCustomColumns(cols)
      const { data: ownBroker } = await supabase.from('broker_profiles').select('id').eq('user_id', u.id).single()
      if (ownBroker) setSettingsBrokerId(ownBroker.id)
      const { data } = await supabase.from('broker_properties').select('*').eq('broker_id', b.id).order('created_at', { ascending: false })
      setProperties(data ?? [])
      setLoading(false)
      return
    }

    // 일반 중개사 본인 매물장 — auth context에서
    const u = auth.user!
    const b = auth.broker!
    setUser(u)
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

    // ── 팀원 이름 목록 (담당자 드롭다운용) ──────────────
    const { data: prof } = await supabase.from('profiles').select('name').eq('id', u.id).single()
    const myName = prof?.name as string | undefined
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

    // ── 커스텀 칼럼 로드 ───────────────────────────────
    const cc = b.custom_columns as CustomColumn[] | undefined
    const cols: CustomColumn[] = cc && cc.length > 0 ? cc : DEFAULT_CUSTOM_COLS
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

  // 단일 필드 저장 (optimistic UI + 실패 시 롤백)
  const saveField = useCallback(async (id: string, field: string, value: any) => {
    let prevValue: any = undefined
    setProperties(prev => {
      const row = prev.find(p => p.id === id) as any
      if (row) prevValue = row[field]
      return prev.map(p => p.id === id ? { ...p, [field]: value } : p)
    })
    const { error } = await supabase.from('broker_properties').update({ [field]: value }).eq('id', id)
    if (error) {
      console.error('[saveField] failed', error)
      setProperties(prev => prev.map(p => p.id === id ? { ...p, [field]: prevValue } : p))
      alert(`저장 실패: ${error.message}`)
    }
  }, [])

  // 행 자동 채움: 주소 → 카카오 지오코딩 → 세움터 API → 같은 행 다중 필드 일괄 업데이트
  const autoFillRow = useCallback(async (id: string, addr: string, bcode?: string) => {
    if (!addr?.trim()) {
      setAutoFillToast({ type: 'error', text: '소재지를 먼저 입력해주세요' })
      setTimeout(() => setAutoFillToast(null), 2500)
      return
    }
    setAutoFillingId(id)
    try {
      const hoMatch = addr.match(/(\d+)\s*호/)
      let ho = hoMatch ? hoMatch[1] : ''
      let searchAddr = addr.replace(/\s*[Bb]?\d+층\s*/g, ' ').trim()
      if (hoMatch) searchAddr = searchAddr.slice(0, hoMatch.index).trim()
      searchAddr = searchAddr.replace(/\s+/g, ' ')
      // "101-2403" 형식(동-호 하이픈, 호 접미사 없음) 처리
      if (!ho) {
        const dongHoMatch = searchAddr.match(/\s(\d{1,3})-(\d{3,4})\s*$/)
        if (dongHoMatch) {
          ho = dongHoMatch[2]
          searchAddr = (searchAddr.slice(0, dongHoMatch.index) + ` ${dongHoMatch[1]}동`).replace(/\s+/g, ' ').trim()
        }
      }

      const body = bcode && bcode.length === 10
        ? { bcode, address: searchAddr, ho }
        : { address: searchAddr, ho }

      const res = await fetch('/api/properties/auto-fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '세움터 조회 실패')

      const updates: Record<string, any> = {}
      if (data.size_pyeong != null) {
        updates.size_pyeong = String(data.size_pyeong)
      }
      if (data.size_pyeong_supplied != null) {
        updates.area_supplied = Number(data.size_pyeong_supplied)
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
        size_pyeong: '면적', total_floors: '층',
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

  // 커스텀 필드 값 저장 (optimistic + 실패 시 롤백)
  const saveCustomField = useCallback(async (propertyId: string, colId: string, value: string) => {
    let prevFields: Record<string, string> | null = null
    let updated: Record<string, string> = {}
    setProperties(prev => {
      const prop = prev.find(p => p.id === propertyId)
      prevFields = (prop?.custom_fields ?? null) as any
      updated = { ...(prop?.custom_fields ?? {}), [colId]: value }
      return prev.map(p => p.id === propertyId ? { ...p, custom_fields: updated } : p)
    })
    const { error } = await supabase.from('broker_properties').update({ custom_fields: updated }).eq('id', propertyId)
    if (error) {
      console.error('[saveCustomField] failed', error)
      setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, custom_fields: prevFields ?? {} } : p))
      alert(`저장 실패: ${error.message}`)
    }
  }, [])

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

  // 다중 선택 토글
  const setMulti = (key: string, multi: boolean) => {
    update(prev => ({ ...prev, multi: { ...prev.multi, [key]: multi } }))
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
      deal_type: '',
      room_type: '',
      address: '',
      price: 0,
      status: 'available',
      options: [],
      images: [],
    }).select().single()
    if (error || !data) return
    // properties 배열은 created_at desc 순서. 화면 reverse가 direction을 처리하므로 항상 앞에 추가.
    setProperties(prev => [data, ...prev])
    setAddingId(data.id)
    setPage(1)
    setTimeout(() => setAddingId(null), 2000)
  }

  const deleteProperty = useCallback((id: string) => {
    setDeleteConfirm({ type: 'property', id })
  }, [])

  const confirmDelete = async () => {
    if (!deleteConfirm) return
    if (deleteConfirm.type === 'property') {
      const { error } = await supabase.from('broker_properties').delete().eq('id', deleteConfirm.id)
      if (error) {
        console.error('[deleteProperty] failed', error)
        alert(`삭제 실패: ${error.message}`)
        setDeleteConfirm(null)
        return
      }
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

  const duplicateProperty = useCallback(async (prop: Property) => {
    if (!broker) return
    const { id, created_at, ...rest } = prop
    const { data, error } = await supabase.from('broker_properties').insert({ ...rest, broker_id: broker.id }).select().single()
    if (error || !data) return
    setProperties(prev => [data, ...prev])
    setAddingId(data.id)
    setPage(1)
    setTimeout(() => setAddingId(null), 2000)
  }, [broker])

  const filtered = useMemo(() => {
    let list = properties
    if (filterDealType) list = list.filter(p => (p.deal_type ?? '').split(',').map(s => s.trim()).includes(filterDealType))
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

  // 지도 뷰 렌더링 — Marker(SVG 핀) + MarkerClusterer + 클릭 시 정보 오버레이
  useEffect(() => {
    if (!isMapView || !mapReady) return
    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return
      const kakao = (window as any).kakao

      // 지도 인스턴스 최초 생성
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new kakao.maps.Map(mapContainerRef.current, {
          center: new kakao.maps.LatLng(36.815, 127.114), // 천안 시청
          level: 6,
        })
        kakao.maps.event.addListener(mapInstanceRef.current, 'click', () => {
          infoOverlaysRef.current.forEach((o: any) => o.setMap(null))
        })
      }

      const map = mapInstanceRef.current

      // 기존 마커·정보창 정리
      if (clustererRef.current) { clustererRef.current.clear() }
      else {
        clustererRef.current = new kakao.maps.MarkerClusterer({
          map,
          averageCenter: true,
          minLevel: 8, // 줌 8 이하(축소)에서 클러스터링
          disableClickZoom: false,
          gridSize: 80,
          styles: [{
            width: '40px', height: '40px',
            background: '#2563eb', color: '#fff',
            borderRadius: '20px', textAlign: 'center', lineHeight: '40px',
            fontSize: '13px', fontWeight: '700',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            border: '2px solid #fff',
          }],
        })
      }
      markersRef.current = []
      infoOverlaysRef.current.forEach((o: any) => o.setMap(null))
      infoOverlaysRef.current = []

      const geocoder = new kakao.maps.services.Geocoder()
      const targets = filtered.filter(p => p.address)
      if (targets.length === 0) { setGeocoding(false); return }

      setGeocoding(true)
      let done = 0
      // 거래형태가 "매매, 월세" 같은 멀티면 첫 번째 값 기준 색
      const pickPrimaryDeal = (d: string) => (d ?? '').split(',').map(s => s.trim()).filter(Boolean)[0] ?? ''

      const fmtPrice = (p: Property) => {
        if (p.price == null) return '미정'
        if (p.price >= 10000) {
          const uk = Math.floor(p.price / 10000)
          const man = p.price % 10000
          return uk + '억' + (man > 0 ? ' ' + man + '만' : '')
        }
        return p.price.toLocaleString() + '만'
      }
      const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

      // SVG 핀(알약 모양) data URI 생성
      const makePillIcon = (dealType: string, price: string, color: string) => {
        const label = `${dealType} ${price}`
        const charCount = [...label].length
        const width = Math.max(64, Math.min(140, charCount * 9 + 16))
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="32" viewBox="0 0 ${width} 32"><rect x="1" y="1" width="${width-2}" height="22" rx="11" ry="11" fill="${color}" stroke="white" stroke-width="2"/><text x="${width/2}" y="16" font-size="11" font-weight="700" text-anchor="middle" fill="white" font-family="-apple-system, BlinkMacSystemFont, sans-serif">${label}</text><path d="M${width/2-5} 22 L${width/2} 30 L${width/2+5} 22 Z" fill="${color}"/></svg>`
        return { url: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg), width, height: 32 }
      }

      const newMarkers: any[] = []
      const bounds = new kakao.maps.LatLngBounds()

      targets.forEach(prop => {
        geocoder.addressSearch(prop.address!, (result: any, status: any) => {
          done++
          if (status === kakao.maps.services.Status.OK) {
            const pos = new kakao.maps.LatLng(result[0].y, result[0].x)
            const primaryDeal = pickPrimaryDeal(prop.deal_type)
            const color = DEAL_TYPE_HEX_MAP[primaryDeal] ?? '#374151'
            const icon = makePillIcon(primaryDeal, fmtPrice(prop), color)
            const markerImage = new kakao.maps.MarkerImage(
              icon.url,
              new kakao.maps.Size(icon.width, icon.height),
              { offset: new kakao.maps.Point(icon.width / 2, icon.height) }
            )
            const marker = new kakao.maps.Marker({ position: pos, image: markerImage })
            newMarkers.push(marker)
            bounds.extend(pos)

            // 정보 카드
            const infoEl = document.createElement('div')
            infoEl.innerHTML = `<div style="background:#fff;border-radius:12px;padding:12px 14px;box-shadow:0 4px 20px rgba(0,0,0,0.18);min-width:180px;font-family:inherit"><div style="font-size:11px;font-weight:600;color:#111;margin-bottom:6px;line-height:1.5">${esc(prop.address)}</div><div style="display:flex;gap:5px;align-items:center;margin-bottom:3px"><span style="background:${color};color:#fff;border-radius:4px;padding:1px 7px;font-size:10px;font-weight:700">${esc(prop.deal_type)}</span><span style="font-size:12px;font-weight:700;color:${color}">${esc(fmtPrice(prop))}</span></div><div style="font-size:10px;color:#6b7280">${esc(prop.room_type)}${prop.size_pyeong ? ' · ' + esc(prop.size_pyeong) + '평' : ''}${prop.total_floors ? ' · ' + esc(prop.total_floors) : ''}</div>${prop.brief_memo ? `<div style="font-size:10px;color:#9ca3af;margin-top:4px;border-top:1px solid #f3f4f6;padding-top:4px">${esc(prop.brief_memo)}</div>` : ''}</div>`
            const infoOverlay = new kakao.maps.CustomOverlay({ position: pos, content: infoEl, yAnchor: 1.4, zIndex: 5 })
            infoOverlaysRef.current.push(infoOverlay)

            kakao.maps.event.addListener(marker, 'click', () => {
              infoOverlaysRef.current.forEach((o: any) => o.setMap(null))
              infoOverlay.setMap(map)
            })
          }

          if (done === targets.length) {
            setGeocoding(false)
            clustererRef.current.addMarkers(newMarkers)
            markersRef.current = newMarkers
            // 모든 마커가 보이도록 bounds fit (1개면 그 위치 중심으로)
            if (newMarkers.length > 0) {
              if (newMarkers.length === 1) {
                map.setCenter(newMarkers[0].getPosition())
                map.setLevel(4)
              } else {
                map.setBounds(bounds)
              }
            }
          }
        })
      })
    }, 100)
    return () => clearTimeout(timer)
  }, [isMapView, mapReady, filtered])


  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const sortedFiltered = direction === 'up' ? filtered : [...filtered].reverse()
  const paginated = sortedFiltered.slice((page - 1) * pageSize, page * pageSize)

  // 새 행 추가 시: 페이지 이동 + 스크롤 + 첫 셀 클릭 (편집모드)
  useEffect(() => {
    if (!addingId) return
    const targetPage = direction === 'up' ? 1 : Math.max(1, Math.ceil(properties.length / pageSize))
    setPage(targetPage)
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
  }, [addingId, direction, properties.length, pageSize])

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
            {/* 로딩/에러 오버레이 */}
            {mapStatus === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-white z-10 px-6 text-center">
                <div className="text-4xl mb-3">🗺️</div>
                <p className="text-sm font-bold text-gray-700 mb-1">지도를 불러올 수 없어요</p>
                <p className="text-xs text-gray-500 max-w-md leading-relaxed">
                  {mapErr === 'no-key'
                    ? 'NEXT_PUBLIC_KAKAO_MAP_KEY 환경변수가 비어있어요. Vercel 환경변수 설정을 확인해주세요.'
                    : '카카오 디벨로퍼스 콘솔에서 현재 도메인(이 페이지의 URL)이 [JavaScript 키 → 플랫폼 → Web]에 등록돼 있는지 확인해주세요.'}
                </p>
              </div>
            )}
            {mapStatus !== 'error' && (!mapReady || geocoding) && (
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
                        <div className="pr-2 flex items-center gap-1 overflow-hidden">
                          {(() => {
                            const TOGGLE_COLS: Record<string, 'text' | 'select'> = { room_type: 'select', deal_type: 'select', direction: 'text', brief_memo: 'text', memo: 'text' }
                            const defaultType = TOGGLE_COLS[key]
                            const effectiveType = settings.colTypes[key] ?? defaultType
                            // 담당자(assignee)는 select-like 동작(다중 토글)만 제공, 옵션 편집/text-select 토글은 숨김
                            const isAssignee = key === 'assignee'
                            const showMulti = effectiveType === 'select' || isAssignee
                            const isAreaCol = key === 'size_pyeong'
                            return (
                              <ColumnHeader label={fixedCol.label} isFixed
                                colType={defaultType !== undefined && !isAssignee ? effectiveType : undefined}
                                onChangeType={defaultType !== undefined && !isAssignee ? type => changeFixedColType(key, type) : undefined}
                                hasOptions={showMulti}
                                options={settings.options[key] ?? []}
                                onSetOptions={isAssignee ? undefined : opts => setOpts(key, opts)}
                                isMulti={settings.multi[key]}
                                onChangeMulti={showMulti ? m => setMulti(key, m) : undefined}
                                onHide={() => hideCol(key)}
                                areaUnit={isAreaCol ? (settings.areaUnit ?? '평') : undefined}
                                onChangeAreaUnit={isAreaCol ? u => update(prev => ({ ...prev, areaUnit: u })) : undefined}
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
                        <div className="pr-2 overflow-hidden">
                          <ColumnHeader label={customCol.name} isCustom
                            colType={customCol.type ?? 'text'}
                            onChangeType={type => changeCustomColumnType(key, type)}
                            hasOptions={customCol.type === 'select'}
                            options={settings.options[key] ?? []}
                            onSetOptions={opts => setOpts(key, opts)}
                            isMulti={settings.multi[key]}
                            onChangeMulti={customCol.type === 'select' ? m => setMulti(key, m) : undefined}
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
                <PropertyRow
                  key={p.id}
                  p={p}
                  rowNumber={direction === 'up' ? filtered.length - ((page - 1) * pageSize + idx) : ((page - 1) * pageSize + idx + 1)}
                  syncedOrder={syncedOrder}
                  customColumns={customColumns}
                  settings={settings}
                  isAdminView={isAdminView}
                  canEdit={canEdit}
                  isOwner={isOwner}
                  brokerSelfId={broker?.id ?? null}
                  isAdding={p.id === addingId}
                  isAutoFilling={autoFillingId === p.id}
                  teamMembers={teamMembers}
                  saveField={saveField}
                  autoFillRow={autoFillRow}
                  saveCustomField={saveCustomField}
                  setLightbox={setLightbox}
                  onDelete={deleteProperty}
                  onCopy={duplicateProperty}
                />
              ))}
              {!isAdminView && canEdit && (
                <tr>
                  <td colSpan={syncedOrder.filter(k => settings.visible.includes(k)).length + 2} className="border-t border-gray-100">
                    <div className="flex items-center divide-x divide-gray-100">
                      <button onClick={addNewRow}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50/80 transition-colors">
                        <Plus className="h-3.5 w-3.5" />매물 등록
                      </button>
                      <button onClick={() => updateDirection(direction === 'up' ? 'down' : 'up')}
                        title={direction === 'up' ? '새 행이 위로 쌓임 (클릭하면 아래로)' : '새 행이 아래로 쌓임 (클릭하면 위로)'}
                        className="flex items-center gap-1 px-3 py-2 text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors">
                        {direction === 'up' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
                        {direction === 'up' ? '위로 쌓기' : '아래로 쌓기'}
                      </button>
                    </div>
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
