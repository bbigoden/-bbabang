'use client'

import { useEscape } from '@/lib/use-escape'
import { useEffect, useState, useMemo, useRef, useCallback, Suspense, memo } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { AddColBtn } from '@/components/sheet/add-col-button'
import { ColVisibility } from '@/components/sheet/col-visibility'
import { getOfficeMembers } from '@/lib/office-members'
import { useClickOutside } from '@/lib/use-click-outside'
import { canManageOffice } from '@/lib/office-role'
import { Header } from '@/components/layout/header'
import { splitAddressForAutoFill } from '@/lib/auto-fill-address'
import { shrinkImage, PROPERTY_PHOTO_SIDE, PROPERTY_PHOTO_QUALITY } from '@/lib/shrink-image'
import { cn } from '@/lib/utils'
import { ColumnHeader } from '@/components/sheet/column-header'
import { SheetActionCell, SheetActionHeader } from '@/components/sheet/action-cell'
import { useSheetDirection } from '@/lib/use-sheet-direction'
import { CellTooltip } from '@/components/sheet/cells/cell-tooltip'
import { TextCell } from '@/components/sheet/cells/text-cell'
import { SelectCell } from '@/components/sheet/cells/select-cell'
import { DateCell } from '@/components/sheet/cells/date-cell'
import { LongTextCell } from '@/components/sheet/cells/long-text-cell'
import {
  Plus, Search, ImagePlus, X, HelpCircle, SlidersHorizontal, ArrowLeft, Eye, Map, List, Loader2, Wand2, ArrowUp, ArrowDown, Upload, CheckCircle2, AlertCircle, MapPin, ListChecks,
} from 'lucide-react'
import { planBankDraft, splitRoadAddress } from '@/lib/bank-draft-plan'
import { checkPropertyField } from '@/lib/property-field-check'
import { ymdKST, todayKST } from '@/lib/date-kst'
import { Pagination, usePageSize } from '@/components/sheet/pagination'
import { EmptyRow } from '@/components/sheet/empty-row'
import { ImageLightbox } from '@/components/image-lightbox'
import { useColSettings, ColSettings } from '@/lib/use-col-settings'
import { geocodeAddress } from '@/lib/geocode'
import type { MapRow } from '@/components/broker/properties-map-view'
import { mapLimit } from '@/lib/map-limit'
import { pollWhileVisible } from '@/lib/poll-visible'
import { findDuplicateProperty } from '@/lib/dup-check'
import { useToast } from '@/components/toast'
import { ALL_ROOM_TYPES, PROPERTY_CATEGORIES } from '@/lib/property-types'
import { Spinner } from '@/components/ui/spinner'
import { SearchClear } from '@/components/ui/search-clear'
import { PropertyTextHistoryButton } from '@/components/sheet/property-text-history'
import { PropertyViewSheet } from '@/components/broker/property-view-sheet'
import { LocationCardSheet } from '@/components/broker/location-card-sheet'
import { chipClass } from '@/components/ui/chip'
import { AddToListSheet, PropertyListsSheet } from '@/components/broker/property-lists'

// 지도 뷰(카카오 핀·묶음·우측 패널)는 지도를 열 때만 받는다 — 목록만 보는 폰은 이 코드를 안 받는다
const PropertiesMapView = dynamic(() => import('@/components/broker/properties-map-view').then(m => m.PropertiesMapView), {
  ssr: false,
  loading: () => (
    <div className="relative flex flex-col items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm h-[560px] md:h-[calc(100vh-220px)] md:min-h-[640px]">
      <Loader2 className="h-7 w-7 animate-spin text-blue-600 mb-2" />
      <p className="text-sm text-gray-500">지도 불러오는 중...</p>
    </div>
  ),
})

interface Property {
  id: string
  seq_no: number | null
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
  lat: number | null
  lng: number | null
}


interface CustomColumn {
  id: string
  name: string
  type?: 'text' | 'select'
}

const DEAL_TYPES = ['매매', '전세', '월세']  // 신규 등록 페이지(new/page.tsx)와 일치
const ROOM_TYPES = ALL_ROOM_TYPES
const DIRECTION_OPTS = ['남향', '북향', '동향', '서향', '남동향', '남서향', '북동향', '북서향']
// 업종 기본 선택지 — 헤더 메뉴에서 각자 늘리고 줄일 수 있다
const INDUSTRY_OPTS = ['공실', '식당', '카페', '주점', '편의점', '뷰티샵', '학원', '병원', '약국', '사무실', '공방', '기타']
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// 매물장 데이터는 search_office_properties RPC가 서버에서 필터·검색·정렬·페이지 처리.
// (기존: 전건 1700건+/1.5MB를 받아 클라이언트에서 처리 → 폰에서 수 초 정지)
// 거래형태 색상 (셀 라벨용 tailwind 클래스 — 매 렌더 재생성 방지하려 모듈 상수)
const DEAL_TYPE_COLOR_MAP: Record<string, string> = {
  매매: 'bg-blue-100 text-blue-700',
  전세: 'bg-purple-100 text-purple-700',
  월세: 'bg-orange-100 text-orange-700',
  분양: 'bg-pink-100 text-pink-700',
  분양권: 'bg-rose-100 text-rose-700',
}

// 범위 필터 디바운스 초기값 — 디바운스가 만드는 것과 같은 모양으로 시작해야
// 진입 300ms 뒤 첫 디바운스가 "같은 값"으로 걸러져 목록 RPC 가 두 번 나가지 않는다
const EMPTY_RANGES: Record<string, number | null> = {
  priceMin: null, priceMax: null, rentMin: null, rentMax: null,
  pyeongMin: null, pyeongMax: null, floorMin: null, floorMax: null,
}

/** 지도 데이터를 다시 받지 않고 쓰는 시간. 지도↔목록을 오가는 동안만 아낀다. */
const MAP_REUSE_MS = 3 * 60 * 1000

// 고정 칼럼만 (지울 수 없음, 숨길 수는 있음)
const ALL_COLUMNS = [
  { key: 'status',          label: '매물상태' },
  { key: 'address',         label: '소재지' },
  { key: 'received_date',   label: '접수일자' },
  { key: 'size_pyeong',     label: '면적(전용/공급)' },
  { key: 'price',           label: '가격' },
  { key: 'room_type',       label: '중개대상물종류' },
  { key: 'industry',        label: '업종' },
  { key: 'deal_type',      label: '거래형태' },
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

// 업종은 DB 칼럼 없이 custom_fields.industry 에 담는다 — 행에 붙는 값이라 사무소 모두 같은 값을 본다.
// 공통 칼럼이 생기기 전 이예리 개인 칼럼(col_1793434493650)에 적힌 업종 29건은 그대로 이어 보인다.
const LEGACY_INDUSTRY_KEY = 'col_1793434493650'
// 업종은 사무소 모두 다중 선택 — 한 매물에 '식당, 카페' 처럼 여럿을 고른다(하나만 골라도 된다). 사람마다 끄는 스위치는 없앴다.
const industryOf = (p: { custom_fields: Record<string, string> | null }) =>
  p.custom_fields?.industry ?? p.custom_fields?.[LEGACY_INDUSTRY_KEY] ?? ''
const FIXED_COLS: ColKey[] = ALL_COLUMNS.map(c => c.key)

// 초기 커스텀 칼럼 (기본값 없음)
const DEFAULT_CUSTOM_COLS: CustomColumn[] = []

const DEFAULT_PROP_SETTINGS: ColSettings = {
  visible:    [...FIXED_COLS],
  order:      [...FIXED_COLS],
  widths: {
    status: 80,
    address: 200, received_date: 95, size_pyeong: 70, price: 96, room_type: 110, industry: 90, deal_type: 110,
    total_floors: 70, move_in_date: 90, rooms_bathrooms: 80,
    approval_date: 90, parking: 72, management_fee: 72,
    direction: 68, images: 56, brief_memo: 200, memo: 240, assignee: 80,
  },
  customCols: [],
  options:    { room_type: [...ROOM_TYPES], deal_type: [...DEAL_TYPES], direction: [...DIRECTION_OPTS], industry: [...INDUSTRY_OPTS] },
  colTypes:   {},
  multi:      {},
  areaUnit:   '평',
}

// ── 다음 우편번호 검색 모달 (embed — 모바일 팝업 차단 회피) ──────────
function PostcodeModal({ onComplete, onClose }: {
  onComplete: (data: { addr: string; bcode: string }) => void
  onClose: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const w = window as any
    if (!w.daum?.Postcode || !containerRef.current) return
    new w.daum.Postcode({
      oncomplete: (data: any) => {
        const addr = data.jibunAddress || data.roadAddress || data.address || ''
        onComplete({ addr, bcode: data.bcode ?? '' })
      },
      width: '100%',
      height: '100%',
    }).embed(containerRef.current)
  }, [onComplete])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-md h-[520px] bg-white dark:bg-gray-900 rounded-2xl shadow-xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">주소 검색</h3>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div ref={containerRef} className="flex-1 overflow-hidden" />
      </div>
    </div>
  )
}

// 자동채움 서버 오류 코드 → 사람 말 (등록하자마자 자동으로 돌아 코드가 그대로 뜨면 헷갈린다)
const AUTO_FILL_ERRORS: Record<string, string> = {
  address_not_found: '자동채움: 주소를 찾지 못했어요 — 동·지번으로 적어 주세요',
  building_not_found: '자동채움: 건축물대장에 없는 주소예요 — 면적은 직접 적어 주세요',
  missing_fields: '자동채움: 지번을 알 수 없어요 — 동·지번으로 적어 주세요',
  rate_limited: '자동채움은 한 시간에 30번까지예요 — 잠시 뒤 소재지 칸의 자동채움을 눌러 주세요',
  upstream_fetch_failed: '자동채움: 건축물대장 서버가 응답하지 않아요 — 잠시 뒤 다시',
}

// ── 소재지 셀 (다음 우편번호 검색 지원) ────────────────────────
function AddressCell({ value, onSave, onAutoFill, autoFilling = false, placeholder = '소재지 입력' }: {
  value: string | null
  onSave: (v: string) => void
  onAutoFill?: (bcode?: string) => void
  autoFilling?: boolean
  placeholder?: string
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [hovered, setHovered] = useState(false)
  const [postcodeOpen, setPostcodeOpen] = useState(false)
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
    void loadDaumPostcode().then(() => setPostcodeOpen(true),
      () => toast.error('주소 검색 모듈을 불러오지 못했어요. 잠시 후 다시 시도해주세요.'))
  }

  const handlePostcodeComplete = useCallback(({ addr, bcode }: { addr: string; bcode: string }) => {
    if (!addr) return
    bcodeRef.current = bcode
    setDraft(addr)
    setEditing(true)
    setPostcodeOpen(false)
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(addr.length, addr.length) }, 0)
  }, [])

  if (editing) {
    return (
      <>
        <div className="flex items-center gap-1">
          <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
            className="min-w-0 flex-1 rounded border border-blue-400 bg-white dark:bg-gray-900 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300"
          />
          <button type="button"
            onMouseDown={e => { e.preventDefault(); skipBlurRef.current = true }}
            onClick={openPostcode}
            className="shrink-0 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-1.5 py-1 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 hover:text-blue-600"
            title="주소 검색"
          >
            <Search className="h-3 w-3" />
          </button>
          {onAutoFill && (
            <button type="button"
              onMouseDown={e => { e.preventDefault(); skipBlurRef.current = true }}
              onClick={() => onAutoFill(bcodeRef.current || undefined)}
              disabled={autoFilling || !value}
              className="shrink-0 rounded border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-1.5 py-1 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 hover:text-indigo-600 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:text-gray-500"
              title={value ? '건축물대장에서 면적·층·승인일·주차·유형 자동채움' : '주소를 먼저 입력하세요'}
            >
              {autoFilling
                ? <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                : <Wand2 className="h-3 w-3" />}
            </button>
          )}
        </div>
        {postcodeOpen && <PostcodeModal onComplete={handlePostcodeComplete} onClose={() => setPostcodeOpen(false)} />}
      </>
    )
  }
  return (
    <>
      <div ref={cellRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="group flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 min-h-[22px]"
      >
        <span onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
          className={cn('min-w-0 flex-1 cursor-pointer overflow-hidden whitespace-nowrap text-ellipsis',
            value ? 'text-gray-700 dark:text-gray-200' : 'text-gray-500 dark:text-gray-400')}
        >
          {value || placeholder}
        </span>
        <button type="button" onClick={openPostcode}
          className="shrink-0 rounded p-0.5 text-gray-300 opacity-50 sm:opacity-0 transition-opacity hover:text-blue-500 sm:group-hover:opacity-100"
          title="주소 검색" aria-label="주소 검색"
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
      {postcodeOpen && <PostcodeModal onComplete={handlePostcodeComplete} onClose={() => setPostcodeOpen(false)} />}
    </>
  )
}

// ── 인라인 숫자 셀 ──────────────────────────────────────────
/**
 * 만원 단위 숫자 글 → 숫자. '3,000', '3000만', ' 3000 ' 을 읽고, 못 읽으면 NaN.
 * '삼천만' 같은 한글 숫자·'-' 는 NaN/음수로 돌려 위에서 알린다(말없이 버리지 않는다).
 */
/**
 * 다음 우편번호 SDK — 주소 검색을 누를 때 받는다. 매물목록을 열 때마다 받으면 폰 3G 에서
 * 첫 조회와 회선을 나눠 썼다(10-30 폰 속도 조사). 여러 번 불러도 한 번만 받는다.
 */
let postcodeLoading: Promise<void> | null = null
function loadDaumPostcode(): Promise<void> {
  if ((window as any).daum?.Postcode) return Promise.resolve()
  postcodeLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.setAttribute('data-daum-postcode', 'true')
    script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { postcodeLoading = null; script.remove(); reject(new Error('postcode')) }
    document.head.appendChild(script)
  })
  return postcodeLoading
}

function parseManwon(text: string): number {
  const t = text.normalize('NFKC').replace(/[,\s원]/g, '').replace(/만$/, '')
  if (t === '') return NaN
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

function NumberCell({ value, onSave, suffix = '만', placeholder, onSplit }: {
  value: number | null, onSave: (v: number | null) => void, suffix?: string, placeholder?: string
  /** '보증금/월세' 처럼 / 로 두 값을 적으면 부른다(가격 칸). 없으면 / 는 잘못된 입력이다. */
  onSplit?: (deposit: number, rent: number) => void
}) {
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  // 0 은 '아직 안 적음' 이다(새 줄의 기본값). 편집을 열 때 0 을 남겨 두면 3000 을 쳐서 30,000 이 된다 —
  // 점검에서 두 사람이 그렇게 10배를 저장했다(휴대폰은 글자 선택이 안 먹는다).
  const [draft, setDraft] = useState(value ? String(value) : '')
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    const raw = draft.trim()
    if (raw === '') { if (value) onSave(null); return }
    // "3000/200" — 옆 줄들처럼 보증금/월세로 적었다
    if (raw.includes('/')) {
      const [a, b] = raw.split('/')
      const dep = parseManwon(a ?? ''), rent = parseManwon(b ?? '')
      if (onSplit && Number.isFinite(dep) && Number.isFinite(rent)) { onSplit(dep, rent); return }
      toast.error(onSplit ? "'3000/200' 처럼 숫자로 적어 주세요 (만원 단위)." : '이 칸에는 숫자 하나만 적어 주세요 (만원 단위).')
      return
    }
    const num = parseManwon(raw)
    if (!Number.isFinite(num)) { toast.error(`'${raw}' 는 숫자로 읽을 수 없어요 — 만원 단위 숫자로 적어 주세요 (예: 3000).`); return }
    if (num !== value) onSave(num)
  }

  if (editing) {
    return (
      <input ref={inputRef} type="text" inputMode="decimal" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value != null ? String(value) : ''); setEditing(false) } }}
        className="w-full rounded border border-blue-400 bg-white dark:bg-gray-900 px-2 py-1 text-xs text-right outline-none focus:ring-2 focus:ring-blue-300"
      />
    )
  }
  const displayText = value ? `${value.toLocaleString()}${suffix}` : (placeholder ?? '—')
  return (
    <>
      <div ref={cellRef} onClick={() => { setDraft(value ? String(value) : ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (!!value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className={`w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap ${value ? 'text-gray-800 dark:text-gray-100 font-semibold' : 'text-gray-500 dark:text-gray-400'}`}
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
        className="w-full rounded border border-blue-400 bg-white dark:bg-gray-900 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300"
        placeholder="예: 3/15"
      />
    )
  }
  return (
    <div onClick={() => { setDraft(display); setEditing(true) }}
      className={cn("w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis", display ? 'text-gray-700 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400')}>
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
  const [draftPrice, setDraftPrice] = useState(price ? String(price) : '')
  const [draftRent, setDraftRent] = useState(rent ? String(rent) : '')
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
          className="w-0 flex-1 rounded border border-blue-400 bg-white dark:bg-gray-900 px-1 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-blue-300"
          placeholder="보증금"
        />
        <span className="text-gray-500 text-xs flex-shrink-0">/</span>
        <input ref={rentInputRef} type="number" value={draftRent} onChange={e => setDraftRent(e.target.value)}
          onBlur={commitRent}
          onKeyDown={e => {
            if (e.key === 'Enter') commitRent()
            if (e.key === 'Escape') { setDraftRent(rent != null ? String(rent) : ''); setEditing(false) }
          }}
          className="w-0 flex-1 rounded border border-blue-400 bg-white dark:bg-gray-900 px-1 py-1 text-xs text-right outline-none focus:ring-1 focus:ring-blue-300"
          placeholder="임차료"
        />
      </div>
    )
  }
  const dep = price ? `${price.toLocaleString()}만` : '보증금'
  const mo = rent ? `${rent.toLocaleString()}만` : '월세'
  return (
    <div className="w-full cursor-pointer rounded px-1 py-0.5 hover:bg-blue-50 min-h-[22px] text-xs text-right overflow-hidden whitespace-nowrap text-ellipsis"
      onClick={() => { setDraftPrice(price ? String(price) : ''); setDraftRent(rent ? String(rent) : ''); setEditing(true) }}>
      <span className={`font-semibold ${price ? 'text-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>{dep}</span>
      <span className="text-gray-500 mx-0.5">/</span>
      <span className={`font-semibold ${rent ? 'text-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400'}`}>{mo}</span>
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
      // 화면 오른쪽 끝 칸에서 열면 잘렸다(휴대폰) — 화면 안으로 당긴다
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: Math.max(8, Math.min(rect.left, Math.min(window.innerWidth, document.documentElement.clientWidth) - 176 - 8)) }
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
        className={cn("w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis", displayText ? 'text-gray-700 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400')}
      >
        {displayText ?? '전용/공급'}
      </div>
      {hovered && displayText && <CellTooltip text={displayText} anchorRef={btnRef} />}
      {open && (
        <div className="w-44 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg p-2 space-y-1.5" style={popupStyle}>
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
              className="w-0 flex-1 rounded border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
            />
            <span className="w-6 flex-shrink-0 text-right text-xs text-gray-500">{globalUnit}</span>
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
              className="w-0 flex-1 rounded border border-gray-200 dark:border-gray-800 px-2 py-1 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
            />
            <span className="w-6 flex-shrink-0 text-right text-xs text-gray-500">{globalUnit}</span>
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

  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const MAX_IMAGES = 5
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

  /** 고른 파일 중 사진만, 5장까지. 넘치는 것은 잘라 낸다. */
  const pickImages = (list: Iterable<File>, room: number) =>
    Array.from(list).filter(f => ALLOWED_TYPES.includes(f.type) && f.size <= 10 * 1024 * 1024).slice(0, Math.max(0, room))

  const addFiles = (incoming: File[]) => {
    const files = pickImages(incoming, MAX_IMAGES - localImgs.length - newFiles.length)
    if (!files.length) return
    setNewFiles(p => [...p, ...files])
    files.forEach(f => { const r = new FileReader(); r.onload = ev => setNewPreviews(p => [...p, ev.target?.result as string]); r.readAsDataURL(f) })
  }
  const handleAdd = (e: React.ChangeEvent<HTMLInputElement>) => addFiles(Array.from(e.target.files ?? []))

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return [] as string[]
    const { data } = await supabase.auth.getUser()
    const uid = data.user?.id ?? 'unknown'
    // 한 장씩 차례로 올리면 5장에 5배 걸렸다 — 3장씩 함께(더 많이 하면 폰이 줄이는 동안 메모리가 모자란다).
    // 순서는 고른 순서 그대로, 못 올린 장은 빠진다.
    const urls = await mapLimit(files, 3, async original => {
      // 원본(장당 1~4MB)을 그대로 올려 저장 한도를 며칠 만에 채울 뻔했다 — 올리기 전에 줄인다
      const file = await shrinkImage(original, PROPERTY_PHOTO_SIDE, PROPERTY_PHOTO_QUALITY)
      const ext = file.name.split('.').pop()
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('property-images').upload(path, file, { upsert: false })
      if (error) return null
      return supabase.storage.from('property-images').getPublicUrl(path).data.publicUrl
    })
    const uploaded = urls.filter((u): u is string => !!u)
    return uploaded
  }

  const saveAndClose = async () => {
    const uploaded = await uploadFiles(newFiles)
    const all = [...localImgs, ...uploaded]
    setNewFiles([]); setNewPreviews([]); setOpen(false)
    onSave(all)
  }

  // 파일을 끌어다 놓으면 바로 올린다 — 칸을 열고 고르고 저장까지 세 번 누를 일을 한 번으로.
  // 창이 열려 있으면 미리보기에만 더하고(저장은 [저장]으로), 닫혀 있으면 올려서 바로 저장한다.
  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const onDragOver = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    if (!dragOver) setDragOver(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    setDragOver(false)
  }
  const onDrop = async (e: React.DragEvent) => {
    if (!isFileDrag(e)) return
    e.preventDefault(); e.stopPropagation()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (open) { addFiles(dropped); return }
    const files = pickImages(dropped, MAX_IMAGES - localImgs.length)
    if (!files.length) return
    setUploading(true)
    try {
      const uploaded = await uploadFiles(files)
      if (uploaded.length) {
        const all = [...localImgs, ...uploaded]
        setLocalImgs(all)
        onSave(all)
      }
    } finally {
      setUploading(false)
    }
  }

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const openUp = window.innerHeight - rect.bottom < 260
      // 사진 창(256px)이 오른쪽으로 잘려 [저장] 이 안 보였다(휴대폰·가로로 민 표) — 화면 안으로 당긴다
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: Math.max(8, Math.min(rect.left, Math.min(window.innerWidth, document.documentElement.clientWidth) - 256 - 8)) }
      if (openUp) s.bottom = window.innerHeight - rect.top + 4
      else s.top = rect.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v)
  }

  return (
    <div ref={ref} className="relative" onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div ref={btnRef} onClick={handleOpen}
        title="누르면 사진을 고르고, 사진 파일을 여기로 끌어다 놓으면 바로 올라갑니다 (5장까지)"
        className={`cursor-pointer flex gap-1 items-center rounded px-1 py-0.5 min-h-[22px] transition-colors ${dragOver ? 'bg-blue-100 ring-2 ring-blue-400 dark:bg-blue-900/40' : 'hover:bg-blue-50'}`}>
        {uploading
          ? <span className="flex items-center gap-1 text-xs text-blue-600"><Loader2 className="h-3 w-3 animate-spin" />올리는 중</span>
          : dragOver && !open
          ? <span className="text-xs font-semibold text-blue-600">{localImgs.length >= MAX_IMAGES ? '5장까지입니다' : '놓으면 올라갑니다'}</span>
          : localImgs.length === 0
          ? <span className="text-xs text-gray-500">사진</span>
          : <>
              <div className="h-6 w-6 overflow-hidden rounded border border-gray-200 dark:border-gray-800 flex-shrink-0">
                <img src={localImgs[0]} alt="매물 사진" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </div>
              {localImgs.length > 1 && <span className="text-[10px] text-gray-500">+{localImgs.length - 1}</span>}
            </>
        }
      </div>
      {open && (
        <div className={`w-64 rounded-xl border bg-white dark:bg-gray-900 shadow-lg p-3 ${dragOver ? 'border-blue-400 ring-2 ring-blue-200' : 'border-gray-200 dark:border-gray-800'}`} style={popupStyle}>
          <p className="mb-2 text-[11px] text-gray-500">사진 파일을 여기로 끌어다 놓아도 됩니다 (5장까지)</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {localImgs.map((src, i) => (
              <div key={i} className="relative h-14 w-14 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800 group">
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
              <label className="flex h-14 w-14 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-500 hover:border-blue-400 transition-colors">
                <ImagePlus className="h-4 w-4" />
                {/* accept="image/*" 는 윈도우 크롬이 등록된 그림 확장자를 전부 펼쳐 파일 창이 '응답 없음'으로 멈추곤 했다(11-05 직원 PC).
                    어차피 받는 네 가지(ALLOWED_TYPES)만 적는다 */}
                <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" multiple className="hidden" onChange={handleAdd} />
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

// ── 매물상태 토글 셀 (가능 ↔ 완료) ─────────────────────────────
// readOnly면 동일한 모양의 비활성 박스로 렌더 → 편집 가능 셀과 시각적으로 통일
// (직원이 남의 매물을 볼 때도 본인 매물과 동일하게 보이도록)
function StatusToggleCell({ value, onSave, readOnly }: {
  value: 'available' | 'contracted' | 'hidden'
  onSave?: (v: 'available' | 'contracted') => void
  readOnly?: boolean
}) {
  const isCompleted = value === 'contracted'
  const colorCls = isCompleted
    ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
  const label = isCompleted ? '완료' : '가능'

  if (readOnly) {
    return (
      <div className={cn('w-full rounded-md px-2 py-1 text-xs font-semibold text-center min-h-[22px]', colorCls)}>
        {label}
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onSave?.(isCompleted ? 'available' : 'contracted')}
      title={isCompleted ? '누르면 다시 가능으로 되돌릴지 묻습니다' : '누르면 계약완료로 바꿀지 묻습니다'}
      className={cn(
        'w-full rounded-md px-2 py-1 text-xs font-semibold transition-colors min-h-[22px] max-md:min-h-[34px]',
        colorCls,
        isCompleted ? 'hover:bg-gray-200' : 'hover:bg-green-200'
      )}
    >
      {label}
    </button>
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
      <HelpCircle className="h-3.5 w-3.5 text-gray-500 cursor-help" />
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


// ── 광고 배지 ──────────────────────────────────────────
// 이 매물이 지금 어디에 광고되고 있는지. 광고 대장(ad_listings)이 매물을 가리킬 때만 안다 —
// PC 가 [가져오기] 로 대장 줄을 적을 때 DB 가 잇는다(재등록 앞 줄의 연결을 물려받거나,
// 주소(지번·동·층·지하·호)·거래 종류·가격이 맞는 매물이 하나뿐일 때). 여기서 매물을 등록하는
// 것만으로는 안 이어진다 — 광고관리의 칩에서 사람이 바로 이을 수도 있다.
type AdRow = {
  id: string
  property_id: string | null
  bank_no: string
  naver_no: string | null
  bank_tab: string | null
  contracted_at: string | null
  ad_posts: Array<{ channel: string; status: string }> | null
}
type AdBadge = {
  label: '광고중' | '뱅크만'
  title: string
  /** 살아 있는 곳 — '뱅크/카페' */
  어디: string
  /** 광고관리에서 찾을 번호. 화면이 쓰는 번호(네이버, 없으면 뱅크)다. 살아 있는 광고 줄마다 하나. */
  번호: string[]
  /** 살아 있는 광고 줄이 전부 이미 [광고종료] 를 누른 것 — 내리는 중이다. */
  종료누름: boolean
}
const AD_CHANNEL_LABEL: Record<string, string> = { cafe: '카페', blog: '블로그', daangn: '당근' }

/** 뱅크 임시저장 작업(bank_draft_jobs) — 매물마다 가장 최근 것만 본다. */
type BankDraftJob = {
  id: string
  property_id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'canceled'
  progress: string | null
  error: string | null
  result: { bankNo?: string | null; photos?: number; photoFails?: string[]; warnings?: string[] } | null
  requested_at: string
  finished_at: string | null
}
const BANK_DRAFT_ACTIVE = new Set(['queued', 'running'])

/**
 * [뱅크 임시저장] 버튼 — 복사·삭제 옆. 상태에 따라 모양이 바뀐다.
 * 돌아가는 중에는 누를 수 없고, 끝난 것은 다시 누르면 한 번 더 넣는다(뱅크 임시저장은 7일 뒤 지워진다).
 */
function BankDraftButton({ job, onClick }: { job?: BankDraftJob; onClick: () => void }) {
  const 진행중 = !!job && BANK_DRAFT_ACTIVE.has(job.status)
  if (진행중) {
    return (
      <span title={`뱅크 임시저장 ${job.status === 'queued' ? '대기 중 — PC 프로그램(뱅크 임시저장 일꾼)이 켜져 있어야 합니다' : `진행 중: ${job.progress ?? ''}`}`}
        className="flex h-6 w-6 items-center justify-center text-blue-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    )
  }
  const 끝 = job?.status === 'done' ? `뱅크에 임시 저장했습니다 (${ymdKST(job.finished_at ?? job.requested_at)}${job.result?.bankNo ? `, 임시매물 ${job.result.bankNo}` : ''}). 뱅크 '임시 저장목록' 에서 [등록] 을 누르세요. 다시 누르면 한 번 더 넣습니다.`
    : job?.status === 'failed' ? `뱅크 임시저장 실패: ${job.error ?? ''} — 다시 누르면 다시 시도합니다.`
    : '뱅크에 임시 저장 — PC 프로그램이 등록 화면을 채워 둡니다. 최종 등록은 뱅크에서 직접.'
  return (
    <button type="button" onClick={onClick} title={끝} aria-label="뱅크 임시저장" tabIndex={-1}
      className={`flex h-6 shrink-0 items-center justify-center gap-0.5 rounded px-1 transition-colors ${job?.status === 'done' ? 'text-green-500 hover:bg-green-50' : job?.status === 'failed' ? 'text-red-400 hover:bg-red-50' : 'text-gray-400 hover:bg-blue-50 hover:text-blue-500'}`}>
      {job?.status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" /> : job?.status === 'failed' ? <AlertCircle className="h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
      {/* 밖(뱅크)으로 데이터를 보내는 버튼인데 그림만 있어 무엇인지 몰랐다(11-06 점검) */}
      <span className="whitespace-nowrap text-[10px] font-medium">뱅크</span>
    </button>
  )
}

/** [입지] 버튼 — 소재지로 토지·용도지역·건물·정화조·IC 거리를 한 장에 본다(공장·창고·상가 상담용) */
function LocationButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title="입지 — 용도지역·토지·건물·정화조·IC 거리·주변 점포 수" aria-label="입지 보기" tabIndex={-1}
      className="flex h-6 shrink-0 items-center justify-center gap-0.5 rounded px-1 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500">
      <MapPin className="h-3.5 w-3.5" />
      <span className="whitespace-nowrap text-[10px] font-medium">입지</span>
    </button>
  )
}

/**
 * 광고 대장 줄들 → 매물별 배지.
 *
 * **광고관리 화면(ads/page.tsx 의 게시중)과 같은 잣대를 쓴다** — 뱅크는 등록매물 탭에 있으면
 * 살아 있고, 카페·블로그·당근은 status 'posted' 인 글만 센다(블로그 임시저장은 아직 안 올라간
 * 글이다). 채널 'bank' 줄은 글이 아니라 안 센다 — 뱅크가 살아 있는지는 bank_tab 이 말한다.
 * 두 화면이 갈리면 한쪽은 '광고 남음' 인데 다른 쪽은 아무 표시가 없다.
 * `in` 대신 Object.hasOwn — `in` 은 'constructor' 같은 내장 이름에도 참이 된다.
 * 끝난 광고만 남은 매물은 배지를 달지 않는다.
 */
function buildAdBadges(rows: AdRow[]): Record<string, AdBadge> {
  const 모음: Record<string, { 뱅크: boolean; 채널: Set<string>; 번호: string[]; 안누름: boolean }> = {}
  for (const a of rows) {
    if (!a.property_id) continue
    const m = (모음[a.property_id] ??= { 뱅크: false, 채널: new Set(), 번호: [], 안누름: false })
    const 게시중 = (a.ad_posts ?? []).filter(p => p.status === 'posted' && Object.hasOwn(AD_CHANNEL_LABEL, p.channel))
    const 뱅크 = a.bank_tab === '등록매물'
    if (뱅크) m.뱅크 = true
    for (const p of 게시중) m.채널.add(p.channel)
    if (뱅크 || 게시중.length) {
      // 아직 [광고종료] 를 안 누른 줄을 앞에 — 배지는 첫 번호로 광고관리를 여는데, 조회에 순서가
      // 없어 이미 내리는 중인 줄이 먼저 오면 사람이 눌러야 할 줄이 아닌 데로 데려간다.
      if (a.contracted_at) m.번호.push(a.naver_no ?? a.bank_no)
      else { m.번호.unshift(a.naver_no ?? a.bank_no); m.안누름 = true }
    }
  }
  const out: Record<string, AdBadge> = {}
  for (const [id, m] of Object.entries(모음)) {
    if (!m.뱅크 && !m.채널.size) continue
    const 채널 = Object.keys(AD_CHANNEL_LABEL).filter(c => m.채널.has(c)).map(c => AD_CHANNEL_LABEL[c])
    const 어디 = [...(m.뱅크 ? ['뱅크'] : []), ...채널].join('/')
    // 배지를 누르면 광고관리에서 첫 번호로 찾은 채로 열린다(?q=). 재등록 등으로 살아 있는
    // 광고 줄이 둘 이상이면 나머지 번호는 여기 적어 둔다.
    const 찾기 = ` — 광고 ${m.번호.join(', ')} · 누르면 광고관리에서 찾아 엽니다`
    out[id] = {
      ...(채널.length
        ? { label: '광고중' as const, title: `광고중 · ${어디}${찾기}` }
        : { label: '뱅크만' as const, title: `뱅크만 — 카페·블로그·당근에는 광고가 없습니다${찾기}` }),
      어디, 번호: m.번호, 종료누름: !m.안누름,
    }
  }
  return out
}

// ── 매물 행 (React.memo로 셀 편집 시 다른 행 re-render 차단) ──────────
interface PropertyRowProps {
  p: Property
  /** 지금 살아 있는 광고. 없으면 배지를 달지 않는다. */
  adBadge?: AdBadge
  /** 이 매물의 가장 최근 뱅크 임시저장 작업 */
  bankDraft?: BankDraftJob
  onBankDraft: (p: Property) => void
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
  /** 업종 선택지 — 사무소 공통(대표 설정) */
  industryOpts: string[]
  ownerName: string
  saveField: (id: string, field: string, value: any) => void
  /** 매물상태(가능↔완료)는 바로 저장하지 않고 확인창을 거친다 — 한 번 잘못 눌러 계약완료가 되면 광고까지 내려야 한다. */
  onStatusChange: (p: Property, next: 'available' | 'contracted') => void
  autoFillRow: (id: string, addr: string, bcode?: string) => void
  saveCustomField: (propertyId: string, colId: string, value: string) => void
  setLightbox: React.Dispatch<React.SetStateAction<{ images: string[]; index: number } | null>>
  onDelete: (id: string) => void
  onCopy: (p: Property) => void
  /** 폰에서 번호 칸 [보기] — 매물 한 건을 위아래로 읽는 창 (useState 세터라 memo 를 깨지 않는다) */
  onView: (v: { p: Property; memoVisible: boolean }) => void
  /** [입지] — 소재지로 토지·용도지역·건물·IC 거리를 한 장에 (useState 세터) */
  onLocation: (v: { address: string; roomType: string | null }) => void
  /** [담기] — 손님 미팅용 매물 리스트에 보낸다(useState 세터). 관리자 뷰에선 없다 */
  onAddToList?: (p: Property) => void
  /** 여러 개 고르기 중일 때만 — 번호 칸이 체크칸이 된다(useState 세터 감싼 안정 함수) */
  onPick?: (p: Property) => void
  picked?: boolean
}

const PropertyRow = memo(function PropertyRow({
  p, adBadge, bankDraft, onBankDraft, syncedOrder, customColumns, settings,
  isAdminView, canEdit, isOwner, brokerSelfId,
  isAdding, isAutoFilling, teamMembers, industryOpts, ownerName,
  saveField, onStatusChange, autoFillRow, saveCustomField, setLightbox,
  onDelete, onCopy, onView, onLocation, onAddToList, onPick, picked,
}: PropertyRowProps) {
  const toast = useToast()
  // 직원은 본인 매물만 편집·복사·삭제 가능. 대표/관리자뷰는 전체 가능.
  const isMine = isOwner || p.broker_id === brokerSelfId
  // 중개사메모 열람 권한: 본인 매물 + 담당자에 대표가 포함된 매물(사무소 공용 성격)은 전체 직원 공개.
  // assignee는 "김용유, 김가주"처럼 콤마로 다중 저장됨(select-cell.tsx와 동일 파싱).
  const memoVisible = isMine ||
    (!!ownerName && (p.assignee ?? '').split(',').map(s => s.trim()).includes(ownerName))
  // 계약완료인데 광고가 살아 있다 — 표시광고법상 바로 내려야 해서 빨갛게 바꾼다.
  // 상태는 그릴 때 읽는다 — 이 화면에서 '완료' 로 바꾸는 순간 배지도 같이 바뀐다.
  const 광고남음 = !!adBadge && p.status === 'contracted'
  const 광고배지글 = !adBadge ? '' : !광고남음 ? adBadge.title
    : adBadge.종료누름
      ? `계약완료한 매물인데 광고가 아직 남아 있습니다(${adBadge.어디}). [광고종료] 는 눌러 두어 내리는 중입니다`
        + ' — 안 내려가면 광고관리의 [못 내림] 탭에 뜹니다.'
      : `계약완료한 매물인데 광고가 아직 살아 있습니다(${adBadge.어디}).`
        + ' 광고관리에서 그 줄의 ↓ [광고종료] 를 눌러 뱅크·카페·당근에서 내려 주세요 — 누르면 광고관리로 갑니다.'
  return (
    <tr data-row-id={p.id}
      className={`border-b transition-colors ${isAdding ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50/60'} ${p.status === 'hidden' ? 'opacity-50' : ''}`}
    >
      {/* 광고 배지는 번호 밑에 작게 붙인다 — 칸을 새로 내면 표가 넓어진다.
          고르기(select-all)는 번호에만 건다 — 번호를 복사할 때 '광고중'·'보기' 가 딸려 오지 않게.
          배지는 칸 여백까지 조금 쓴다(-mx-1) — 칸 안쪽이 40px 라 '광고 남음' 넉 자가 넘친다. */}
      <td className={`px-2 py-1.5 border-r border-gray-100 dark:border-gray-800 text-center text-xs font-semibold text-gray-500 dark:text-gray-500 tabular-nums`} style={{ width: 56, maxWidth: 56 }} title="매물번호 (사무소 내 고정)">
        {adBadge ? (
          <>
            <span className="block select-all leading-none">{p.seq_no ?? ''}</span>
            {/* 줄마다 다른 주소라 prefetch 를 끈다 — 켜 두면 화면에 들어온 줄 수만큼 미리 받는다. */}
            <Link href={`/broker/ads?q=${encodeURIComponent(adBadge.번호[0])}`} prefetch={false} title={광고배지글}
              className={`-mx-1 block select-none whitespace-nowrap rounded text-[10px] font-medium leading-3 ${광고남음
                ? 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-400'
                : adBadge.label === '광고중'
                  ? 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-400'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400'}`}
            >{광고남음 ? '광고 남음' : adBadge.label === '광고중' ? '광고 중' : adBadge.label}</Link>
          </>
        ) : <span className="block select-all leading-none">{p.seq_no ?? ''}</span>}
        {/* select-none — 칸 전체에 select-all 이 걸려 있을 땐 폰에서 [보기] 를 누르면 번호가 블록으로 잡혔다(11-05)
            넓은 화면에서도 손가락 화면이면 보인다 — 펼친 폴드는 640px 를 넘어 sm:hidden 에 숨었다(11-06). 마우스+넓은 화면만 숨김 */}
        {/* 여러 개 고르기 중엔 보기·담기 대신 체크칸 하나 — 줄 높이가 그대로다 */}
        {onPick ? (
          <button type="button" onClick={() => onPick(p)} aria-pressed={!!picked} aria-label={`${p.seq_no ?? ''}번 고르기`}
            className={`mt-1 flex w-full select-none items-center justify-center rounded py-1 ${picked ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-transparent dark:border-gray-700 dark:bg-gray-900'}`}>
            <CheckCircle2 className="h-4 w-4" />
          </button>
        ) : <>
        <button type="button" onClick={() => onView({ p, memoVisible })}
          className="mt-1 block w-full select-none rounded bg-blue-50 py-1 text-[11px] font-semibold text-blue-700 sm:pointer-fine:hidden dark:bg-blue-950/40 dark:text-blue-300">보기</button>
        {onAddToList && (
          <button type="button" onClick={() => onAddToList(p)} title="손님 미팅용 리스트에 담기"
            className="mt-1 hidden w-full select-none rounded bg-gray-100 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-200 sm:pointer-fine:block dark:bg-gray-800 dark:text-gray-300">담기</button>
        )}
        </>}
      </td>
      {syncedOrder.map(key => {
        const fixedCol = ALL_COLUMNS.find(c => c.key === key)
        if (fixedCol) {
          if (!settings.visible.includes(key)) return null
          const w = settings.widths[key] ?? 100
          // 읽기 전용 셀 (어드민 뷰 / 편집 권한 없음 / 본인 매물 아님)
          if (isAdminView || !canEdit || !isMine) {
            // 긴 텍스트(메모/설명)는 읽기 전용이어도 hover 툴팁으로 전체 보이게 유지.
            // 일반 div로 렌더하면 잘린 채 확인할 방법이 없어짐(직원이 남의 매물 볼 때).
            if (key === 'memo' || key === 'brief_memo') {
              const v = key === 'memo' ? (memoVisible ? p.memo : null) : p.brief_memo
              return (
                <td key={key} className="px-2 py-1.5 border-r border-gray-100 dark:border-gray-800" style={{ width: w, maxWidth: w }}>
                  <LongTextCell value={v ?? null} onSave={() => {}} placeholder="—" readOnly />
                </td>
              )
            }
            const readVal = (() => {
              if (key === 'status') {
                return <StatusToggleCell value={p.status} readOnly />
              }
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
                return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${DEAL_TYPE_COLOR_MAP[p.deal_type] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-500'}`}>{p.deal_type}</span>
              }
              if (key === 'room_type') return <span className="rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-500">{p.room_type}</span>
              if (key === 'images') return p.images?.length > 0
                ? <div className="flex items-center gap-1"><img src={p.images[0]} alt="매물 사진" loading="lazy" decoding="async" className="h-6 w-6 rounded border border-gray-200 dark:border-gray-800 object-cover" />{p.images.length > 1 && <span className="text-[10px] text-gray-500">+{p.images.length - 1}</span>}</div>
                : <span className="text-xs text-gray-500">—</span>
              if (key === 'industry') return industryOf(p) || '—'
              const raw: any = (p as any)[key]
              return raw != null && raw !== '' ? String(raw) : '—'
            })()
            const NUMERIC_RIGHT_COLS = ['price', 'size_pyeong', 'management_fee', 'premium', 'total_floors']
            const isNum = NUMERIC_RIGHT_COLS.includes(key)
            return (
              <td key={key} className="px-2 py-1.5 border-r border-gray-100 dark:border-gray-800" style={{ width: w, maxWidth: w }}>
                <div className={`w-full overflow-hidden whitespace-nowrap text-ellipsis text-xs text-gray-700 dark:text-gray-300 px-1 min-h-[22px] ${isNum ? 'text-right' : ''}`}>{readVal}</div>
              </td>
            )
          }
          return (
            <td key={key} className="px-2 py-1.5 border-r border-gray-100 dark:border-gray-800" style={{ width: w, maxWidth: w }}>
              {key === 'status'          && <StatusToggleCell value={p.status} onSave={v => onStatusChange(p, v)} />}
              {key === 'address'         && <AddressCell value={p.address} onSave={v => saveField(p.id, 'address', v)} onAutoFill={(bcode) => autoFillRow(p.id, p.address || '', bcode)} autoFilling={isAutoFilling} placeholder="소재지 입력" />}
              {key === 'size_pyeong'     && <AreaCell size={p.size_pyeong} supplied={p.area_supplied} globalUnit={settings.areaUnit ?? '평'} onSave={(ded, sup) => { saveField(p.id, 'size_pyeong', ded); saveField(p.id, 'area_supplied', sup ? Number(sup) : null) }} />}
              {key === 'price'           && (p.deal_type === '월세'
                ? <RentPriceCell price={p.price} rent={p.monthly_rent} onSavePrice={v => saveField(p.id, 'price', v ?? 0)} onSaveRent={v => saveField(p.id, 'monthly_rent', v)} />
                : <NumberCell value={p.price} onSave={v => saveField(p.id, 'price', v ?? 0)} placeholder="가격"
                    onSplit={(dep, rent) => {
                      // 거래형태가 비었거나 월세가 들어 있으면 월세로 본다. 매매·전세만이면 / 는 틀린 입력이다.
                      if (p.deal_type && !p.deal_type.includes('월세')) { toast.error('매매·전세 매물은 가격 하나만 적어 주세요. 월세라면 거래형태를 먼저 월세로 바꿔 주세요.'); return }
                      if (!p.deal_type) saveField(p.id, 'deal_type', '월세')
                      saveField(p.id, 'price', dep)
                      saveField(p.id, 'monthly_rent', rent)
                    }} />)}
              {key === 'room_type'       && (settings.colTypes['room_type'] === 'text' ? <TextCell value={p.room_type} onSave={v => saveField(p.id, 'room_type', v)} placeholder="건물 유형" /> : <SelectCell value={p.room_type} options={settings.options['room_type'] ?? ROOM_TYPES} onSave={v => saveField(p.id, 'room_type', v)} placeholder="중개대상물" multi={settings.multi['room_type']} />)}
              {key === 'industry'        && (settings.colTypes['industry'] === 'text' ? <TextCell value={industryOf(p) || null} onSave={v => saveCustomField(p.id, 'industry', v)} placeholder="예: 식당" /> : <SelectCell value={industryOf(p)} options={industryOpts} onSave={v => saveCustomField(p.id, 'industry', v)} placeholder="업종" multi />)}
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
              {key === 'brief_memo'      && (settings.colTypes['brief_memo'] === 'select' ? <SelectCell value={p.brief_memo ?? ''} options={settings.options['brief_memo'] ?? []} onSave={v => saveField(p.id, 'brief_memo', v)} multi={settings.multi['brief_memo']} /> : <div className="flex items-start gap-1"><div className="min-w-0 flex-1"><LongTextCell value={p.brief_memo} onSave={v => saveField(p.id, 'brief_memo', v || null)} placeholder="매물설명" maxLength={1000} /></div><PropertyTextHistoryButton propertyId={p.id} field="brief_memo" label="매물설명" onRestore={v => saveField(p.id, 'brief_memo', v || null)} /></div>)}
              {key === 'memo'            && (settings.colTypes['memo'] === 'select'
                ? <SelectCell value={p.memo ?? ''} options={settings.options['memo'] ?? []} onSave={v => saveField(p.id, 'memo', v)} multi={settings.multi['memo']} />
                : <div className="flex items-start gap-1"><div className="min-w-0 flex-1"><LongTextCell value={p.memo} onSave={v => saveField(p.id, 'memo', v || null)} placeholder="중개사 메모" /></div><PropertyTextHistoryButton propertyId={p.id} field="memo" label="중개사 메모" onRestore={v => saveField(p.id, 'memo', v || null)} /></div>)}
              {key === 'assignee'        && <SelectCell value={p.assignee ?? ''} options={teamMembers} onSave={v => saveField(p.id, 'assignee', v || null)} placeholder="담당자" multi={settings.multi['assignee']} />}
            </td>
          )
        }
        const customCol = customColumns.find(c => c.id === key)
        if (customCol && settings.visible.includes(key)) {
          const w = settings.widths[key] ?? 120
          return (
            <td key={key} className="px-2 py-1.5 border-r border-gray-100 dark:border-gray-800" style={{ width: w, maxWidth: w }}>
              {(isAdminView || !canEdit || !isMine)
                ? <div className="w-full overflow-hidden whitespace-nowrap text-ellipsis text-xs text-gray-700 dark:text-gray-300 px-1 min-h-[22px]">{(p.custom_fields ?? {})[key] || '—'}</div>
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
        <SheetActionCell canEdit={canEdit && isMine} onCopy={() => onCopy(p)} onDelete={() => onDelete(p.id)}
          // 대표는 사무소 매물 전부, 직원은 자기 매물만 뱅크에 넣는다(2026-10-21 결정). DB(RLS)도 같은 규칙.
          extra={<>
            {/* 입지는 읽기만 하는 조회라 남의 매물에도 보인다 */}
            {p.address?.trim() ? <LocationButton onClick={() => onLocation({ address: p.address, roomType: p.room_type })} /> : null}
            {canEdit && isMine && p.status !== 'contracted' ? <BankDraftButton job={bankDraft} onClick={() => onBankDraft(p)} /> : null}
          </>} />
      )}
    </tr>
  )
})

// ── 메인 페이지 ──────────────────────────────────────────
export default function BrokerPropertiesPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Spinner size="lg" />
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
  const toast = useToast()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  // 서버 페이지네이션: properties는 "현재 페이지 행"만 담는다.
  // 필터·검색·정렬·페이지는 search_office_properties RPC가 DB에서 처리.
  const [properties, setProperties] = useState<Property[]>([])
  // 저장 함수(useCallback deps 없음)가 최신 행을 읽는 통로.
  // setProperties updater 안에서 바깥 변수를 채우면 안 된다 — React 는 대기 중인 갱신이 있으면
  // updater 를 다음 렌더로 미뤄서, 바로 다음 줄의 DB 저장에는 빈 값이 나갔다(custom_fields 가 {} 로 저장됨).
  const propertiesRef = useRef(properties)
  propertiesRef.current = properties
  // 조회 스코프 — 일반 경로는 사무소 단일 id(office_broker_id), 어드민 개별 열람만 broker id 배열 유지
  const [scopeState, setScopeState] = useState<{ office: string } | { brokerIds: string[] } | null>(null)
  const officeIdRef = useRef<string>('')  // saveField(useCallback deps 없음)에서 최신 사무소 범위 참조용
  const [officeAddress, setOfficeAddress] = useState<string | null>(null)  // 지도 초기 중심용 사무소 주소
  const [totalCount, setTotalCount] = useState(0)   // 필터·검색 반영 총 건수
  const [allCount, setAllCount] = useState<number | null>(null)  // 필터 무관 전체 건수 (헤더 표시). 세기 전엔 null — '전체 0건' 이 잠깐 보였다(11-06 점검)
  const [mapRows, setMapRows] = useState<MapRow[]>([])  // 지도 뷰 전용 — 열 때만 전체 로드
  const tableScrollRef = useRef<HTMLDivElement>(null)
  const [mapLoading, setMapLoading] = useState(false)    // 지도 행 받는 중 (안 받았을 때 '매물 없음'이 먼저 뜨지 않게)
  const [canEdit] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [isAdminView, setIsAdminView] = useState(false)
  const [isOwner, setIsOwner] = useState(true)
  const [teamMembers, setTeamMembers] = useState<string[]>([])
  const [ownerName, setOwnerName] = useState('')  // 사무소 대표 이름 (중개사메모 공개 판정용)
  const [selfName, setSelfName] = useState('')    // 내 이름 — 새 매물 담당자 기본값
  const [adminViewBrokerName, setAdminViewBrokerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [filterDealType, setFilterDealType] = useState('')
  const [filterRoomTypes, setFilterRoomTypes] = useState<string[]>([])  // 다중 선택
  const [filterStatus, setFilterStatus] = useState<'' | 'available' | 'contracted'>('')  // 매물상태 (가능/완료)
  const toggleRoomType = (t: string) => {
    setFilterRoomTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }
  const toggleRoomGroup = (types: string[]) => {
    // 그룹 전체 선택 / 전체 해제 토글
    setFilterRoomTypes(prev => {
      const allSelected = types.every(t => prev.includes(t))
      if (allSelected) return prev.filter(x => !types.includes(x))
      return Array.from(new Set([...prev, ...types]))
    })
  }
  const [filterAssignees, setFilterAssignees] = useState<string[]>([])  // 담당자 다중 선택
  const [filterIndustries, setFilterIndustries] = useState<string[]>([])  // 업종 다중 선택
  const toggleIndustry = (t: string) => {
    setFilterIndustries(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }
  const toggleAssignee = (name: string) => {
    setFilterAssignees(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])
  }
  // 범위 필터 — 입력은 문자열로 받고, 300ms 디바운스 후 숫자로 파싱해 서버에 전달
  const [filterPriceMin, setFilterPriceMin] = useState('')   // 보증금/매매가 (만원)
  const [filterPriceMax, setFilterPriceMax] = useState('')
  const [filterRentMin, setFilterRentMin] = useState('')     // 월세 (만원)
  const [filterRentMax, setFilterRentMax] = useState('')
  const [filterPyeongMin, setFilterPyeongMin] = useState('') // 평수
  const [filterPyeongMax, setFilterPyeongMax] = useState('')
  const [filterFloorMin, setFilterFloorMin] = useState('')   // 층수
  const [filterFloorMax, setFilterFloorMax] = useState('')
  const [debouncedRanges, setDebouncedRanges] = useState<Record<string, number | null>>(EMPTY_RANGES)
  useEffect(() => {
    const num = (s: string) => { const n = parseFloat(s.replace(/,/g, '')); return isNaN(n) ? null : n }
    const t = setTimeout(() => {
      const next = {
        priceMin: num(filterPriceMin), priceMax: num(filterPriceMax),
        rentMin: num(filterRentMin), rentMax: num(filterRentMax),
        pyeongMin: num(filterPyeongMin), pyeongMax: num(filterPyeongMax),
        // 층은 DB 정수 칸이라 너무 큰 수는 영문 오류가 떴다(11-06 재점검) — 200층 넘으면 200으로 본다
        floorMin: num(filterFloorMin) == null ? null : Math.min(num(filterFloorMin)!, 200),
        floorMax: num(filterFloorMax) == null ? null : Math.min(num(filterFloorMax)!, 200),
      }
      // 값이 같으면 이전 객체 유지 — 새 객체면 rpcParams 가 다시 만들어져 같은 RPC 가 또 나간다
      setDebouncedRanges(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
    }, 300)
    return () => clearTimeout(t)
  }, [filterPriceMin, filterPriceMax, filterRentMin, filterRentMax, filterPyeongMin, filterPyeongMax, filterFloorMin, filterFloorMax])
  // 활성 필터 개수 (버튼 배지·초기화 버튼 노출 판정) — 범위는 종류당 1개로 센다
  const rangeCount = [
    [filterPriceMin, filterPriceMax], [filterRentMin, filterRentMax],
    [filterPyeongMin, filterPyeongMax], [filterFloorMin, filterFloorMax],
  ].filter(([a, b]) => a || b).length
  const activeFilterCount = (filterDealType ? 1 : 0) + filterRoomTypes.length + (filterStatus ? 1 : 0)
    + filterAssignees.length + filterIndustries.length + rangeCount
  const resetFilters = () => {
    setFilterDealType(''); setFilterRoomTypes([]); setFilterStatus(''); setFilterAssignees([]); setFilterIndustries([])
    setFilterPriceMin(''); setFilterPriceMax(''); setFilterRentMin(''); setFilterRentMax('')
    setFilterPyeongMin(''); setFilterPyeongMax(''); setFilterFloorMin(''); setFilterFloorMax('')
  }
  const [showFilter, setShowFilter] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  // 타이핑마다 서버 요청이 나가지 않도록 300ms 디바운스
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300)
    return () => clearTimeout(t)
  }, [searchQuery])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('properties')
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [isMapView, setIsMapView] = useState(false)
  const [jumpId, setJumpId] = useState<string | null>(null)  // 지도 패널 → 목록 이동 시 강조할 행
  // 카카오 geocoder 결과 캐시 (effect 재실행·검색 변경 시에도 유지) — OVER_QUERY_LIMIT 회피
  const geocodeCacheRef = useRef<Record<string, { lat: number; lng: number } | null>>({})
  const savedCoordIdsRef = useRef<Set<string>>(new Set())
  const [addingId, setAddingId] = useState<string | null>(null)
  const [autoFillingId, setAutoFillingId] = useState<string | null>(null)
  const [autoFillToast, setAutoFillToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'property' | 'column'; id: string; label?: string } | null>(null)
  // 삭제 확인창에 어느 매물인지 적는다(네 사람이 "복구할 수 없어요" 라는 반대 문구와 함께 헷갈려 했다)
  const deleteTarget = deleteConfirm?.type === 'property' ? propertiesRef.current.find(p => p.id === deleteConfirm.id) ?? null : null
  // 매물상태 확인창. 첫 사용자 점검에서 상태 칸을 한 번 눌렀을 뿐인데 확인 없이 '완료' 가 됐다 —
  // 계약완료는 광고를 내려야 하는 상태라 묻고 바꾼다. 살아 있는 광고가 있으면 그것도 같이 보인다.
  const [statusConfirm, setStatusConfirm] = useState<{ p: Property; next: 'available' | 'contracted' } | null>(null)
  // 폰에서 페이지가 화면보다 넓게 잡히면 fixed 확인창이 보이는 영역 밖(우하단)에 떠서 안 보였다.
  // 확인창이 열려 있는 동안 '지금 눈에 보이는 영역'(visualViewport)에 맞춰 위치·크기를 잡는다.
  const [vvBox, setVvBox] = useState<{ l: number; t: number; w: number; h: number } | null>(null)
  useEffect(() => {
    const v = typeof window !== 'undefined' ? window.visualViewport : null
    if (!statusConfirm || !v) return
    const upd = () => setVvBox({ l: v.offsetLeft, t: v.offsetTop, w: v.width, h: v.height })
    upd()
    v.addEventListener('resize', upd); v.addEventListener('scroll', upd)
    return () => { v.removeEventListener('resize', upd); v.removeEventListener('scroll', upd); setVvBox(null) }
  }, [statusConfirm])
  // 뱅크 임시저장 확인창 — 넣을 수 있는지(planBankDraft)를 먼저 보여 주고 넣는다.
  const [bankDraftConfirm, setBankDraftConfirm] = useState<{ p: Property; plan: ReturnType<typeof planBankDraft>; addressFrom?: string } | null>(null)
  const [bankDraftSaving, setBankDraftSaving] = useState(false)
  // Esc 로 확인창 닫기 — 점검에서 Esc 가 안 먹어 뒤가 막힌 줄 알았다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setDeleteConfirm(null); setStatusConfirm(null); setBankDraftConfirm(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([])
  const [settingsBrokerId, setSettingsBrokerId] = useState<string | null>(null)
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const wasDragRef = useRef(false)

  // 칼럼 정렬 (가격·평수 등 헤더 클릭)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const toggleSort = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc') }
    else if (sortDir === 'asc') { setSortDir('desc') }
    else { setSortKey(null); setSortDir('asc') }  // 3번째 클릭: 정렬 해제
  }

  // 칼럼 설정 (DB)
  const { settings, update, loaded: colLoaded } = useColSettings('properties', settingsBrokerId, DEFAULT_PROP_SETTINGS)
  // 업종 선택지는 사무소 공통 — 대표 칼럼 설정에 있는 목록을 직원도 그대로 쓴다. 고치는 건 대표만(직원은 대표 행을 못 고친다).
  const [officeIndustryOpts, setOfficeIndustryOpts] = useState<string[] | null>(null)
  const industryOpts = isOwner ? (settings.options['industry'] ?? INDUSTRY_OPTS) : (officeIndustryOpts ?? INDUSTRY_OPTS)
  const { direction, updateDirection } = useSheetDirection(broker?.id ?? null, 'properties')

  // 신규 고정칼럼(매물상태) 자동 마이그레이션 — 기존 사용자의 DB에 저장된 visible/order에 없으면 추가
  const statusMigratedRef = useRef(false)
  useEffect(() => {
    if (!colLoaded || statusMigratedRef.current) return
    if (settings.visible.includes('status') && settings.order.includes('status')) {
      statusMigratedRef.current = true
      return
    }
    statusMigratedRef.current = true
    update(prev => ({
      ...prev,
      visible: prev.visible.includes('status') ? prev.visible : ['status', ...prev.visible],
      order: prev.order.includes('status') ? prev.order : ['status', ...prev.order],
    }))
  }, [colLoaded, settings.visible, settings.order])

  // 업종 칼럼도 같은 방식 — 저장된 순서에 없으면 중개대상물종류 뒤에 한 번 끼워 보이게 한다. 그 뒤 숨김은 각자 몫.
  const industryMigratedRef = useRef(false)
  useEffect(() => {
    if (!colLoaded || industryMigratedRef.current) return
    industryMigratedRef.current = true
    if (settings.order.includes('industry')) return
    update(prev => {
      const order = prev.order.filter(k => k !== LEGACY_INDUSTRY_KEY)
      const at = order.indexOf('room_type')
      order.splice(at >= 0 ? at + 1 : order.length, 0, 'industry')
      return { ...prev, order, visible: [...prev.visible.filter(k => k !== LEGACY_INDUSTRY_KEY), 'industry'] }
    })
  }, [colLoaded, settings.order])

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
  useEffect(() => { setPage(1) }, [filterDealType, filterRoomTypes, filterStatus, filterAssignees, filterIndustries, debouncedRanges, searchQuery, pageSize])



  const init = async () => {
    const targetBrokerId = searchParams.get('broker_id')

    // 어드민이 다른 중개사 매물장을 보는 경우 — auth 우회 (직접 fetch)
    if (targetBrokerId) {
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) { router.push('/auth/login'); return }
      setUser(u)
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', u.id).single()
      if (profile?.role !== 'admin') { router.push('/broker/properties'); return }

      const { data: b } = await supabase.from('broker_profiles').select('id, parent_broker_id, custom_columns, office_name, address, profiles(name)').eq('id', targetBrokerId).single()
      if (!b) { router.push('/admin'); return }
      setBroker(b)
      setIsAdminView(true)
      setAdminViewBrokerName((b.profiles as any)?.name || b.office_name || '(이름 없음)')
      const cols: CustomColumn[] = b.custom_columns?.length > 0 ? b.custom_columns : DEFAULT_CUSTOM_COLS
      setCustomColumns(cols)
      const { data: ownBroker } = await supabase.from('broker_profiles').select('id').eq('user_id', u.id).single()
      if (ownBroker) setSettingsBrokerId(ownBroker.id)
      // 행 데이터는 서버 페이지네이션 effect가 RPC로 가져온다.
      // 어드민 열람은 해당 중개사 개인 행만 보는 기존 동작을 유지 (사무소 전체 아님).
      officeIdRef.current = b.parent_broker_id ?? b.id
      setOfficeAddress(b.address ?? null)
      setScopeState({ brokerIds: [b.id] })
      void supabase.from('broker_properties').select('id', { count: 'exact', head: true })
        .eq('broker_id', b.id).then(({ count }) => setAllCount(count ?? 0))
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
    }

    // ── 커스텀 칼럼 로드 ───────────────────────────────
    const cc = b.custom_columns as CustomColumn[] | undefined
    const cols: CustomColumn[] = cc && cc.length > 0 ? cc : DEFAULT_CUSTOM_COLS
    setCustomColumns(cols)

    // ── 팀원 이름 목록 (담당자 드롭다운용) ──────────────
    // 매물 조회를 기다리게 하지 않는다 — 느린 폰 회선에서 왕복 하나가 2초라,
    // 이름 → 직원 목록 → 매물 순으로 줄 세우면 매물이 4초 늦게 떴다(2026-10-29 점검).
    void (async () => {
      // 내 이름은 로그인 때 받아 둔 것을 쓴다(없을 때만 묻는다)
      const myName = (auth.profile?.name
        ?? (await supabase.from('profiles').select('name').eq('id', u.id).single()).data?.name) as string | undefined
      setSelfName(myName ?? '')
      if (owner) {
        setOwnerName(myName ?? '')  // 대표 본인 → 내 이름이 곧 대표 이름
        // 사무소 사람 목록은 화면끼리 같이 쓴다(office-members) — 고객·일지에서 넘어오면 다시 묻지 않는다
        const emps = await getOfficeMembers(b.id).catch(() => [])
        const empNames = emps.filter(e => !e.isOwner && e.approved).map(e => e.name).filter(Boolean)
        setTeamMembers([myName, ...empNames].filter(Boolean) as string[])
      } else {
        setTeamMembers(myName ? [myName] : [])
        // 직원 → 대표(parent_broker_id) 이름 조회. 담당자에 대표 이름이 잡힌 매물의 메모를 열람하기 위함.
        if (b.parent_broker_id) {
          const { data: ownerBroker } = await supabase
            .from('broker_profiles').select('address, col_settings, profiles(name)').eq('id', b.parent_broker_id).single()
          setOwnerName((ownerBroker?.profiles as any)?.name ?? '')
          const officeOpts = (ownerBroker as any)?.col_settings?.properties?.options?.industry
          if (Array.isArray(officeOpts)) setOfficeIndustryOpts(officeOpts)
          setOfficeAddress((ownerBroker as any)?.address ?? null)
        }
      }
    })()

    // ── 데이터 범위 결정 ───────────────────────────────
    // 룰: 대표·직원 모두 사무소 전체 매물을 봄. 다른 직원 매물은 셀 단위로 읽기 전용 렌더링되고
    //     중개사 메모(memo)는 본인 매물에만 노출됨. 편집은 RLS의 can_edit_broker_property가 차단.
    // 스코프는 office_broker_id 단일 컬럼 — 직원 목록 조립 왕복이 없다. 직원별 열람 제한
    // (permissions.can_see_others=false)은 RLS가 행 단위로 걸러준다.
    const office = owner ? b.id : (b.parent_broker_id ?? b.id)
    if (owner) setOfficeAddress(b.address ?? null)

    // 행 데이터는 서버 페이지네이션 effect가 RPC로 가져온다
    officeIdRef.current = office
    setScopeState({ office })
    // '전체' 건수는 아래 첫 쪽 조회가 끝날 때 센다 — 여기서 또 세면 같은 요청이 두 번 나간다
  }

  // ── 서버 페이지네이션 — 현재 페이지 분량만 RPC로 조회 ──────────
  // 필터·검색·정렬·방향이 바뀔 때마다 해당 조건으로 서버에서 다시 받는다.
  // sortKey 없으면 등록순(direction: up=최신부터, down=오래된 것부터).
  // 조건(페이지 제외)은 지도 RPC 도 그대로 쓴다 — 같은 순서여야 [목록에서 열기]가 페이지를 맞힌다.
  const filterParams = useMemo(() => ({
    p_office: scopeState && 'office' in scopeState ? scopeState.office : null,
    p_broker_ids: scopeState && 'brokerIds' in scopeState ? scopeState.brokerIds : null,
    // % _ 는 ILIKE 와일드카드라 그대로 보내면 '%' 하나에 전부가 나온다. 전각 숫자(２０２２)는 반각으로.
    p_q: debouncedQuery ? debouncedQuery.normalize('NFKC').replace(/[\\%_]/g, '\\$&') : null,
    p_deal_type: filterDealType || null,
    p_room_types: filterRoomTypes.length > 0 ? filterRoomTypes : null,
    p_status: filterStatus || null,
    p_assignees: filterAssignees.length > 0 ? filterAssignees : null,
    // 업종을 고를 때만 보낸다
    ...(filterIndustries.length > 0 ? { p_industries: filterIndustries } : {}),
    p_price_min: debouncedRanges.priceMin ?? null,
    p_price_max: debouncedRanges.priceMax ?? null,
    p_rent_min: debouncedRanges.rentMin ?? null,
    p_rent_max: debouncedRanges.rentMax ?? null,
    p_pyeong_min: debouncedRanges.pyeongMin ?? null,
    p_pyeong_max: debouncedRanges.pyeongMax ?? null,
    p_floor_min: debouncedRanges.floorMin ?? null,
    p_floor_max: debouncedRanges.floorMax ?? null,
    p_sort_key: sortKey ?? 'created_at',
    p_sort_dir: sortKey ? sortDir : (direction === 'up' ? 'desc' : 'asc'),
  }), [scopeState, debouncedQuery, filterDealType, filterRoomTypes, filterStatus, filterAssignees, filterIndustries, debouncedRanges, sortKey, sortDir, direction])
  useEffect(() => { tableScrollRef.current?.scrollTo({ left: 0 }) }, [filterParams])
  const rpcParams = useCallback((limit: number, offset: number) => ({
    ...filterParams, p_limit: limit, p_offset: offset,
  }), [filterParams])
  // 목록 행이 받아 온 배열 그대로인지 — 아니면 목록에서 고친 것 (아래 지도 데이터 무효화용)
  const fetchedPageRef = useRef<Property[] | null>(null)
  // 지금 properties 가 어느 검색어의 결과인지. ?focus= 가 검색을 걸어 두고 "결과가 왔는데도 없다" 를
  // 가려낼 때 쓴다 — 상태(loading)만 보면 검색어가 바뀐 렌더에서 옛 결과를 새 결과로 착각한다.
  const fetchedQueryRef = useRef<string | null>(null)
  // '전체' 건수를 마지막으로 센 조건 — 쪽 넘기기마다 다시 세지 않게
  const allCountKeyRef = useRef<typeof filterParams | null>(null)

  useEffect(() => {
    if (!scopeState) return
    let cancelled = false
    ;(async () => {
      const 조건 = rpcParams(pageSize, (page - 1) * pageSize)
      const { data, error } = await supabase.rpc('search_office_properties', 조건)
      if (cancelled) return
      if (error) {
        console.error('[properties] page fetch failed', error)
        toast.error(`매물 조회 실패: ${error.message}`)
        setLoading(false)
        return
      }
      const rows = (data ?? []).map((r: any) => r.data as Property)
      fetchedPageRef.current = rows
      fetchedQueryRef.current = 조건.p_q ?? ''
      // 목록을 받는 사이 등록 창으로 넣은 매물이 조회보다 늦게 들어가면 결과에 빠진다 — 첫 쪽 맨 위에 붙여 둔다
      const 늦게 = page === 1 ? addedWhileLoadingRef.current.filter(a => !rows.some((r: Property) => r.id === a.id)) : []
      addedWhileLoadingRef.current = []
      setProperties(늦게.length ? [...늦게, ...rows] : rows)
      setTotalCount(Number(data?.[0]?.total_count ?? 0))
      setLoading(false)
      // '전체' 도 같은 시점에 다시 센다 — 다른 사람이 줄을 넣거나 지우면 전체가 멈춰 있어 검색이 전체보다 커 보였다.
      // 쪽만 넘길 때는 세지 않는다(조건이 그대로면 전체도 그대로).
      if (조건.p_office && allCountKeyRef.current !== filterParams) {
        allCountKeyRef.current = filterParams
        void supabase.from('broker_properties').select('id', { count: 'exact', head: true })
          .eq('office_broker_id', 조건.p_office).is('deleted_at', null)
          // 전체 수는 조건과 상관없으니 조건이 바뀌어도 버리지 않는다 — 버리면 '전체 0건' 에 멈춰 있었다
          .then(({ count }) => { if (count != null) setAllCount(count) })
      }
      // 필터 변경 등으로 현재 페이지가 범위를 벗어나면 1페이지로
      if (rows.length === 0 && page > 1) setPage(1)
    })()
    return () => { cancelled = true }
  }, [scopeState, page, pageSize, rpcParams, filterParams])

  // ── 광고 배지 — 지금 쪽에 뜬 매물의 광고만 한 번에 받는다 ──
  // 쪽이 바뀔 때만 다시 묻는다(칸을 고쳐도 id 묶음은 그대로라 안 나간다). 줄마다 묻지 않는다.
  // 못 받으면 배지만 빠진다 — 매물목록은 광고와 상관없이 써야 한다.
  const [adRows, setAdRows] = useState<AdRow[]>([])
  const visibleIdsKey = properties.map(p => p.id).join(',')
  // 매물 잇기(ad_listings_property_link.sql)가 DB 에 아직 없으면 property_id 칸이 없어 42703 이 난다.
  // 쪽을 넘길 때마다 콘솔에 빨간 줄을 쌓을 일이 아니다 — 한 번 겪으면 이 화면에서는 더 묻지 않는다.
  const adBadgeUnavailableRef = useRef(false)
  useEffect(() => {
    if (!visibleIdsKey || adBadgeUnavailableRef.current) { setAdRows([]); return }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('ad_listings')
        .select('id, property_id, bank_no, naver_no, bank_tab, contracted_at, ad_posts(channel, status)')
        .in('property_id', visibleIdsKey.split(','))
      if (cancelled) return
      if (error) {
        if (error.code === '42703') { adBadgeUnavailableRef.current = true; return }
        console.error('[properties] 광고 배지를 못 읽었습니다', error.message)
        return
      }
      setAdRows((data ?? []) as AdRow[])
    })()
    return () => { cancelled = true }
  }, [visibleIdsKey, supabase])
  const adBadges = useMemo(() => buildAdBadges(adRows), [adRows])

  // ── 뱅크 임시저장 작업 — 지금 쪽 매물의 가장 최근 작업. 돌아가는 것이 있으면 20초마다 다시 본다 ──
  const [bankDraftRows, setBankDraftRows] = useState<BankDraftJob[]>([])
  const bankDraftUnavailableRef = useRef(false)   // 표가 아직 없으면(42P01) 조용히 접는다
  const [bankDraftTick, setBankDraftTick] = useState(0)
  useEffect(() => {
    if (!visibleIdsKey || bankDraftUnavailableRef.current) { setBankDraftRows([]); return }
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('bank_draft_jobs')
        .select('id, property_id, status, progress, error, result, requested_at, finished_at')
        .in('property_id', visibleIdsKey.split(','))
        .order('requested_at', { ascending: false })
      if (cancelled) return
      if (error) {
        if (error.code === '42P01') { bankDraftUnavailableRef.current = true; return }
        console.error('[properties] 뱅크 임시저장 작업을 못 읽었습니다', error.message)
        return
      }
      setBankDraftRows((data ?? []) as BankDraftJob[])
    })()
    return () => { cancelled = true }
  }, [visibleIdsKey, supabase, bankDraftTick])
  const bankDrafts = useMemo(() => {
    const m: Record<string, BankDraftJob> = {}
    for (const j of bankDraftRows) if (!m[j.property_id]) m[j.property_id] = j   // 최근 순이라 첫 것이 최신
    return m
  }, [bankDraftRows])
  const bankDraftActive = bankDraftRows.some(j => BANK_DRAFT_ACTIVE.has(j.status))
  // 앱을 내려 둔 동안은 묻지 않는다 — 폰은 하루 종일 켜 두므로 숨어서도 20초마다 쿼리가 나갔다
  useEffect(() => {
    if (!bankDraftActive) return
    return pollWhileVisible(() => setBankDraftTick(t => t + 1), 20_000)
  }, [bankDraftActive])
  // 뱅크 임시저장 일꾼이 켜져 있나 — PC 가 20초마다 ad_agents.bank_draft_seen_at 을 찍는다.
  // 대기 중인 요청이 있는데 일꾼이 꺼져 있으면 위에 알린다. 직원이 눌렀는데 돌기만 하던 일이 있었다.
  const [bankWorkerSeenAt, setBankWorkerSeenAt] = useState<string | null>(null)
  useEffect(() => {
    if (!bankDraftActive) return
    let alive = true
    const tick = async () => {
      const { data } = await supabase.from('ad_agents').select('bank_draft_seen_at').maybeSingle()
      if (alive) setBankWorkerSeenAt((data as { bank_draft_seen_at?: string | null } | null)?.bank_draft_seen_at ?? null)
    }
    // bankDraftTick 을 deps 에 두면 20초마다 처음부터 다시 돌아(바로 한 번 + 새 15초 타이머) 두 배로 물었다
    tick()
    const stop = pollWhileVisible(tick, 15_000)
    return () => { alive = false; stop() }
  }, [bankDraftActive, supabase])
  const bankWorkerOffline = bankDraftActive && !(bankWorkerSeenAt && Date.now() - new Date(bankWorkerSeenAt).getTime() < 60_000)

  // 뱅크 확인창 열기. 도로명으로 적힌 소재지는 지번을 찾아 바꿔 보여 주고, 요청할 때 소재지에 저장한다
  // — PC 일꾼은 매물 줄을 다시 읽어 같은 planBankDraft 로 채우므로 저장해 둬야 넣을 수 있다(#2098).
  async function openBankDraft(row: Property) {
    const plan = planBankDraft(row)
    if (plan.ok || !splitRoadAddress(row.address)) { setBankDraftConfirm({ p: row, plan }); return }
    const res = await fetch('/api/bank-address', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: row.address }),
    }).then(r => r.ok ? r.json() : null).catch(() => null)
    const address: string | null = res?.address ?? null
    if (!address) { setBankDraftConfirm({ p: row, plan }); return }
    const next = { ...row, address }
    setBankDraftConfirm({ p: next, plan: planBankDraft(next), addressFrom: row.address ?? '' })
  }

  async function requestBankDraft(p: Property, addressFrom?: string) {
    const office = officeIdRef.current
    if (!office || !auth.user) return
    setBankDraftSaving(true)
    if (addressFrom != null && !await saveField(p.id, 'address', p.address)) { setBankDraftSaving(false); return }
    const { error } = await supabase.from('bank_draft_jobs')
      .insert({ office_broker_id: office, property_id: p.id, requested_by: auth.user.id })
    setBankDraftSaving(false)
    if (error) {
      toast.error(error.code === '42501'
        ? '이 매물은 내가 뱅크에 넣을 수 없습니다 — 담당자나 대표만 넣을 수 있습니다.'
        : `뱅크 임시저장을 요청하지 못했습니다: ${error.message}`)
      return
    }
    setBankDraftConfirm(null)
    setBankDraftTick(t => t + 1)
    toast.success('뱅크 임시저장에 줄 섰습니다. PC 의 [뱅크 임시저장 일꾼] 이 켜져 있으면 곧 채웁니다.')
  }

  // ── 지도 뷰 데이터 — 지도를 열 때만 현재 필터의 전체 매물 로드 ──
  // 목록 RPC(행 집합)로 받으면 PostgREST max-rows(1000)에 조용히 잘려 최신 1,000건만 핀이 찍혔다.
  // map_office_properties 는 json 배열 하나라 안 잘리고, 칸도 지도가 읽는 것만 담는다.
  // 같은 조건으로 방금 받았으면(지도↔목록 왕복, 같은 값으로 다시 만들어진 조건) 다시 안 받는다.
  // 다만 몇 분까지만 — 폰은 하루 종일 켜 두는데, 그사이 다른 직원이 매물을 더하거나 지우면
  // 핀 색이 낡고 [목록에서 열기]가 배열 순번으로 쪽을 셈해 엉뚱한 쪽을 연다.
  const mapParamsKey = useMemo(() => JSON.stringify(filterParams), [filterParams])
  const mapFetchedRef = useRef({ key: '', at: 0 })
  useEffect(() => {
    if (!isMapView || !scopeState) return
    const 받은것 = mapFetchedRef.current
    if (받은것.key === mapParamsKey && Date.now() - 받은것.at < MAP_REUSE_MS) return
    let cancelled = false
    setMapLoading(true)
    ;(async () => {
      const { data, error } = await supabase.rpc('map_office_properties', filterParams)
      if (cancelled) return
      setMapLoading(false)
      if (error) { console.error('[properties] map fetch failed', error); return }
      mapFetchedRef.current = { key: mapParamsKey, at: Date.now() }
      setMapRows((data ?? []) as MapRow[])
    })()
    return () => { cancelled = true; setMapLoading(false) }
  }, [isMapView, scopeState, filterParams, mapParamsKey])
  // 목록에서 고치거나 추가·삭제하면 받아 둔 지도 데이터는 낡았다 — 다음에 지도를 열 때 다시 받는다
  useEffect(() => {
    if (properties !== fetchedPageRef.current) mapFetchedRef.current = { key: '', at: 0 }
  }, [properties])

  // 단일 필드 저장 (optimistic UI + 실패 시 롤백)
  // 담당자 변경 알림은 DB 트리거(notify_assignee_change)가 처리
  const saveField = useCallback(async (id: string, field: string, value: any) => {
    // 되돌릴 값·중복 검사 기준은 updater 밖에서 읽는다 (updater 는 언제 돌지 모른다)
    const row = propertiesRef.current.find(p => p.id === id) as any
    const prevValue = row?.[field]
    const rowDealType: string | null = row?.deal_type || null
    // 말이 안 되는 값은 저장하지 않는다 — 음수 가격·10조·0.5층·글자 날짜가 그대로 들어갔었다
    const 거절 = checkPropertyField(field, value)
    if (거절) { toast.error(거절); return false }
    setProperties(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
    const { error } = await supabase.from('broker_properties').update({ [field]: value }).eq('id', id)
    if (error) {
      console.error('[saveField] failed', error)
      setProperties(prev => prev.map(p => p.id === id ? { ...p, [field]: prevValue } : p))
      toast.error(`저장 실패: ${error.message}`)
      return false
    } else if (field === 'address' && typeof value === 'string' && value.trim() && value !== prevValue) {
      // 중복 의심 경고 — 등록봇과 같은 기준(사무소 전체 소재지+거래형태). 저장은 이미 됐으므로 차단하지 않고 알림만.
      void findDuplicateProperty(supabase, officeIdRef.current, value, rowDealType, id).then(dup => {
        if (dup) toast.info(`⚠️ 같은 소재지 매물이 이미 있어요: ${dup.address} · ${dup.deal_type}${dup.assignee ? ` · 담당 ${dup.assignee}` : ''}`)
      })
      // 주소가 바뀌면 좌표도 다시 구해 함께 저장 — 지도 뷰가 카카오 JS geocoder 호출 없이 즉시 마커 표시.
      const coords = await geocodeAddress(value)
      if (coords) {
        await supabase.from('broker_properties').update({ lat: coords.lat, lng: coords.lng }).eq('id', id)
        setProperties(prev => prev.map(p => p.id === id ? { ...p, lat: coords.lat, lng: coords.lng } : p))
      } else {
        // 변환 실패 시 stale 좌표 제거
        await supabase.from('broker_properties').update({ lat: null, lng: null }).eq('id', id)
        setProperties(prev => prev.map(p => p.id === id ? { ...p, lat: null, lng: null } : p))
      }
    }
    return true
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
      // 층수 제거 후 호수 추출 (단일·다중·범위 지원)
      const { addr: searchAddr, hos, floor } = splitAddressForAutoFill(addr)

      const callAutoFill = async (ho: string) => {
        const body = bcode && bcode.length === 10
          ? { bcode, address: searchAddr, ho, floor }
          : { address: searchAddr, ho, floor }
        const r = await fetch('/api/properties/auto-fill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const d = await r.json()
        return { ok: r.ok, data: d as Record<string, any> }
      }

      let data: Record<string, any>
      let mergedHos: string[] = []
      const failedHos: string[] = []

      if (hos.length <= 1) {
        const { ok, data: d } = await callAutoFill(hos[0] ?? '')
        if (!ok) throw new Error(AUTO_FILL_ERRORS[d.error] ?? d.error ?? '세움터 조회 실패')
        data = d
      } else {
        // 다호수 합산: 순차 호출 (서버 캐시가 부지 단위로 동작해 추가 비용 거의 없음)
        const results: Array<{ ho: string; data: Record<string, any> }> = []
        for (const h of hos) {
          const { ok, data: d } = await callAutoFill(h)
          if (ok) results.push({ ho: h, data: d })
          else failedHos.push(h)
        }
        if (results.length === 0) {
          throw new Error('전체 호수 조회 실패')
        }
        const base = { ...results[0].data }
        // size_m2가 있으면 거기서 합산 (정확), 없으면 size_pyeong 합산
        const sumM2 = results.reduce((s, r) => s + (Number(r.data.size_m2) || 0), 0)
        const sumM2Sup = results.reduce((s, r) => s + (Number(r.data.size_m2_supplied) || 0), 0)
        if (sumM2 > 0) {
          base.size_m2 = +sumM2.toFixed(2)
          base.size_pyeong = +(sumM2 / 3.305785).toFixed(2)
        }
        if (sumM2Sup > 0) {
          base.size_m2_supplied = +sumM2Sup.toFixed(2)
          base.size_pyeong_supplied = +(sumM2Sup / 3.305785).toFixed(2)
        }
        data = base
        mergedHos = results.map(r => r.ho)
      }

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

      // 자동채움 시 좌표도 함께 확보 (이미 있으면 굳이 재호출 안 함)
      const hasCoords = !!propertiesRef.current.find(p => p.id === id)?.lat
      if (!hasCoords) {
        const coords = await geocodeAddress(addr)
        if (coords) {
          updates.lat = coords.lat
          updates.lng = coords.lng
        }
      }

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
      const mergedLabel = mergedHos.length > 1 ? ` [${mergedHos.join('+')}호 합산]` : ''
      const failedLabel = failedHos.length > 0 ? ` (실패: ${failedHos.join(',')})` : ''
      setAutoFillToast({
        type: 'success',
        text: filledNames.length > 0
          ? `자동채움: ${filledNames.join(' · ')}${data.building_name ? ` (${data.building_name})` : ''}${mergedLabel}${failedLabel}`
          : `건축물대장 조회됨 (변경 없음)${mergedLabel}`,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '자동채움 실패'
      setAutoFillToast({ type: 'error', text: msg })
    } finally {
      setAutoFillingId(null)
      setTimeout(() => setAutoFillToast(null), 3500)
    }
  }, [supabase])

  // 커스텀 필드 값 저장 (optimistic + 실패 시 롤백)
  // custom_fields 는 객체 통째로 덮어쓴다 — 봇이 넣은 contact·price_raw 같은 키도 같이 들어 있으므로
  // 반드시 행의 지금 값 전체에 이 칸만 얹어 보낸다.
  const saveCustomField = useCallback(async (propertyId: string, colId: string, value: string) => {
    const rows = propertiesRef.current
    const prop = rows.find(p => p.id === propertyId)
    // 행을 못 찾으면 {[colId]: value} 만 나가 다른 키가 다 지워진다 — 저장하지 않는다
    if (!prop) { toast.error('저장 실패: 매물을 찾지 못했어요. 새로고침 후 다시 시도해 주세요'); return }
    const prevFields = prop.custom_fields ?? null
    const updated = { ...(prevFields ?? {}), [colId]: value }
    // 같은 틱에 같은 행의 다른 칸을 또 저장해도 이 값을 딛고 서도록 렌더를 기다리지 않고 바로 반영
    propertiesRef.current = rows.map(p => p.id === propertyId ? { ...p, custom_fields: updated } : p)
    setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, custom_fields: updated } : p))
    const { error } = await supabase.from('broker_properties').update({ custom_fields: updated }).eq('id', propertyId)
    if (error) {
      console.error('[saveCustomField] failed', error)
      // 이 칸만 되돌린다 — 그사이 저장한 다른 칸까지 옛 값으로 덮지 않게
      setProperties(prev => prev.map(p => {
        if (p.id !== propertyId) return p
        const fields = { ...(p.custom_fields ?? {}) }
        if (prevFields && colId in prevFields) fields[colId] = prevFields[colId]
        else delete fields[colId]
        return { ...p, custom_fields: fields }
      }))
      toast.error(`저장 실패: ${error.message}`)
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

  /**
   * [매물 등록] — 소재지를 받는 작은 창을 먼저 띄운다.
   *
   * 예전엔 누르는 즉시 빈 줄을 저장했다. 무엇을 적어야 끝나는지 안내가 없어, 그냥 떠나면
   * 소재지 없는 빈 매물이 목록에 남았다(2026-10-25 점검). 저장이 실패해도 말없이 끝나 화면엔
   * 등록된 것처럼 보이기도 했다. 이제 소재지를 적어야 저장하고, 실패하면 이유를 알린다.
   */
  const [newProp, setNewProp] = useState<{ address: string; deal_type: string } | null>(null)
  const [viewProp, setViewProp] = useState<{ p: Property; memoVisible: boolean } | null>(null)
  const [listFor, setListFor] = useState<Property[] | null>(null)  // [담기] 할 매물(한 건 또는 고른 여러 건)
  const addOneToList = useCallback((p: Property) => setListFor([p]), [])
  // 여러 개 고르기 — 미팅 매물을 한 번에 리스트로(11-06). 쪽을 넘겨도 고른 건 남는다
  const [pickMode, setPickMode] = useState(false)
  const [picked, setPicked] = useState<Record<string, Property>>({})
  const togglePick = useCallback((p: Property) => setPicked(m => {
    const n = { ...m }
    if (n[p.id]) delete n[p.id]; else n[p.id] = p
    return n
  }), [])
  const pickedList = Object.values(picked)
  const endPick = () => { setPickMode(false); setPicked({}) }
  const [showLists, setShowLists] = useState(false)               // 상단 [리스트]
  const listOfficeId = scopeState && 'office' in scopeState ? scopeState.office : null
  const [locationOf, setLocationOf] = useState<{ address: string; roomType: string | null } | null>(null)
  const addingRef = useRef(false)
  const addedWhileLoadingRef = useRef<Property[]>([])
  // 3G 에서 누르고 몇 초 동안 화면이 그대로라 한 번 더 누르고 싶어졌다 — 버튼에 '등록 중…'
  const [addingNew, setAddingNew] = useState(false)
  const addNewRow = async () => {
    if (!broker || !newProp) return
    const address = newProp.address.trim()
    if (!address) return toast.error('소재지를 적어 주세요')
    // 두 번 눌러도 한 건만
    if (addingRef.current) return
    addingRef.current = true
    setAddingNew(true)
    const { data, error } = await supabase.from('broker_properties').insert({
      broker_id: broker.id,
      deal_type: newProp.deal_type,
      room_type: '',
      address,
      price: 0,
      // 고객 줄처럼 접수일자는 오늘, 담당자는 등록한 사람 — 빈칸으로 남아 네 사람이 헷갈려 했다
      received_date: todayKST(),
      ...(selfName ? { assignee: selfName } : {}),
      status: 'available',
      options: [],
      images: [],
    }).select().single()
    addingRef.current = false
    setAddingNew(false)
    if (error || !data) {
      toast.error(`등록하지 못했습니다: ${error?.message ?? '알 수 없는 오류'}. 로그인이 풀렸다면 다시 로그인해 주세요.`)
      return
    }
    setNewProp(null)
    if (loading) addedWhileLoadingRef.current.push(data)
    toast.success('등록했어요 — 면적·층·유형은 건축물대장에서 채우는 중, 가격 등 나머지 칸은 표에서 채우면 저장돼요')
    // 새 행을 현재 페이지에 즉시 표시 (스크롤 effect가 페이지 이동을 처리)
    setProperties(prev => [data, ...prev])
    setTotalCount(c => c + 1)
    setAllCount(c => c == null ? c : c + 1)
    setAddingId(data.id)
    setPage(1)
    setTimeout(() => setAddingId(null), 2000)
    // 등록하면 자동채움(건축물대장 면적·층·유형·좌표)도 바로 — 버튼을 따로 눌러야 해서 면적 빈 매물이 쌓였다(11-01)
    void autoFillRow(data.id, address)
    // 등록 창은 중복 경고를 안 거쳐 같은 매물이 담당 둘로 들어갔다(11-02) — 표에서 주소 고칠 때와 같은 경고
    if (officeIdRef.current) void findDuplicateProperty(supabase, officeIdRef.current, address, newProp.deal_type, data.id).then(dup => {
      if (dup) toast.info(`⚠️ 같은 매물이 이미 있어요: ${dup.address} · ${dup.deal_type}${dup.assignee ? ` · 담당 ${dup.assignee}` : ''}`)
    })
  }

  const deleteProperty = useCallback((id: string) => {
    setDeleteConfirm({ type: 'property', id })
  }, [setDeleteConfirm])

  const deletingRef = useRef(false)
  const confirmDelete = async () => {
    if (!deleteConfirm) return
    if (deletingRef.current) return
    deletingRef.current = true
    try { await confirmDeleteOnce() } finally { deletingRef.current = false }
  }
  const confirmDeleteOnce = async () => {
    if (!deleteConfirm) return
    if (deleteConfirm.type === 'property') {
      // 휴지통 이동(soft delete) — SECURITY DEFINER RPC (본인·대표만 가능)
      const { error } = await supabase.rpc('soft_delete_property', { prop_id: deleteConfirm.id })
      if (error) {
        console.error('[deleteProperty] failed', error)
        toast.error(/unauthorized|not found/i.test(error.message)
          ? '이미 휴지통에 있거나 내가 지울 수 없는 매물이에요. 목록을 새로고침해 주세요.'
          : `휴지통으로 옮기지 못했어요: ${error.message}`)
        setDeleteConfirm(null)
        return
      }
      setProperties(prev => prev.filter(p => p.id !== deleteConfirm.id))
      setTotalCount(c => Math.max(0, c - 1))
      setAllCount(c => c == null ? c : Math.max(0, c - 1))
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

  const copyingRef = useRef(false)
  const duplicateProperty = useCallback(async (prop: Property) => {
    if (!broker) return
    // 두 번 눌러도 한 줄만 복사한다(고객목록·매물 등록과 같게)
    if (copyingRef.current) return
    copyingRef.current = true
    setTimeout(() => { copyingRef.current = false }, 1500)
    const { id: _id, created_at: _created_at, seq_no: _seq_no, ...rest } = prop
    const { data, error } = await supabase.from('broker_properties').insert({ ...rest, broker_id: broker.id }).select().single()
    if (error || !data) return
    setProperties(prev => [data, ...prev])
    setTotalCount(c => c + 1)
    setAllCount(c => c == null ? c : c + 1)
    setAddingId(data.id)
    setPage(1)
    setTimeout(() => setAddingId(null), 2000)
  }, [broker])

  // 필터·검색은 search_office_properties RPC가 서버에서 처리 (동일한 부분 문자열 매칭).
  // 지도 뷰는 mapRows(필터 반영 전체), 시트는 properties(현재 페이지)를 쓴다.


  // 지도 패널 → 목록으로 이동. mapRows는 목록과 같은 정렬·필터의 전체 집합이므로
  // 행 순번으로 페이지를 계산할 수 있다.
  const jumpToList = (id: string) => {
    const idx = mapRows.findIndex(r => r.id === id)
    if (idx >= 0) setPage(Math.floor(idx / pageSize) + 1)
    setIsMapView(false)
    setJumpId(id)
  }
  useEffect(() => {
    if (!jumpId || isMapView || loading) return
    const row = document.querySelector(`tr[data-row-id="${jumpId}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const t = setTimeout(() => setJumpId(null), 2500)
    return () => clearTimeout(t)
  }, [jumpId, isMapView, loading, properties])


  // 정렬·방향·페이지 슬라이스는 전부 서버(RPC)가 처리 — properties가 곧 현재 페이지다.
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const paginated = properties

  // 홈 [바로 하기 → 매물 등록] 은 ?new=1 로 들어와 등록 창을 바로 연다 (한 번만)
  const newOpenedRef = useRef(false)
  useEffect(() => {
    if (newOpenedRef.current || !broker || isAdminView || searchParams.get('new') !== '1') return
    newOpenedRef.current = true
    setNewProp({ address: '', deal_type: '' })
    // 주소에서 new=1 을 지운다 — 남아 있으면 새로고침할 때마다 등록 창이 다시 뜬다
    const u = new URL(window.location.href); u.searchParams.delete('new')
    window.history.replaceState(window.history.state, '', u.pathname + (u.search ? u.search : ''))
  }, [broker, isAdminView, searchParams])

  // 알림·광고관리에서 ?focus=ID 로 진입 시 해당 매물 강조 (한 번만 처리)
  //
  // **강조만 한다 — 셀을 누르지 않는다.** 예전에는 새 행 추가와 같은 길(addingId)을 타서
  // 첫 칸을 눌렀는데, 첫 칸이 매물상태 토글이라 들어오기만 해도 가능↔완료가 뒤집혔다.
  // 광고관리의 '계약완료 매물인데 광고중' 칩을 따라오면 계약완료가 가능으로 풀리는 셈이다.
  //
  // 목록은 서버에서 쪽 단위로 받아, 지금 쪽에 없는 매물은 강조할 행이 없었다.
  // 그럴 때는 그 매물을 검색해 데려온다. **매물번호 하나로는 안 된다** — 검색은 줄 전체(가격·주소·
  // 메모)에서 글자를 찾아, '262' 는 스물한 건이 걸리고 #262 는 둘째 쪽에 있었다. 검색 글은
  // `매물번호 주소` 로 시작하고 띄어쓰기를 무시하므로(search_office_properties) `번호 주소` 로 치면
  // 그 매물 하나만 걸린다. 그래도 안 오면(상태·거래유형·담당자 필터에 가려짐, 또는 지워짐) 결과가
  // 온 뒤 한 번 알린다 — 조용히 넘기면 검색창만 제멋대로 바뀌고 엉뚱한 목록이 뜬 것으로 보인다.
  const focusedRef = useRef<string | null>(null)
  // 걸어 둔 검색. q 는 검색창에 넣은 글(아직이면 null), 알림은 "못 찾았다" 를 이미 말했는가.
  const focusSearchedRef = useRef<{ id: string; q: string | null; 번호: string; 알림: boolean } | null>(null)
  useEffect(() => {
    const focus = searchParams.get('focus')
    if (!focus || loading) return
    if (focusedRef.current === focus) return
    if (properties.some(p => p.id === focus)) {
      focusedRef.current = focus
      setJumpId(focus)
      return
    }
    const 찾는중 = focusSearchedRef.current
    if (찾는중?.id === focus) {
      // 검색을 걸어 뒀다. **그 검색의 결과가 온 뒤에도** 없을 때만 알린다 — loading 만 보면 검색어가
      // 바뀐 렌더에서 옛 결과를 보고 없다고 말한다. 어느 검색어의 결과인지는 fetchedQueryRef 가 안다.
      if (찾는중.q !== null && !찾는중.알림 && fetchedQueryRef.current === 찾는중.q) {
        찾는중.알림 = true
        toast.info(`매물 ${찾는중.번호} 이(가) 목록에 안 보여요 — 상태·거래유형·담당자 필터에 가려졌을 수 있어요.`)
      }
      return
    }
    const 기록 = { id: focus, q: null as string | null, 번호: '', 알림: false }
    focusSearchedRef.current = 기록
    const 그때검색 = searchQuery
    // uuid 가 아니면 조회하지 않는다(400 + 영어 오류가 콘솔에 남았다). 숫자면 사무소 매물번호로 본다.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(focus)
    if (!isUuid && !/^\d{1,7}$/.test(focus)) { 기록.알림 = true; return }
    void (isUuid
      ? supabase.from('broker_properties').select('seq_no, address').eq('id', focus).is('deleted_at', null).maybeSingle()
      : supabase.from('broker_properties').select('seq_no, address').eq('office_broker_id', officeIdRef.current).eq('seq_no', Number(focus)).is('deleted_at', null).limit(1).maybeSingle())
      .then(({ data, error }) => {
        if (error) { console.error('[properties] 강조할 매물을 못 찾았습니다', error.message); return }
        const seq = data?.seq_no as number | null | undefined
        if (seq == null) {
          // 휴지통에 갔거나 없는 매물 — 검색을 걸어 봐야 안 나온다. 바로 말한다.
          기록.알림 = true
          toast.info('강조할 매물을 찾지 못했어요 — 휴지통에 있거나 지워진 매물일 수 있어요.')
          return
        }
        const 검색어 = [String(seq), (data?.address as string | null | undefined)?.trim()].filter(Boolean).join(' ')
        // 그사이 검색창을 고쳤으면 덮지 않는다 — 친 것이 사라지면 화면이 제멋대로 바뀐 것처럼 보인다.
        setSearchQuery(prev => {
          if (prev !== 그때검색) return prev
          기록.q = 검색어
          기록.번호 = `#${seq}`
          return 검색어
        })
      })
  }, [searchParams, loading, properties, supabase, searchQuery, toast])

  // 새 행 추가 시: 페이지 이동 + 스크롤(행은 isAdding 으로 강조).
  // 예전엔 소재지 칸을 눌러 편집 상태로 열었는데, 이제 소재지는 등록 창에서 이미 받는다. 다 적힌 주소가
  // 좁은 입력칸에 끝쪽부터 보여 '천안시'가 잘린 채 '서북구 불당동 123'만 보였다(10-29 점검, 3명).
  useEffect(() => {
    if (!addingId) return
    // 새 행은 등록순 최신 — up(최신부터)이면 1페이지, down(오래된 것부터)이면 마지막 페이지
    const targetPage = direction === 'up' ? 1 : Math.max(1, Math.ceil(totalCount / pageSize))
    setPage(targetPage)
    const t = setTimeout(() => {
      const row = document.querySelector(`tr[data-row-id="${addingId}"]`) as HTMLElement | null
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    return () => clearTimeout(t)
  }, [addingId, direction, totalCount, pageSize])

  // 새 매물 — 소재지부터 받는다. 목록을 다 받기 전에도 띄운다 — 홈 [매물 등록] 을 누르면 폰 3G 에서
  // 목록(10초 남짓)을 다 받을 때까지 창이 안 떴다(10-30 재점검)
  useEscape(!!newProp, () => setNewProp(null))
  const newPropModal = newProp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setNewProp(null)}>
          <form onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); void addNewRow() }}
            className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900">
            <h3 className="mb-1 text-lg font-bold text-gray-900 dark:text-white">새 매물 등록</h3>
            <p className="mb-4 text-sm text-gray-500">소재지만 적으면 등록돼요. 가격·면적 같은 나머지 칸은 등록한 뒤 표에서 바로 채우면 저절로 저장돼요.</p>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300" htmlFor="new-prop-address">소재지</label>
            <input id="new-prop-address" autoFocus maxLength={200} value={newProp.address}
              onChange={e => setNewProp(v => v && { ...v, address: e.target.value })}
              placeholder="예: 천안시 서북구 불당동 123"
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-950 dark:text-white" />
            <p className="mb-1 mt-4 text-sm font-medium text-gray-700 dark:text-gray-300">거래형태 <span className="text-xs font-normal text-gray-400">(나중에 골라도 돼요)</span></p>
            <div className="flex flex-wrap gap-2">
              {['월세', '매매', '전세'].map(d => (
                <button key={d} type="button" onClick={() => setNewProp(v => v && { ...v, deal_type: v.deal_type === d ? '' : d })}
                  className={cn('rounded-lg border px-3 py-1.5 text-sm font-medium',
                    newProp.deal_type === d ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800')}>
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <button type="button" onClick={() => setNewProp(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-gray-800">취소</button>
              <button type="submit" disabled={!newProp.address.trim() || addingNew}
                className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">{addingNew ? '등록 중…' : '등록'}</button>
            </div>
          </form>
        </div>
      )

  if (loading) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 dark:bg-gray-950" role="status">
      <Spinner size="lg" />
      <p className="text-sm text-gray-500">매물목록을 불러오는 중이에요…</p>
      <p className="text-xs text-gray-400">휴대폰 데이터가 느리면 20초쯤 걸릴 수 있어요.</p>
      {newPropModal}
    </div>
  )

  if (accessDenied) return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <div className="text-5xl">🔒</div>
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-300">매물목록 접근 권한이 없어요</h2>
        <p className="text-sm text-gray-500">대표에게 권한 설정을 요청해주세요.</p>
      </div>
    </div>
  )

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
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

      {/* 고르기 중엔 아래 막대가 마지막 줄·쪽 넘김을 가리지 않게 여백 */}
      <div className={`px-4 py-6 ${pickMode ? 'pb-32' : ''}`}>
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
              className="flex items-center gap-1.5 rounded-lg border border-orange-300 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-50 transition-colors flex-shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              어드민으로
            </button>
          </div>
        )}

        {/* 뱅크 임시저장을 눌렀는데 PC 의 일꾼이 꺼져 있다 — 돌아가는 표시만 보고 기다리지 않게 */}
        {bankWorkerOffline && (
          <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-900/40 dark:bg-yellow-900/20 dark:text-yellow-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">뱅크 임시저장 일꾼이 꺼져 있습니다 — 요청이 대기 중입니다.</p>
              <p className="mt-0.5 text-xs">사무소 PC 에서 부소장광고 폴더의 <b>&ldquo;뱅크 임시저장 일꾼.bat&rdquo;</b>을 켜면 바로 처리합니다. PC 를 켜면 저절로 켜지도록 되어 있으니, 꺼져 있으면 PC 가 꺼졌거나 프로그램 창이 닫힌 것입니다.</p>
            </div>
          </div>
        )}

        {/* 상단 — 휴대폰에선 제목 줄과 버튼 줄이 나뉜다(한 줄에 넣으면 '보고/서' 로 쪼개지고 '지도' 가 잘렸다) */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{isAdminView ? `${adminViewBrokerName}의 매물목록` : '매물목록'}</h1>
            <p className="mt-0.5 text-sm text-gray-500">전체 {allCount ?? '…'}건 · 검색 {totalCount}건</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* 첫 화면에서 바로 보이는 등록 버튼 — 표 맨 아래에만 있어 2천 건을 내려야 찾았다(2026-10-25 점검) */}
            {!isAdminView && canEdit && (
              <button onClick={() => setNewProp({ address: '', deal_type: '' })}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-xl bg-blue-600 px-2.5 sm:px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                <Plus className="h-4 w-4" />매물 등록
              </button>
            )}
            {/* 목록/지도 토글 */}
            <div className="flex rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <button
                onClick={() => setIsMapView(false)}
                className={`flex items-center gap-1.5 whitespace-nowrap px-2.5 sm:px-3.5 py-2.5 text-sm font-medium transition-colors ${!isMapView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}
              >
                <List className="h-4 w-4" />목록
              </button>
              <button
                onClick={() => setIsMapView(true)}
                className={`flex items-center gap-1.5 whitespace-nowrap px-2.5 sm:px-3.5 py-2.5 text-sm font-medium transition-colors ${isMapView ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}
              >
                <Map className="h-4 w-4" />지도
              </button>
            </div>
            {/* 손님 미팅용 매물 묶음 — 줄의 [담기] 로 모은다(11-06) */}
            {!isAdminView && listOfficeId && broker?.id && (
              <button onClick={() => setShowLists(true)}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-gray-200 bg-white px-2.5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:px-3.5 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">
                <ListChecks className="h-4 w-4" />리스트
              </button>
            )}
            {!isAdminView && listOfficeId && broker?.id && !isMapView && (
              <button onClick={() => pickMode ? endPick() : setPickMode(true)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 py-2.5 text-sm font-medium sm:px-3.5 ${pickMode
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
                <CheckCircle2 className="h-4 w-4" />{pickMode ? '고르기 끝' : '고르기'}
              </button>
            )}
          </div>
        </div>

        {/* 검색 + 필터 */}
        <div className="mb-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input type="text" placeholder="전체 검색..." aria-label="매물 전체 검색" value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-2.5 pl-9 pr-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            {searchQuery && <SearchClear onClick={() => setSearchQuery('')} />}
          </div>
          <button
            onClick={() => setShowFilter(v => !v)}
            className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition-colors ${activeFilterCount > 0 ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950'}`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            필터{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </button>
        </div>

        {/* 필터 패널 */}
        {showFilter && (
          <div className="mb-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3 shadow-sm">
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-500">매물상태</p>
              <div className="flex flex-wrap gap-1.5">
                {([['available', '가능'], ['contracted', '완료']] as const).map(([v, label]) => (
                  <button key={v} onClick={() => setFilterStatus(filterStatus === v ? '' : v)}
                    className={chipClass(filterStatus === v, 'xs')}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-500">거래형태</p>
              <div className="flex flex-wrap gap-1.5">
                {DEAL_TYPES.map(t => (
                  <button key={t} onClick={() => setFilterDealType(filterDealType === t ? '' : t)}
                    className={chipClass(filterDealType === t, 'xs')}
                  >{t}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-500">중개대상물종류 (다중 선택)</p>
              <div className="space-y-2">
                {PROPERTY_CATEGORIES.map(cat => {
                  const allSelected = cat.types.every(t => filterRoomTypes.includes(t))
                  const someSelected = cat.types.some(t => filterRoomTypes.includes(t))
                  return (
                    <div key={cat.label}>
                      <div className="mb-1 flex items-center gap-2">
                        <button onClick={() => toggleRoomGroup(cat.types)}
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold transition-colors ${
                            allSelected ? 'bg-blue-600 text-white' :
                            someSelected ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-500 hover:bg-gray-200'
                          }`}>
                          {cat.label} {allSelected ? '전체 해제' : '전체 선택'}
                        </button>
                        {someSelected && <span className="text-[10px] text-gray-500">{cat.types.filter(t => filterRoomTypes.includes(t)).length}/{cat.types.length}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {cat.types.map(t => (
                          <button key={t} onClick={() => toggleRoomType(t)}
                            className={chipClass(filterRoomTypes.includes(t), 'xs')}
                          >{t}</button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-500">업종 (다중 선택)</p>
              <div className="flex flex-wrap gap-1.5">
                {industryOpts.map(t => (
                  <button key={t} onClick={() => toggleIndustry(t)}
                    className={chipClass(filterIndustries.includes(t), 'xs')}
                  >{t}</button>
                ))}
              </div>
            </div>
            {teamMembers.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold text-gray-500">담당자 (다중 선택)</p>
                <div className="flex flex-wrap gap-1.5">
                  {teamMembers.map(name => (
                    <button key={name} onClick={() => toggleAssignee(name)}
                      className={chipClass(filterAssignees.includes(name), 'xs')}
                    >{name}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-xs font-semibold text-gray-500">범위 조건</p>
              <div className="space-y-2">
                {([
                  ['보증금·매매가', '만원', filterPriceMin, setFilterPriceMin, filterPriceMax, setFilterPriceMax],
                  ['월세', '만원', filterRentMin, setFilterRentMin, filterRentMax, setFilterRentMax],
                  ['평수', '평', filterPyeongMin, setFilterPyeongMin, filterPyeongMax, setFilterPyeongMax],
                  ['층수', '층', filterFloorMin, setFilterFloorMin, filterFloorMax, setFilterFloorMax],
                ] as [string, string, string, (v: string) => void, string, (v: string) => void][]).map(([label, unit, min, setMin, max, setMax]) => {
                  // 숫자만 받는다 — 'abc' 가 말없이 무시되고, 최소가 최대보다 커도 0건만 나왔다(11-06 점검)
                  const only = (v: string) => v.replace(/[^0-9.,]/g, '')
                  const lo = parseFloat(min.replace(/,/g, '')), hi = parseFloat(max.replace(/,/g, ''))
                  const swapped = !isNaN(lo) && !isNaN(hi) && lo > hi
                  return (
                  <div key={label}>
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-gray-600 sm:w-24 dark:text-gray-400">{label}</span>
                    <input type="text" inputMode="decimal" value={min} onChange={e => setMin(only(e.target.value))} placeholder={`최소 (${unit})`}
                      className="min-w-0 flex-1 sm:w-28 sm:flex-none rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                    <span className="text-xs text-gray-400">~</span>
                    <input type="text" inputMode="decimal" value={max} onChange={e => setMax(only(e.target.value))} placeholder={`최대 (${unit})`}
                      className="min-w-0 flex-1 sm:w-28 sm:flex-none rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  </div>
                  {swapped && <p className="mt-1 pl-[88px] text-[11px] text-red-500 sm:pl-[104px]">최소가 최대보다 커요 — 두 칸을 바꿔 적어 주세요</p>}
                  </div>
                  )
                })}
              </div>
            </div>
            {/* 폰에선 필터 판이 화면 두 장이라 결과가 판 아래에 묻혀 안 보였다(11-06 점검) — 닫고 결과 보기 */}
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setShowFilter(false)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                결과 {totalCount}건 보기
              </button>
              {activeFilterCount > 0 && (
                <button onClick={resetFilters}
                  className="text-xs text-red-500 hover:text-red-600 font-medium">
                  필터 초기화
                </button>
              )}
            </div>
          </div>
        )}

        {/* 지도 뷰 — 코드는 지도를 열 때 받는다 */}
        {isMapView && (
          <PropertiesMapView
            mapRows={mapRows}
            mapLoading={mapLoading}
            officeAddress={officeAddress}
            supabase={supabase}
            geocodeCacheRef={geocodeCacheRef}
            savedCoordIdsRef={savedCoordIdsRef}
            onOpenImages={images => setLightbox({ images, index: 0 })}
            onJumpToList={jumpToList}
          />
        )}

        {/* 테이블 */}
        <div ref={tableScrollRef} className={`overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm ${isMapView ? 'hidden' : ''}`}>
          <table className="border-collapse table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
            <thead>
              <tr className="border-b-2 border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 text-xs font-semibold text-gray-500 uppercase tracking-wide select-none">
                <th className="px-2 py-2.5 text-center border-r border-gray-100 dark:border-gray-800" style={{ width: 56, maxWidth: 56 }} title="매물번호 (사무소 내 고정)">
                  번호
                </th>
                {syncedOrder.map(key => {
                  // 고정 칼럼
                  const fixedCol = ALL_COLUMNS.find(c => c.key === key)
                  if (fixedCol) {
                    if (!settings.visible.includes(key)) return null
                    const w = settings.widths[key] ?? 100
                    return (
                      <th key={key}
                        className={`px-2 py-2.5 text-left relative cursor-grab transition-colors border-r border-gray-100 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 ${dragOverCol === key ? 'bg-blue-50' : ''}`}
                        style={{ width: w, maxWidth: w }}
                        draggable onDragStart={e => onColDragStart(key, e)}
                        onDragOver={e => onColDragOver(key, e)} onDrop={() => onColDrop(key)}
                        onDragEnd={onColDragEnd}
                      >
                        <div className="pr-2 flex items-center gap-1 overflow-hidden">
                          {(() => {
                            const TOGGLE_COLS: Record<string, 'text' | 'select'> = { room_type: 'select', deal_type: 'select', industry: 'select', direction: 'text', brief_memo: 'text', memo: 'text' }
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
                                options={key === 'industry' ? industryOpts : (settings.options[key] ?? [])}
                                onSetOptions={isAssignee || (key === 'industry' && !isOwner) ? undefined : opts => setOpts(key, opts)}
                                isMulti={key === 'industry' || settings.multi[key]}
                                onChangeMulti={showMulti && key !== 'industry' ? m => setMulti(key, m) : undefined}
                                onHide={() => hideCol(key)}
                                areaUnit={isAreaCol ? (settings.areaUnit ?? '평') : undefined}
                                onChangeAreaUnit={isAreaCol ? u => update(prev => ({ ...prev, areaUnit: u })) : undefined}
                                sortDir={sortKey === key ? sortDir : null}
                                onSort={key === 'images' ? undefined : () => toggleSort(key)}
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
                        className={`px-2 py-2.5 text-left relative cursor-grab transition-colors border-r border-gray-100 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 ${dragOverCol === key ? 'bg-blue-50' : ''}`}
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
                  <SheetActionHeader width={110}>
                    <AddColBtn onAdd={addCustomColumn} />
                    <ColVisibility
                      cols={[...ALL_COLUMNS.map(c => ({ key: c.key, label: c.label })), ...customColumns.map(c => ({ key: c.id, label: c.name }))]}
                      visible={settings.visible}
                      onToggle={key => settings.visible.includes(key) ? hideCol(key) : showCol(key)}
                    />
                  </SheetActionHeader>
                )}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <EmptyRow
                  colSpan={syncedOrder.length + 2}
                  message={searchQuery || activeFilterCount > 0 ? '검색 결과가 없어요' : '아직 등록된 매물이 없어요'}
                />
              ) : paginated.map((p) => (
                <PropertyRow
                  key={p.id}
                  p={p}
                  onView={setViewProp}
                  onLocation={setLocationOf}
                  onAddToList={isAdminView ? undefined : addOneToList}
                  onPick={pickMode ? togglePick : undefined}
                  picked={pickMode && !!picked[p.id]}
                  adBadge={adBadges[p.id]}
                  syncedOrder={syncedOrder}
                  customColumns={customColumns}
                  settings={settings}
                  isAdminView={isAdminView}
                  canEdit={canEdit}
                  isOwner={canManageOffice(broker)}
                  brokerSelfId={broker?.id ?? null}
                  isAdding={p.id === addingId || p.id === jumpId}
                  isAutoFilling={autoFillingId === p.id}
                  teamMembers={teamMembers}
                  industryOpts={industryOpts}
                  ownerName={ownerName}
                  saveField={saveField}
                  autoFillRow={autoFillRow}
                  saveCustomField={saveCustomField}
                  setLightbox={setLightbox}
                  onDelete={deleteProperty}
                  onCopy={duplicateProperty}
                  onStatusChange={(row, next) => setStatusConfirm({ p: row, next })}
                  bankDraft={bankDrafts[p.id]}
                  onBankDraft={openBankDraft}
                />
              ))}
              {!isAdminView && canEdit && (
                <tr>
                  <td colSpan={syncedOrder.filter(k => settings.visible.includes(k)).length + 2} className="border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-center divide-x divide-gray-100">
                      <button onClick={() => setNewProp({ address: '', deal_type: '' })}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:text-gray-600 dark:text-gray-500 hover:bg-gray-50/80 transition-colors">
                        <Plus className="h-3.5 w-3.5" />매물 등록
                      </button>
                      <button onClick={() => updateDirection(direction === 'up' ? 'down' : 'up')}
                        title={direction === 'up' ? '새 행이 위로 쌓임 (클릭하면 아래로)' : '새 행이 아래로 쌓임 (클릭하면 위로)'}
                        className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50/50 transition-colors">
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

        <Pagination
          page={page}
          totalPages={totalPages}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizes={PAGE_SIZE_OPTIONS}
          hidden={isMapView}
        />
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

      {/* 뱅크 임시저장 확인 모달 — 못 넣는 이유(problems)가 있으면 넣기 버튼이 없다 */}
      {bankDraftConfirm && (() => {
        const { p, plan, addressFrom } = bankDraftConfirm
        const 어디 = [p.seq_no != null ? `#${p.seq_no}` : null, p.address || '소재지 없음'].filter(Boolean).join(' ')
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                {plan.ok ? '뱅크에 임시 저장할까요?' : '아직 뱅크에 넣을 수 없어요'}
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 break-all">{어디}</p>
              {addressFrom != null && (
                <p className="mb-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300 break-all">
                  도로명 주소라 지번으로 바꿔 넣습니다. 요청하면 소재지도 위처럼 고쳐 둡니다(원래: {addressFrom}).
                </p>
              )}
              {plan.ok && bankDrafts[p.id]?.status === 'done' && (
                <p className="mb-3 rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2 text-xs text-green-800 dark:text-green-300">
                  이미 {ymdKST(bankDrafts[p.id].finished_at ?? bankDrafts[p.id].requested_at)}에 뱅크에 임시 저장했어요{bankDrafts[p.id].result?.bankNo ? ` (임시매물 ${bankDrafts[p.id].result?.bankNo})` : ''}. 다시 요청하면 뱅크 임시 저장목록에 하나 더 생깁니다.
                </p>
              )}
              {plan.ok ? (
                <div className="text-sm text-gray-500 mb-4 space-y-2">
                  <p>PC 프로그램이 뱅크 등록 화면을 채우고 <b>[임시 저장]</b>까지만 누릅니다. 돈이 나가는 <b>[등록]</b>은 뱅크 &lsquo;임시 저장목록&rsquo;에서 직접 누르세요(7일 보관).</p>
                  <p>뱅크 종류 <b>{plan.form.kind.label}</b> · {plan.form.address.gu} {plan.form.address.dong}{plan.form.address.ri ? ` ${plan.form.address.ri}` : ''} {plan.form.address.jibun1}{plan.form.address.jibun2 ? `-${plan.form.address.jibun2}` : ''} · 사진 {plan.form.images.length}장{plan.form.images.length ? ' 그대로 올림' : ''}</p>
                  <p className="text-xs">면적·사용승인일·주차·총층은 뱅크의 <b>건축물대장 조회</b>로 채웁니다. 중개사 메모(비공개)는 그대로 넣고 맨 위에 담당자를 적습니다.</p>
                  {plan.fromRegister.length > 0 && (
                    <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2 text-xs text-blue-800 dark:text-blue-300">
                      <p className="font-semibold mb-1">매물에 비어 있어 건축물대장에서 가져오는 칸</p>
                      <p>{plan.fromRegister.join(' · ')} — 대장에서 호실을 못 찾으면 뱅크에서 직접 적어야 합니다.</p>
                    </div>
                  )}
                  {plan.warnings.length > 0 && (
                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 text-xs text-yellow-800 dark:text-yellow-300">
                      <p className="font-semibold mb-1">뱅크에서 직접 채워야 하는 칸 (대장에도 없는 것)</p>
                      <ul className="list-disc pl-4 space-y-0.5">{plan.warnings.map(w => <li key={w}>{w}</li>)}</ul>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <ul className="mb-4 list-disc pl-5 text-sm text-red-600 dark:text-red-400 space-y-1">
                    {plan.problems.map(w => <li key={w}>{w}</li>)}
                  </ul>
                  {/* 주택으로 들어온 가게 호실 — 여기서 바로 상가로 바꾸고 이어서 넣는다(매물목록까지 갔다 오지 않게) */}
                  {plan.problems.some(w => w.includes('1종(상가)·2종(상가)로 바꾸면')) && (
                    <div className="mb-4 flex gap-2">
                      {(['1종(상가)', '2종(상가)'] as const).map(t => (
                        <button key={t} type="button"
                          onClick={() => {
                            saveField(p.id, 'room_type', t)
                            const next = { ...p, room_type: t }
                            setBankDraftConfirm({ p: next, plan: planBankDraft(next), addressFrom })
                          }}
                          className="flex-1 rounded-xl border border-blue-200 bg-blue-50 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-900/20 dark:text-blue-300">
                          {t}로 바꾸기
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-3">
                <button type="button" onClick={() => setBankDraftConfirm(null)}
                  className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">{plan.ok ? '취소' : '닫기'}</button>
                {plan.ok && (
                  <button type="button" disabled={bankDraftSaving} onClick={() => requestBankDraft(p, addressFrom)}
                    className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                    {bankDraftSaving ? '넣는 중…' : '임시 저장 요청'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* 매물상태 확인 모달 — 삭제 확인과 같은 모양 */}
      {statusConfirm && typeof document !== 'undefined' && (() => {
        const { p, next } = statusConfirm
        const 완료로 = next === 'contracted'
        const 광고 = adBadges[p.id]
        const 어디 = [p.seq_no != null ? `#${p.seq_no}` : null, p.address || '소재지 없음'].filter(Boolean).join(' ')
        // body 로 직접 그린다 — 폰에서 표 스크롤 칸 안쪽 레이아웃의 영향을 받아 확인창이 안 보이던 것을 막는다
        return createPortal(
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 backdrop-blur-sm" role="dialog" aria-modal="true"
            style={vvBox ? { left: vvBox.l, top: vvBox.t, width: vvBox.w, height: vvBox.h } : undefined}>
            <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                {완료로 ? '이 매물을 계약완료로 바꿀까요?' : '이 매물을 다시 가능으로 되돌릴까요?'}
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2 break-all">{어디}</p>
              <p className="text-sm text-gray-500 mb-6">
                {완료로
                  ? (광고
                    ? `광고가 아직 살아 있습니다(${광고.어디}). 바꾼 뒤 광고관리에서 내려 주세요 — 매물번호 밑 배지가 빨갛게 바뀝니다.`
                    : '목록·지도에서 회색으로 보이고, 고객 화면에서는 빠집니다.')
                  : '다시 거래 가능한 매물로 보입니다. 광고는 저절로 올라가지 않습니다.'}
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setStatusConfirm(null)}
                  className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
                <button type="button" onClick={() => { saveField(p.id, 'status', next); setStatusConfirm(null) }}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white ${완료로 ? 'bg-gray-700 hover:bg-gray-800' : 'bg-green-600 hover:bg-green-700'}`}>
                  변경
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      })()}

      {/* 고르기 중 아래 막대 — 폰은 하단 메뉴 위에 띄운다 */}
      {pickMode && (
        <div className="fixed inset-x-0 z-40 flex justify-center px-4 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] md:bottom-6">
          <div className="flex w-full max-w-md items-center gap-2 rounded-2xl bg-gray-900 p-2 pl-4 text-white shadow-xl dark:bg-gray-800">
            <span className="flex-1 text-sm font-semibold">{pickedList.length ? `${pickedList.length}개 골랐어요` : '번호 칸을 눌러 고르세요'}</span>
            {pickedList.length > 0 && (
              <button type="button" onClick={() => setPicked({})} className="rounded-xl px-3 py-2 text-sm text-gray-300 hover:bg-white/10">해제</button>
            )}
            <button type="button" disabled={!pickedList.length} onClick={() => setListFor(pickedList)}
              className="rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-40">리스트에 담기</button>
          </div>
        </div>
      )}
      {listFor && listOfficeId && broker?.id && (
        <AddToListSheet officeId={listOfficeId} selfId={broker.id} canManage={canManageOffice(broker)}
          properties={listFor.map(p => ({ id: p.id, seq_no: p.seq_no ?? null, address: p.address }))}
          onDone={pickMode ? endPick : undefined}
          onClose={() => setListFor(null)} />
      )}
      {showLists && listOfficeId && broker?.id && (
        <PropertyListsSheet officeId={listOfficeId} selfId={broker.id} canManage={canManageOffice(broker)}
          onClose={() => setShowLists(false)}
          canSeeMemo={p => canManageOffice(broker) || p.broker_id === broker.id
            || (!!ownerName && (p.assignee ?? '').split(',').map(s => s.trim()).includes(ownerName))} />
      )}
      {viewProp && <PropertyViewSheet p={viewProp.p} memoVisible={viewProp.memoVisible} onClose={() => setViewProp(null)}
        onAddToList={!isAdminView && listOfficeId ? () => { setListFor([viewProp.p]); setViewProp(null) } : undefined}
        onLocation={viewProp.p.address?.trim() ? () => { setLocationOf({ address: viewProp.p.address, roomType: viewProp.p.room_type }); setViewProp(null) } : undefined} />}
      {locationOf && <LocationCardSheet address={locationOf.address} roomType={locationOf.roomType} onClose={() => setLocationOf(null)} />}

      {newPropModal}

      {/* 삭제 확인 모달 */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
              {deleteConfirm.type === 'property' ? '이 매물을 휴지통으로 옮길까요?' : `'${deleteConfirm.label}' 칼럼을 삭제할까요?`}
            </h3>
            {deleteTarget && (
              <p className="text-sm text-gray-700 dark:text-gray-300 mb-2 break-all">
                {[deleteTarget.seq_no != null ? `#${deleteTarget.seq_no}` : null, deleteTarget.address || '소재지 없음'].filter(Boolean).join(' ')}
              </p>
            )}
            <p className="text-sm text-gray-500 mb-6">
              {deleteConfirm.type === 'column' ? '해당 칼럼의 모든 데이터가 삭제됩니다.' : (isOwner ? '휴지통에서 30일 안에 되살릴 수 있어요. 30일이 지나면 저절로 지워집니다.' : '30일 안에는 대표가 휴지통에서 되살릴 수 있어요. 30일이 지나면 저절로 지워집니다.')}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">취소</button>
              <button onClick={confirmDelete}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600">{deleteConfirm.type === 'property' ? '휴지통으로' : '삭제'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
