'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { formatPrice } from '@/lib/utils'
import {
  Plus, Trash2, Search, ChevronLeft, ChevronRight, ImagePlus, X, Settings2, Lock, Pencil, Check, HelpCircle,
} from 'lucide-react'
import { ImageLightbox } from '@/components/image-lightbox'

interface Property {
  id: string
  deal_type: string
  room_type: string
  address: string
  price: number
  monthly_rent: number | null
  management_fee: number | null
  premium: number | null
  size_pyeong: number | null
  floor: number | null
  total_floors: number | null
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
const OPTIONS_LIST = ['풀옵션', '에어컨', '세탁기', '냉장고', '전자레인지', '인터넷', '주차 가능', '엘리베이터', '반려동물 허용', 'CCTV', '도시가스', '관리비 포함']
const DIRECTION_OPTS = ['남향', '북향', '동향', '서향', '남동향', '남서향', '북동향', '북서향']
const PARKING_OPTS = ['주차가능', '주차불가', '협의']
const DEAL_FILTERS = ['전체', '매매', '전세', '월세'] as const
type DealFilter = typeof DEAL_FILTERS[number]
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

// 고정 칼럼만 (지울 수 없음, 숨길 수는 있음)
const ALL_COLUMNS = [
  { key: 'address',         label: '소재지' },
  { key: 'size_pyeong',     label: '면적' },
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
  { key: 'brief_memo',      label: '메모' },
  { key: 'memo',            label: '중개사메모' },
] as const
type ColKey = typeof ALL_COLUMNS[number]['key']
const FIXED_COLS: ColKey[] = ALL_COLUMNS.map(c => c.key)
const DEFAULT_VISIBLE: ColKey[] = [...FIXED_COLS]

// 초기 커스텀 칼럼 (새 중개사용 기본값)
const DEFAULT_CUSTOM_COLS: CustomColumn[] = [
  { id: 'assignee', name: '담당자' },
]

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

// ── 인라인 텍스트 셀 ──────────────────────────────────────────
function TextCell({ value, onSave, placeholder = '—', className = '' }: {
  value: string | null, onSave: (v: string) => void, placeholder?: string, className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) } }}
        className={`w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300 ${className}`}
      />
    )
  }
  return (
    <div onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      className={`cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] truncate ${value ? 'text-gray-800' : 'text-gray-300'} ${className}`}
      title={value ?? ''}
    >
      {value || placeholder}
    </div>
  )
}

// ── 인라인 숫자 셀 ──────────────────────────────────────────
function NumberCell({ value, onSave, suffix = '만' }: {
  value: number | null, onSave: (v: number | null) => void, suffix?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    const num = draft.trim() === '' ? null : Number(draft)
    if (num !== value) onSave(isNaN(num as number) ? null : num)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value != null ? String(value) : ''); setEditing(false) } }}
        className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs text-right outline-none focus:ring-2 focus:ring-blue-300"
      />
    )
  }
  return (
    <div onClick={() => { setDraft(value != null ? String(value) : ''); setEditing(true) }}
      className={`cursor-pointer rounded px-1 py-0.5 text-xs text-right hover:bg-blue-50 min-h-[22px] ${value ? 'text-gray-800 font-semibold' : 'text-gray-300'}`}
    >
      {value != null ? `${value.toLocaleString()}${suffix}` : '—'}
    </div>
  )
}

// ── 팝오버 선택 셀 ──────────────────────────────────────────
function SelectCell({ value, options, onSave, colorMap }: {
  value: string, options: string[], onSave: (v: string) => void, colorMap?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      // 아래 공간이 200px 미만이면 위로 열기
      setOpenUp(window.innerHeight - rect.bottom < 200)
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
        <div className={`absolute left-0 z-50 rounded-xl border border-gray-200 bg-white shadow-lg py-1 ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'} ${options.length > 5 ? 'grid grid-cols-2 min-w-[200px]' : 'flex flex-col min-w-[120px]'}`}>
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

// ── 사진 셀 ──────────────────────────────────────────
function ImageCell({ images, onSave, onView }: {
  images: string[], onSave: (imgs: string[]) => void, onView: (idx: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [newPreviews, setNewPreviews] = useState<string[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [localImgs, setLocalImgs] = useState<string[]>(images)
  const ref = useRef<HTMLDivElement>(null)
  const supabase = createClient()

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

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(v => !v)} className="cursor-pointer flex gap-1 items-center hover:bg-blue-50 rounded px-1 py-0.5 min-h-[22px]">
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
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-gray-200 bg-white shadow-lg p-3">
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

// ── 중개사메모 툴팁 아이콘 ──────────────────────────────────────────
function MemoTooltipIcon() {
  const [show, setShow] = useState(false)
  return (
    <span
      className="relative inline-flex flex-shrink-0"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <HelpCircle className="h-3.5 w-3.5 text-gray-400 cursor-help" />
      {show && (
        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded-lg bg-gray-800 px-2.5 py-1.5 text-[11px] leading-tight text-white shadow-xl z-[500]">
          매물제안시 나에게만 보이는 메모입니다
        </span>
      )}
    </span>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────
export default function BrokerPropertiesPage() {
  const router = useRouter()
  const supabase = createClient()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'contracted' | 'hidden'>('all')
  const [dealFilter, setDealFilter] = useState<DealFilter>('전체')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(() => {
    try { const s = localStorage.getItem('broker_col_visible'); if (s) { const p = JSON.parse(s) as ColKey[]; return p.filter(k => ALL_COLUMNS.some(c => c.key === k)) } } catch {}
    return DEFAULT_VISIBLE
  })
  // 통합 칼럼 순서 (고정 칼럼 + 커스텀 칼럼, status 제외)
  const [colOrder, setColOrder] = useState<string[]>(() => {
    const defaultOrder = [...FIXED_COLS]
    try {
      const s = localStorage.getItem('broker_col_full_order')
      if (s) {
        const p = (JSON.parse(s) as string[]).filter(k => k !== 'status') // 기존 저장값에서 status 제거
        if (p.includes('address')) {
          const missing = defaultOrder.filter(k => !p.includes(k))
          return missing.length > 0 ? [...p, ...missing] : p
        }
      }
    } catch {}
    return defaultOrder
  })
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const def: Record<string, number> = {
      address: 200,
      size_pyeong: 70, price: 96, room_type: 110, deal_type: 72,
      total_floors: 70, move_in_date: 90, rooms_bathrooms: 80,
      approval_date: 90, parking: 72, management_fee: 72,
      direction: 68, images: 56, brief_memo: 140, memo: 140,
    }
    try { const s = localStorage.getItem('broker_col_widths'); if (s) return { ...def, ...JSON.parse(s) } } catch {}
    return def
  })
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>([])
  const [visibleCustomCols, setVisibleCustomCols] = useState<string[]>(() => {
    try { const s = localStorage.getItem('broker_visible_custom'); if (s) return JSON.parse(s) } catch {}
    return ['assignee']
  })
  const [editingColId, setEditingColId] = useState<string | null>(null)
  const [editingColName, setEditingColName] = useState('')
  const [newColName, setNewColName] = useState('')
  const [addingCol, setAddingCol] = useState(false)
  const [dragCol, setDragCol] = useState<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [colMenuOpen, setColMenuOpen] = useState(false)
  const colMenuRef = useRef<HTMLDivElement>(null)
  useClickOutside(colMenuRef, () => { setColMenuOpen(false); setAddingCol(false); setEditingColId(null) })

  const toggleCol = (key: ColKey) =>
    setVisibleCols(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  const show = (key: ColKey) => visibleCols.includes(key)
  const showCustom = (id: string) => visibleCustomCols.includes(id)
  const toggleCustomCol = (id: string) =>
    setVisibleCustomCols(prev => prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id])

  // localStorage 저장
  useEffect(() => { try { localStorage.setItem('broker_col_visible', JSON.stringify(visibleCols)) } catch {} }, [visibleCols])
  useEffect(() => { try { localStorage.setItem('broker_col_widths', JSON.stringify(colWidths)) } catch {} }, [colWidths])
  useEffect(() => { try { localStorage.setItem('broker_visible_custom', JSON.stringify(visibleCustomCols)) } catch {} }, [visibleCustomCols])
  useEffect(() => { try { localStorage.setItem('broker_col_full_order', JSON.stringify(colOrder)) } catch {} }, [colOrder])

  // 칼럼 너비 드래그 조절
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[key] ?? 100
    const onMove = (ev: MouseEvent) => setColWidths(prev => ({ ...prev, [key]: Math.max(40, startW + ev.clientX - startX) }))
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // 칼럼 순서 드래그 (colOrder 기준 통합)
  const onColDragStart = (key: string, e: React.DragEvent) => { setDragCol(key); e.dataTransfer.effectAllowed = 'move' }
  const onColDragOver = (key: string, e: React.DragEvent) => { e.preventDefault(); setDragOverCol(key) }
  const onColDrop = (key: string) => {
    if (!dragCol || dragCol === key) return
    setColOrder(prev => {
      const arr = [...prev]; const fi = arr.indexOf(dragCol); const ti = arr.indexOf(key)
      if (fi < 0 || ti < 0) return arr; arr.splice(fi, 1); arr.splice(ti, 0, dragCol); return arr
    })
    setDragCol(null); setDragOverCol(null)
  }

  useEffect(() => { init() }, [])
  useEffect(() => { setPage(1) }, [statusFilter, dealFilter, searchQuery, pageSize])

  const init = async () => {
    let u: any = null
    try { const { data } = await supabase.auth.getUser(); u = data.user } catch { router.push('/auth/login'); return }
    if (!u) { router.push('/auth/login'); return }
    setUser(u)
    const { data: b } = await supabase.from('broker_profiles').select('id, custom_columns').eq('user_id', u.id).single()
    if (!b) { router.push('/broker/register'); return }
    setBroker(b)
    // 커스텀 칼럼 로드 (없으면 기본값)
    const cols: CustomColumn[] = b.custom_columns?.length > 0 ? b.custom_columns : DEFAULT_CUSTOM_COLS
    setCustomColumns(cols)
    const { data } = await supabase.from('broker_properties').select('*').eq('broker_id', b.id).order('created_at', { ascending: false })
    setProperties(data ?? [])
    setLoading(false)
  }

  // 단일 필드 저장
  const saveField = useCallback(async (id: string, field: string, value: any) => {
    await supabase.from('broker_properties').update({ [field]: value }).eq('id', id)
    setProperties(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }, [supabase])

  // 커스텀 필드 값 저장
  const saveCustomField = useCallback(async (propertyId: string, colId: string, value: string) => {
    const prop = properties.find(p => p.id === propertyId)
    const updated = { ...(prop?.custom_fields ?? {}), [colId]: value }
    await supabase.from('broker_properties').update({ custom_fields: updated }).eq('id', propertyId)
    setProperties(prev => prev.map(p => p.id === propertyId ? { ...p, custom_fields: updated } : p))
  }, [supabase, properties])

  // 커스텀 칼럼 추가
  const addCustomColumn = async (name: string) => {
    if (!name.trim() || !broker) return
    const newCol: CustomColumn = { id: `col_${Date.now()}`, name: name.trim() }
    const updated = [...customColumns, newCol]
    await supabase.from('broker_profiles').update({ custom_columns: updated }).eq('id', broker.id)
    setCustomColumns(updated)
    setVisibleCustomCols(prev => [...prev, newCol.id])
    setColOrder(prev => [...prev, newCol.id])
    setNewColName('')
    setAddingCol(false)
  }

  // 커스텀 칼럼 이름 수정
  const renameCustomColumn = async (id: string, name: string) => {
    if (!name.trim() || !broker) return
    const updated = customColumns.map(c => c.id === id ? { ...c, name: name.trim() } : c)
    await supabase.from('broker_profiles').update({ custom_columns: updated }).eq('id', broker.id)
    setCustomColumns(updated)
    setEditingColId(null)
  }

  // 커스텀 칼럼 삭제
  const deleteCustomColumn = async (id: string) => {
    if (!broker) return
    const updated = customColumns.filter(c => c.id !== id)
    await supabase.from('broker_profiles').update({ custom_columns: updated }).eq('id', broker.id)
    setCustomColumns(updated)
    setVisibleCustomCols(prev => prev.filter(k => k !== id))
    setColOrder(prev => prev.filter(k => k !== id))
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

  const deleteProperty = async (id: string) => {
    if (!confirm('삭제하시겠어요?')) return
    await supabase.from('broker_properties').delete().eq('id', id)
    setProperties(prev => prev.filter(p => p.id !== id))
  }

  const filtered = useMemo(() => {
    let list = properties
    if (statusFilter !== 'all') list = list.filter(p => p.status === statusFilter)
    if (dealFilter !== '전체') list = list.filter(p => p.deal_type === dealFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(p =>
        p.address.toLowerCase().includes(q) ||
        (p.assignee ?? '').toLowerCase().includes(q) ||
        p.room_type.toLowerCase().includes(q) ||
        (p.brief_memo ?? '').toLowerCase().includes(q)
      )
    }
    return list
  }, [properties, statusFilter, dealFilter, searchQuery])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
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
        {/* 상단 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">내 매물장</h1>
            <p className="mt-0.5 text-sm text-gray-500">전체 {properties.length}건 · 검색 {filtered.length}건</p>
          </div>
          <div className="flex items-center gap-2">
            {/* 컬럼 설정 */}
            <div ref={colMenuRef} className="relative">
              <button onClick={() => setColMenuOpen(v => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Settings2 className="h-4 w-4" />컬럼
              </button>
              {colMenuOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-gray-200 bg-white shadow-lg py-2">
                  {/* 고정 칼럼 */}
                  <p className="px-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide flex items-center gap-1"><Lock className="h-3 w-3" /> 고정 칼럼</p>
                  {ALL_COLUMNS.map(col => (
                    <button key={col.key} onClick={() => toggleCol(col.key)}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded border-2 transition-all ${visibleCols.includes(col.key) ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                        {visibleCols.includes(col.key) && <span className="text-[9px] font-black text-white">✓</span>}
                      </span>
                      <span className="flex-1 text-left">{col.label}</span>
                      <Lock className="h-3 w-3 text-gray-300" />
                    </button>
                  ))}
                  {/* 사용자 정의 칼럼 */}
                  <div className="my-1.5 border-t border-gray-100" />
                  <p className="px-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide">내 칼럼</p>
                  {customColumns.map(col => (
                    <div key={col.id} className="flex items-center gap-1 px-2 py-1 hover:bg-gray-50 group">
                      <button onClick={() => toggleCustomCol(col.id)}
                        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 transition-all ${visibleCustomCols.includes(col.id) ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                        {visibleCustomCols.includes(col.id) && <span className="text-[9px] font-black text-white">✓</span>}
                      </button>
                      {editingColId === col.id ? (
                        <input autoFocus value={editingColName} onChange={e => setEditingColName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') renameCustomColumn(col.id, editingColName); if (e.key === 'Escape') setEditingColId(null) }}
                          onBlur={() => renameCustomColumn(col.id, editingColName)}
                          className="flex-1 rounded border border-blue-400 px-1.5 py-0.5 text-xs outline-none" />
                      ) : (
                        <span className="flex-1 px-1 text-sm text-gray-700 truncate">{col.name}</span>
                      )}
                      <button onClick={() => { setEditingColId(col.id); setEditingColName(col.name) }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-blue-500 transition-all">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => deleteCustomColumn(col.id)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-500 transition-all">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {/* 칼럼 추가 */}
                  {addingCol ? (
                    <div className="flex items-center gap-1 px-2 py-1">
                      <input autoFocus value={newColName} onChange={e => setNewColName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addCustomColumn(newColName); if (e.key === 'Escape') { setAddingCol(false); setNewColName('') } }}
                        placeholder="칼럼 이름 입력"
                        className="flex-1 rounded border border-blue-400 px-1.5 py-0.5 text-xs outline-none placeholder-gray-300" />
                      <button onClick={() => addCustomColumn(newColName)} className="p-0.5 text-blue-500 hover:text-blue-700">
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => setAddingCol(true)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 transition-colors">
                      <Plus className="h-3.5 w-3.5" /> 칼럼 추가
                    </button>
                  )}
                </div>
              )}
            </div>
            <button onClick={addNewRow}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />매물 등록
            </button>
          </div>
        </div>

        {/* 통계 탭 */}
        <div className="mb-4 flex gap-2">
          {[
            { key: 'all' as const, label: '전체', count: properties.length },
            { key: 'available' as const, label: '매물있음', count: properties.filter(p => p.status === 'available').length },
            { key: 'contracted' as const, label: '계약완료', count: properties.filter(p => p.status === 'contracted').length },
            { key: 'hidden' as const, label: '숨김', count: properties.filter(p => p.status === 'hidden').length },
          ].map(s => (
            <button key={s.key} onClick={() => setStatusFilter(s.key)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all border ${statusFilter === s.key ? 'bg-white border-blue-500 text-blue-600 shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
            >
              {s.label} <span className="ml-1 text-xs font-bold">{s.count}</span>
            </button>
          ))}
        </div>

        {/* 검색 + 거래유형 */}
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="주소, 담당자, 메모 검색..." value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
            {DEAL_FILTERS.map(f => (
              <button key={f} onClick={() => setDealFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${dealFilter === f ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >{f}</button>
            ))}
          </div>
        </div>

        {/* 테이블 */}
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="border-collapse table-fixed" style={{ width: 'max-content', minWidth: '100%' }}>
            <thead>
              <tr className="border-b-2 border-gray-100 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wide select-none">
                <th className="px-2 py-2.5 text-center" style={{ width: 32 }}>#</th>
                {colOrder.map(key => {
                  // 고정 칼럼
                  const fixedCol = ALL_COLUMNS.find(c => c.key === key)
                  if (fixedCol) {
                    if (!visibleCols.includes(key as ColKey)) return null
                    return (
                      <th key={key}
                        className={`px-2 py-2.5 text-left relative cursor-grab transition-colors ${dragOverCol === key ? 'bg-blue-50' : ''}`}
                        style={{ width: colWidths[key] ?? 100, maxWidth: colWidths[key] ?? 100 }}
                        draggable onDragStart={e => onColDragStart(key, e)}
                        onDragOver={e => onColDragOver(key, e)} onDrop={() => onColDrop(key)}
                        onDragEnd={() => { setDragCol(null); setDragOverCol(null) }}
                      >
                        {key === 'memo' ? (
                          <span className="flex items-center gap-1 pr-2">
                            <span className="truncate">{fixedCol.label}</span>
                            <MemoTooltipIcon />
                          </span>
                        ) : (
                          <span className="truncate block pr-2">{fixedCol.label}</span>
                        )}
                        <div onMouseDown={e => startResize(key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-300 opacity-0 hover:opacity-100" />
                      </th>
                    )
                  }
                  // 커스텀 칼럼
                  const customCol = customColumns.find(c => c.id === key)
                  if (customCol && showCustom(key)) return (
                    <th key={key}
                      className={`px-2 py-2.5 text-left relative cursor-grab transition-colors ${dragOverCol === key ? 'bg-blue-50' : ''}`}
                      style={{ width: colWidths[key] ?? 120, maxWidth: colWidths[key] ?? 120 }}
                      draggable onDragStart={e => onColDragStart(key, e)}
                      onDragOver={e => onColDragOver(key, e)} onDrop={() => onColDrop(key)}
                      onDragEnd={() => { setDragCol(null); setDragOverCol(null) }}
                    >
                      <span className="truncate block pr-2">{customCol.name}</span>
                      <div onMouseDown={e => startResize(key, e)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-300 opacity-0 hover:opacity-100" />
                    </th>
                  )
                  return null
                })}
                <th className="px-2 py-2.5 text-center" style={{ width: 36 }}>삭제</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={colOrder.length + 2} className="py-20 text-center text-sm text-gray-400">
                    {searchQuery || dealFilter !== '전체' ? '검색 결과가 없습니다' : '등록된 매물이 없습니다'}
                  </td>
                </tr>
              ) : paginated.map((p, idx) => (
                <tr key={p.id}
                  className={`border-b transition-colors ${p.id === addingId ? 'border-blue-300 bg-blue-50/40' : 'border-gray-50 hover:bg-gray-50/60'} ${p.status === 'hidden' ? 'opacity-50' : ''}`}
                >
                  <td className="px-2 py-1.5 text-center text-xs text-gray-300 select-none">
                    {(page - 1) * pageSize + idx + 1}
                  </td>
                  {colOrder.map(key => {
                    const fixedCol = ALL_COLUMNS.find(c => c.key === key)
                    if (fixedCol) {
                      if (!visibleCols.includes(key as ColKey)) return null
                      return (
                        <td key={key} className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths[key] ?? 100, maxWidth: colWidths[key] ?? 100 }}>
                          {key === 'address'         && <TextCell value={p.address} onSave={v => saveField(p.id, 'address', v)} placeholder="소재지 입력" />}
                          {key === 'size_pyeong'     && <NumberCell value={p.size_pyeong} onSave={v => saveField(p.id, 'size_pyeong', v)} suffix="평" />}
                          {key === 'price'           && <NumberCell value={p.price} onSave={v => saveField(p.id, 'price', v ?? 0)} />}
                          {key === 'room_type'       && <SelectCell value={p.room_type} options={ROOM_TYPES} onSave={v => saveField(p.id, 'room_type', v)} />}
                          {key === 'deal_type'       && <SelectCell value={p.deal_type} options={DEAL_TYPES} onSave={v => saveField(p.id, 'deal_type', v)} colorMap={{ 매매: 'bg-blue-100 text-blue-700', 전세: 'bg-purple-100 text-purple-700', 월세: 'bg-orange-100 text-orange-700' }} />}
                          {key === 'total_floors'    && <NumberCell value={p.total_floors} onSave={v => saveField(p.id, 'total_floors', v)} suffix="층" />}
                          {key === 'move_in_date'    && <TextCell value={p.move_in_date} onSave={v => saveField(p.id, 'move_in_date', v || null)} placeholder="입주가능일" />}
                          {key === 'rooms_bathrooms' && <TextCell value={p.rooms_bathrooms} onSave={v => saveField(p.id, 'rooms_bathrooms', v || null)} placeholder="예: 2/1" />}
                          {key === 'approval_date'   && <TextCell value={p.approval_date} onSave={v => saveField(p.id, 'approval_date', v || null)} placeholder="사용승인일" />}
                          {key === 'parking'         && <SelectCell value={p.parking ?? ''} options={PARKING_OPTS} onSave={v => saveField(p.id, 'parking', v)} />}
                          {key === 'management_fee'  && <NumberCell value={p.management_fee} onSave={v => saveField(p.id, 'management_fee', v)} />}
                          {key === 'direction'       && <SelectCell value={p.direction ?? ''} options={DIRECTION_OPTS} onSave={v => saveField(p.id, 'direction', v)} />}
                          {key === 'images'          && <ImageCell images={p.images ?? []} onSave={imgs => saveField(p.id, 'images', imgs)} onView={i => setLightbox({ images: p.images, index: i })} />}
                          {key === 'brief_memo'      && <TextCell value={p.brief_memo} onSave={v => saveField(p.id, 'brief_memo', v || null)} placeholder="메모" />}
                          {key === 'memo'            && <TextCell value={p.memo} onSave={v => saveField(p.id, 'memo', v || null)} placeholder="중개사 메모" />}
                        </td>
                      )
                    }
                    const customCol = customColumns.find(c => c.id === key)
                    if (customCol && showCustom(key)) return (
                      <td key={key} className="px-2 py-1.5 overflow-hidden" style={{ width: colWidths[key] ?? 120, maxWidth: colWidths[key] ?? 120 }}>
                        <TextCell value={(p.custom_fields ?? {})[key] ?? null} onSave={v => saveCustomField(p.id, key, v)} placeholder={customCol.name} />
                      </td>
                    )
                    return null
                  })}
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => deleteProperty(p.id)} className="text-gray-300 hover:text-red-400 transition-colors" title="삭제">
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        <div className="mt-5 flex items-center justify-center gap-2 flex-wrap">
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
    </div>
  )
}
