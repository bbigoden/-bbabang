'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { formatPrice } from '@/lib/utils'
import {
  Plus, Trash2, Search, ChevronLeft, ChevronRight, ImagePlus, X,
} from 'lucide-react'
import Link from 'next/link'
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
  status: 'available' | 'contracted' | 'hidden'
  created_at: string
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
const DEAL_FILTERS = ['전체', '매매', '전세', '월세'] as const
type DealFilter = typeof DEAL_FILTERS[number]
const PAGE_SIZE = 50

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
      className={`cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] ${value ? 'text-gray-800' : 'text-gray-300'} ${className}`}
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
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(v => !v)}
        className={`cursor-pointer rounded px-2 py-0.5 text-xs font-semibold inline-flex items-center gap-1 hover:opacity-80 ${colorMap?.[value] ?? 'bg-gray-100 text-gray-600'}`}
      >
        {value}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[120px] rounded-xl border border-gray-200 bg-white shadow-lg py-1">
          {options.map(opt => (
            <button key={opt} onClick={() => { onSave(opt); setOpen(false) }}
              className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 font-medium ${opt === value ? 'text-blue-600' : 'text-gray-700'}`}
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
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)

  useEffect(() => { init() }, [])
  useEffect(() => { setPage(1) }, [statusFilter, dealFilter, searchQuery])

  const init = async () => {
    let u: any = null
    try { const { data } = await supabase.auth.getUser(); u = data.user } catch { router.push('/auth/login'); return }
    if (!u) { router.push('/auth/login'); return }
    setUser(u)
    const { data: b } = await supabase.from('broker_profiles').select('id').eq('user_id', u.id).single()
    if (!b) { router.push('/broker/register'); return }
    setBroker(b)
    const { data } = await supabase.from('broker_properties').select('*').eq('broker_id', b.id).order('created_at', { ascending: false })
    setProperties(data ?? [])
    setLoading(false)
  }

  // 단일 필드 저장
  const saveField = useCallback(async (id: string, field: string, value: any) => {
    await supabase.from('broker_properties').update({ [field]: value }).eq('id', id)
    setProperties(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }, [supabase])

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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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

      <div className="mx-auto max-w-[1400px] px-4 py-6">
        {/* 상단 */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">내 매물장</h1>
            <p className="mt-0.5 text-sm text-gray-500">전체 {properties.length}건 · 검색 {filtered.length}건</p>
          </div>
          <Link href="/broker/properties/new"
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />매물 등록
          </Link>
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
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-gray-100 bg-gray-50 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                <th className="w-8 px-3 py-3 text-center">#</th>
                <th className="px-2 py-3 text-left w-24">상태</th>
                <th className="px-2 py-3 text-left w-20">담당자</th>
                <th className="px-2 py-3 text-left w-16">거래</th>
                <th className="px-2 py-3 text-left w-20">유형</th>
                <th className="px-2 py-3 text-left min-w-[200px]">주소</th>
                <th className="px-2 py-3 text-right w-28">매매/전세/보증금</th>
                <th className="px-2 py-3 text-right w-20">월세</th>
                <th className="px-2 py-3 text-right w-20">관리비</th>
                <th className="px-2 py-3 text-right w-20">권리금</th>
                <th className="px-2 py-3 text-left min-w-[140px]">간단메모</th>
                <th className="px-2 py-3 text-center w-16">사진</th>
                <th className="px-2 py-3 text-center w-12">삭제</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-20 text-center text-sm text-gray-400">
                    {searchQuery || dealFilter !== '전체' ? '검색 결과가 없습니다' : '등록된 매물이 없습니다'}
                  </td>
                </tr>
              ) : paginated.map((p, idx) => (
                <tr key={p.id}
                  className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${p.status === 'hidden' ? 'opacity-50' : ''}`}
                >
                  {/* # */}
                  <td className="px-3 py-1.5 text-center text-xs text-gray-300 select-none">
                    {(page - 1) * PAGE_SIZE + idx + 1}
                  </td>
                  {/* 상태 */}
                  <td className="px-2 py-1.5">
                    <SelectCell
                      value={STATUS_LABEL[p.status]}
                      options={STATUS_OPTS.map(s => STATUS_LABEL[s])}
                      onSave={v => {
                        const key = Object.entries(STATUS_LABEL).find(([, label]) => label === v)?.[0] as Property['status']
                        if (key) saveField(p.id, 'status', key)
                      }}
                      colorMap={Object.fromEntries(STATUS_OPTS.map(s => [STATUS_LABEL[s], STATUS_COLOR[s]]))}
                    />
                  </td>
                  {/* 담당자 */}
                  <td className="px-2 py-1.5">
                    <TextCell value={p.assignee} onSave={v => saveField(p.id, 'assignee', v || null)} placeholder="담당자" />
                  </td>
                  {/* 거래유형 */}
                  <td className="px-2 py-1.5">
                    <SelectCell
                      value={p.deal_type}
                      options={DEAL_TYPES}
                      onSave={v => saveField(p.id, 'deal_type', v)}
                      colorMap={{ 매매: 'bg-blue-100 text-blue-700', 전세: 'bg-purple-100 text-purple-700', 월세: 'bg-orange-100 text-orange-700' }}
                    />
                  </td>
                  {/* 매물유형 */}
                  <td className="px-2 py-1.5">
                    <SelectCell value={p.room_type} options={ROOM_TYPES} onSave={v => saveField(p.id, 'room_type', v)} />
                  </td>
                  {/* 주소 */}
                  <td className="px-2 py-1.5 max-w-[240px]">
                    <TextCell value={p.address} onSave={v => saveField(p.id, 'address', v)} placeholder="주소 입력" />
                  </td>
                  {/* 가격 */}
                  <td className="px-2 py-1.5">
                    <NumberCell value={p.price} onSave={v => saveField(p.id, 'price', v ?? 0)} />
                  </td>
                  {/* 월세 */}
                  <td className="px-2 py-1.5">
                    <NumberCell value={p.monthly_rent} onSave={v => saveField(p.id, 'monthly_rent', v)} />
                  </td>
                  {/* 관리비 */}
                  <td className="px-2 py-1.5">
                    <NumberCell value={p.management_fee} onSave={v => saveField(p.id, 'management_fee', v)} />
                  </td>
                  {/* 권리금 */}
                  <td className="px-2 py-1.5">
                    <NumberCell value={p.premium} onSave={v => saveField(p.id, 'premium', v)} />
                  </td>
                  {/* 간단메모 */}
                  <td className="px-2 py-1.5">
                    <TextCell value={p.brief_memo} onSave={v => saveField(p.id, 'brief_memo', v || null)} placeholder="메모" />
                  </td>
                  {/* 사진 */}
                  <td className="px-2 py-1.5">
                    <ImageCell
                      images={p.images ?? []}
                      onSave={imgs => saveField(p.id, 'images', imgs)}
                      onView={i => setLightbox({ images: p.images, index: i })}
                    />
                  </td>
                  {/* 삭제 */}
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => deleteProperty(p.id)}
                      className="text-gray-300 hover:text-red-400 transition-colors"
                      title="삭제"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="mt-5 flex items-center justify-center gap-2">
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
            <span className="ml-2 text-sm text-gray-400">{page} / {totalPages} (50개씩)</span>
          </div>
        )}
      </div>
    </div>
  )
}
