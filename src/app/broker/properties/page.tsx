'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { formatPrice } from '@/lib/utils'
import {
  Plus, Trash2, Pencil, Search, Copy, EyeOff,
  ToggleLeft, ToggleRight, Link as LinkIcon, Check,
  LayoutGrid, Table2, ChevronLeft, ChevronRight,
  StickyNote, Building2,
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

const STATUS_LABEL = { available: '매물 있음', contracted: '계약 완료', hidden: '숨김' }
const STATUS_BADGE = { available: 'success', contracted: 'default', hidden: 'warning' } as const
const STATUS_COLOR = { available: 'bg-green-500', contracted: 'bg-gray-300', hidden: 'bg-yellow-400' }
const DEAL_FILTERS = ['전체', '매매', '전세', '월세'] as const
type DealFilter = typeof DEAL_FILTERS[number]
type SortKey = 'newest' | 'oldest' | 'price_asc' | 'price_desc'
type ViewMode = 'table' | 'card'

const PAGE_SIZE = 50

export default function BrokerPropertiesPage() {
  const router = useRouter()
  const supabase = createClient()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('table')

  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'contracted' | 'hidden'>('all')
  const [dealFilter, setDealFilter] = useState<DealFilter>('전체')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchField, setSearchField] = useState<'all' | 'address' | 'assignee' | 'room_type'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('newest')
  const [page, setPage] = useState(1)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ images: string[]; index: number } | null>(null)

  useEffect(() => { init() }, [])

  const init = async () => {
    let u: any = null
    try {
      const { data } = await supabase.auth.getUser()
      u = data.user
    } catch { router.push('/auth/login'); return }
    if (!u) { router.push('/auth/login'); return }
    setUser(u)

    const { data: b } = await supabase.from('broker_profiles').select('id').eq('user_id', u.id).single()
    if (!b) { router.push('/broker/register'); return }
    setBroker(b)

    const { data } = await supabase
      .from('broker_properties')
      .select('*')
      .eq('broker_id', b.id)
      .order('created_at', { ascending: false })

    setProperties(data ?? [])
    setLoading(false)
  }

  const cycleStatus = async (property: Property) => {
    const next: Property['status'] =
      property.status === 'available' ? 'contracted'
      : property.status === 'contracted' ? 'hidden'
      : 'available'
    await supabase.from('broker_properties').update({ status: next }).eq('id', property.id)
    setProperties(prev => prev.map(p => p.id === property.id ? { ...p, status: next } : p))
  }

  const deleteProperty = async (id: string) => {
    if (!confirm('이 매물을 삭제하시겠어요?')) return
    await supabase.from('broker_properties').delete().eq('id', id)
    setProperties(prev => prev.filter(p => p.id !== id))
  }

  const duplicateProperty = async (property: Property) => {
    if (!broker) return
    const { id, created_at, ...rest } = property
    const { data } = await supabase.from('broker_properties')
      .insert({ ...rest, broker_id: broker.id, status: 'available' }).select().single()
    if (data) setProperties(prev => [data, ...prev])
  }

  const copyInfo = (property: Property) => {
    navigator.clipboard.writeText(
      `[${property.deal_type}] ${property.room_type} · ${property.address} · ${formatPropertyPrice(property)}`
    )
    setCopiedId(property.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const formatPropertyPrice = (p: Property) => {
    if (p.deal_type === '월세') return `${formatPrice(p.price)}/${formatPrice(p.monthly_rent ?? 0)}`
    return formatPrice(p.price)
  }

  // 필터 + 검색 + 정렬
  const filtered = useMemo(() => {
    let list = properties
    if (statusFilter !== 'all') list = list.filter(p => p.status === statusFilter)
    if (dealFilter !== '전체') list = list.filter(p => p.deal_type === dealFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter(p => {
        if (searchField === 'address') return p.address.toLowerCase().includes(q)
        if (searchField === 'assignee') return (p.assignee ?? '').toLowerCase().includes(q)
        if (searchField === 'room_type') return p.room_type.toLowerCase().includes(q)
        return (
          p.address.toLowerCase().includes(q) ||
          (p.assignee ?? '').toLowerCase().includes(q) ||
          p.room_type.toLowerCase().includes(q) ||
          (p.brief_memo ?? '').toLowerCase().includes(q) ||
          (p.description ?? '').toLowerCase().includes(q)
        )
      })
    }
    switch (sortKey) {
      case 'newest': list = [...list].sort((a, b) => b.created_at.localeCompare(a.created_at)); break
      case 'oldest': list = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at)); break
      case 'price_asc': list = [...list].sort((a, b) => a.price - b.price); break
      case 'price_desc': list = [...list].sort((a, b) => b.price - a.price); break
    }
    return list
  }, [properties, statusFilter, dealFilter, searchQuery, searchField, sortKey])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // 필터 바뀌면 1페이지로
  useEffect(() => { setPage(1) }, [statusFilter, dealFilter, searchQuery, sortKey])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />

      {lightbox && (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onNext={() => setLightbox(lb => lb && lb.index < lb.images.length - 1 ? { ...lb, index: lb.index + 1 } : lb)}
          onPrev={() => setLightbox(lb => lb && lb.index > 0 ? { ...lb, index: lb.index - 1 } : lb)}
          onGoTo={(i) => setLightbox(lb => lb ? { ...lb, index: i } : lb)}
        />
      )}

      <div className="mx-auto max-w-[1400px] px-4 py-6">
        {/* 헤더 */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">내 매물장</h1>
            <p className="mt-0.5 text-sm text-gray-500">전체 {properties.length}건 · 검색결과 {filtered.length}건</p>
          </div>
          <div className="flex items-center gap-2">
            {/* 뷰 토글 */}
            <div className="flex rounded-xl border border-gray-200 bg-white p-1">
              <button
                onClick={() => setViewMode('table')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${viewMode === 'table' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Table2 className="h-3.5 w-3.5" />목록
              </button>
              <button
                onClick={() => setViewMode('card')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${viewMode === 'card' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />카드
              </button>
            </div>
            <Link href="/broker/properties/new" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              <Plus className="h-4 w-4" />매물 등록
            </Link>
          </div>
        </div>

        {/* 통계 */}
        <div className="mb-4 grid grid-cols-4 gap-3">
          {[
            { label: '전체', value: properties.length, key: 'all' as const, color: 'text-gray-600 bg-gray-100' },
            { label: '매물 있음', value: properties.filter(p => p.status === 'available').length, key: 'available' as const, color: 'text-green-600 bg-green-50' },
            { label: '계약 완료', value: properties.filter(p => p.status === 'contracted').length, key: 'contracted' as const, color: 'text-blue-600 bg-blue-50' },
            { label: '숨김', value: properties.filter(p => p.status === 'hidden').length, key: 'hidden' as const, color: 'text-yellow-600 bg-yellow-50' },
          ].map(stat => (
            <button key={stat.key} onClick={() => setStatusFilter(stat.key)}
              className={`rounded-xl p-3 text-left transition-all border-2 bg-white ${statusFilter === stat.key ? 'border-blue-500 shadow-sm' : 'border-transparent'}`}
            >
              <div className={`mb-1 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${stat.color}`}>{stat.label}</div>
              <div className="text-2xl font-black text-gray-900">{stat.value}</div>
            </button>
          ))}
        </div>

        {/* 검색 + 필터 */}
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="flex flex-1 min-w-64 overflow-hidden rounded-xl border border-gray-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
            <select value={searchField} onChange={e => setSearchField(e.target.value as any)}
              className="border-r border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-medium text-gray-600 focus:outline-none"
            >
              <option value="all">전체</option>
              <option value="address">주소</option>
              <option value="assignee">담당자</option>
              <option value="room_type">매물유형</option>
            </select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="검색어 입력..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-transparent py-2.5 pl-9 pr-4 text-sm focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
            {DEAL_FILTERS.map(f => (
              <button key={f} onClick={() => setDealFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${dealFilter === f ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >{f}</button>
            ))}
          </div>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 focus:border-blue-500 focus:outline-none"
          >
            <option value="newest">최신순</option>
            <option value="oldest">오래된순</option>
            <option value="price_desc">가격 높은순</option>
            <option value="price_asc">가격 낮은순</option>
          </select>
        </div>

        {/* ===== 테이블 뷰 ===== */}
        {viewMode === 'table' && (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500">
                  <th className="px-3 py-3 text-center w-10">No.</th>
                  <th className="px-3 py-3 text-left">상태</th>
                  <th className="px-3 py-3 text-left">담당자</th>
                  <th className="px-3 py-3 text-left">거래</th>
                  <th className="px-3 py-3 text-left">유형</th>
                  <th className="px-3 py-3 text-left min-w-[180px]">주소</th>
                  <th className="px-3 py-3 text-right">매매/전세/보증금</th>
                  <th className="px-3 py-3 text-right">월세</th>
                  <th className="px-3 py-3 text-right">관리비</th>
                  <th className="px-3 py-3 text-right">권리금</th>
                  <th className="px-3 py-3 text-left min-w-[120px]">간단메모</th>
                  <th className="px-3 py-3 text-center">사진</th>
                  <th className="px-3 py-3 text-center">액션</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="py-16 text-center text-sm text-gray-400">
                      {searchQuery || dealFilter !== '전체' ? '검색 결과가 없습니다' : '등록된 매물이 없습니다'}
                    </td>
                  </tr>
                ) : paginated.map((property, idx) => (
                  <tr key={property.id} className={`hover:bg-blue-50/30 transition-colors ${property.status === 'hidden' ? 'opacity-50' : ''}`}>
                    {/* No. */}
                    <td className="px-3 py-2.5 text-center text-xs text-gray-400">
                      {(page - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    {/* 상태 */}
                    <td className="px-3 py-2.5">
                      <button onClick={() => cycleStatus(property)} title="클릭하면 상태 변경">
                        <Badge variant={STATUS_BADGE[property.status]} className="whitespace-nowrap text-xs cursor-pointer">
                          {STATUS_LABEL[property.status]}
                        </Badge>
                      </button>
                    </td>
                    {/* 담당자 */}
                    <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                      {property.assignee ?? <span className="text-gray-300">—</span>}
                    </td>
                    {/* 거래유형 */}
                    <td className="px-3 py-2.5">
                      <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                        {property.deal_type}
                      </span>
                    </td>
                    {/* 매물유형 */}
                    <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{property.room_type}</td>
                    {/* 주소 */}
                    <td className="px-3 py-2.5 text-xs text-gray-800 max-w-[220px] truncate" title={property.address}>
                      {property.address}
                    </td>
                    {/* 가격 */}
                    <td className="px-3 py-2.5 text-right text-xs font-bold text-blue-700 whitespace-nowrap">
                      {formatPrice(property.price)}
                    </td>
                    {/* 월세 */}
                    <td className="px-3 py-2.5 text-right text-xs text-gray-600 whitespace-nowrap">
                      {property.monthly_rent ? formatPrice(property.monthly_rent) : <span className="text-gray-300">—</span>}
                    </td>
                    {/* 관리비 */}
                    <td className="px-3 py-2.5 text-right text-xs text-gray-600 whitespace-nowrap">
                      {property.management_fee ? formatPrice(property.management_fee) : <span className="text-gray-300">—</span>}
                    </td>
                    {/* 권리금 */}
                    <td className="px-3 py-2.5 text-right text-xs text-gray-600 whitespace-nowrap">
                      {property.premium ? formatPrice(property.premium) : <span className="text-gray-300">—</span>}
                    </td>
                    {/* 간단메모 */}
                    <td className="px-3 py-2.5 text-xs text-gray-500 max-w-[160px] truncate" title={property.brief_memo ?? ''}>
                      {property.brief_memo ?? <span className="text-gray-300">—</span>}
                    </td>
                    {/* 사진 */}
                    <td className="px-3 py-2.5 text-center">
                      {property.images?.length > 0 ? (
                        <button onClick={() => setLightbox({ images: property.images, index: 0 })}
                          className="relative h-9 w-9 overflow-hidden rounded-lg border border-gray-200 hover:opacity-80 transition-opacity mx-auto block"
                        >
                          <img src={property.images[0]} alt="" className="h-full w-full object-cover" />
                          {property.images.length > 1 && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-[9px] font-bold text-white">
                              +{property.images.length}
                            </div>
                          )}
                        </button>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    {/* 액션 */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-center">
                        <Link href={`/broker/properties/${property.id}/edit`}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                          title="수정"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
                        <button onClick={() => duplicateProperty(property)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
                          title="복사"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => copyInfo(property)}
                          className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors ${copiedId === property.id ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                          title="정보 복사"
                        >
                          {copiedId === property.id ? <Check className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />}
                        </button>
                        <button onClick={() => deleteProperty(property.id)}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-100 text-red-400 hover:bg-red-50 transition-colors"
                          title="삭제"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ===== 카드 뷰 ===== */}
        {viewMode === 'card' && (
          <div className="space-y-3">
            {paginated.length === 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white py-16 text-center text-sm text-gray-400">
                {searchQuery || dealFilter !== '전체' ? '검색 결과가 없습니다' : '등록된 매물이 없습니다'}
              </div>
            ) : paginated.map(property => (
              <div key={property.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="flex items-stretch">
                  <div className={`w-1 flex-shrink-0 ${STATUS_COLOR[property.status]}`} />
                  <div className="flex flex-1 items-start gap-4 p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <button onClick={() => cycleStatus(property)}>
                          <Badge variant={STATUS_BADGE[property.status]} className="cursor-pointer">{STATUS_LABEL[property.status]}</Badge>
                        </button>
                        <Badge variant="info">{property.deal_type}</Badge>
                        <Badge variant="default">{property.room_type}</Badge>
                        {property.assignee && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                            👤 {property.assignee}
                          </span>
                        )}
                      </div>
                      <p className="font-semibold text-gray-900 truncate">{property.address}</p>
                      <div className="mt-1 flex flex-wrap gap-4 text-sm">
                        <span className="font-black text-blue-600">{formatPropertyPrice(property)}</span>
                        {property.management_fee && <span className="text-gray-500">관리비 {formatPrice(property.management_fee)}</span>}
                        {property.premium && <span className="text-gray-500">권리금 {formatPrice(property.premium)}</span>}
                      </div>
                      {property.brief_memo && (
                        <p className="mt-2 text-xs text-gray-500 line-clamp-1">{property.brief_memo}</p>
                      )}
                      {property.description && (
                        <div className="mt-1.5 flex items-start gap-1 rounded-lg bg-gray-50 border border-gray-100 px-3 py-1.5">
                          <Building2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          <p className="text-xs text-gray-600 line-clamp-1">{property.description}</p>
                        </div>
                      )}
                      {property.memo && (
                        <div className="mt-1.5 flex items-start gap-1 rounded-lg bg-orange-50 border border-orange-100 px-3 py-1.5">
                          <StickyNote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-400" />
                          <p className="text-xs text-orange-700 line-clamp-1">{property.memo}</p>
                        </div>
                      )}
                      {property.images?.length > 0 && (
                        <div className="mt-2 flex gap-1.5">
                          {property.images.slice(0, 4).map((src, i) => (
                            <button key={i} onClick={() => setLightbox({ images: property.images, index: i })}
                              className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 hover:opacity-80 transition-opacity"
                            >
                              <img src={src} alt="" className="h-full w-full object-cover" />
                              {i === 3 && property.images.length > 4 && (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-bold text-white">
                                  +{property.images.length - 4}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <Link href={`/broker/properties/${property.id}/edit`}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />수정
                      </Link>
                      <button onClick={() => duplicateProperty(property)}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                      >
                        <Copy className="h-3.5 w-3.5" />복사
                      </button>
                      <button onClick={() => copyInfo(property)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${copiedId === property.id ? 'border-blue-300 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                      >
                        {copiedId === property.id ? <><Check className="h-3.5 w-3.5" />복사됨</> : <><LinkIcon className="h-3.5 w-3.5" />공유</>}
                      </button>
                      <button onClick={() => deleteProperty(property.id)}
                        className="flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />삭제
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce<(number | '...')[]>((acc, p, i, arr) => {
                if (i > 0 && (p as number) - (arr[i - 1] as number) > 1) acc.push('...')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === '...'
                  ? <span key={`ellipsis-${i}`} className="px-1 text-gray-400">…</span>
                  : <button key={p} onClick={() => setPage(p as number)}
                      className={`h-9 w-9 rounded-xl border text-sm font-semibold transition-colors ${page === p ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                    >{p}</button>
              )
            }
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="ml-2 text-sm text-gray-400">{page} / {totalPages} 페이지 (50개씩)</span>
          </div>
        )}
      </div>
    </div>
  )
}
