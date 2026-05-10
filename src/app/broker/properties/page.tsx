'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatPrice } from '@/lib/utils'
import {
  Plus, MapPin, Trash2, ToggleLeft, ToggleRight, Building2,
  StickyNote, Pencil, Search, Copy, EyeOff, Eye, ArrowUpDown,
  Link as LinkIcon, Check,
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
  size_pyeong: number | null
  floor: number | null
  total_floors: number | null
  options: string[]
  images: string[]
  description: string | null
  memo: string | null
  assignee: string | null
  status: 'available' | 'contracted' | 'hidden'
  created_at: string
}

const STATUS_LABEL = { available: '매물 있음', contracted: '계약 완료', hidden: '숨김' }
const STATUS_VARIANT = { available: 'success', contracted: 'default', hidden: 'warning' } as const
const STATUS_COLOR = { available: 'bg-green-500', contracted: 'bg-gray-300', hidden: 'bg-yellow-400' }

const DEAL_FILTERS = ['전체', '매매', '전세', '월세'] as const
type DealFilter = typeof DEAL_FILTERS[number]
type SortKey = 'newest' | 'oldest' | 'price_asc' | 'price_desc'

export default function BrokerPropertiesPage() {
  const router = useRouter()
  const supabase = createClient()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)

  // 필터/검색/정렬 상태
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'contracted' | 'hidden'>('all')
  const [dealFilter, setDealFilter] = useState<DealFilter>('전체')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchField, setSearchField] = useState<'all' | 'address' | 'assignee' | 'room_type'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('newest')
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

    const { data: b } = await supabase
      .from('broker_profiles')
      .select('id')
      .eq('user_id', u.id)
      .single()

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

  // 상태 순환: 매물있음 → 계약완료 → 숨김 → 매물있음
  const cycleStatus = async (property: Property) => {
    const next: Property['status'] =
      property.status === 'available' ? 'contracted'
      : property.status === 'contracted' ? 'hidden'
      : 'available'

    const { error } = await supabase
      .from('broker_properties')
      .update({ status: next })
      .eq('id', property.id)

    if (error) { alert('상태 변경에 실패했어요.'); return }
    setProperties(prev => prev.map(p => p.id === property.id ? { ...p, status: next } : p))
  }

  const deleteProperty = async (id: string) => {
    if (!confirm('이 매물을 삭제하시겠어요?')) return
    const { error } = await supabase.from('broker_properties').delete().eq('id', id)
    if (error) { alert('삭제에 실패했어요.'); return }
    setProperties(prev => prev.filter(p => p.id !== id))
  }

  // 매물 복사
  const duplicateProperty = async (property: Property) => {
    if (!broker) return
    const { id, created_at, ...rest } = property
    const { data, error } = await supabase
      .from('broker_properties')
      .insert({ ...rest, broker_id: broker.id, status: 'available', memo: property.memo })
      .select()
      .single()

    if (error) { alert('복사에 실패했어요.'); return }
    setProperties(prev => [data, ...prev])
  }

  // 주소 클립보드 복사
  const copyAddress = (property: Property) => {
    navigator.clipboard.writeText(
      `[${property.deal_type}] ${property.room_type} · ${property.address} · ${formatPropertyPrice(property)}`
    )
    setCopiedId(property.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const formatPropertyPrice = (p: Property) => {
    if (p.deal_type === '월세') {
      return `보증금 ${formatPrice(p.price)} / 월 ${formatPrice(p.monthly_rent ?? 0)}`
    }
    return formatPrice(p.price)
  }

  // 필터+검색+정렬 적용
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
        // 전체: 주소 + 담당자 + 매물유형 + 설명
        return (
          p.address.toLowerCase().includes(q) ||
          (p.assignee ?? '').toLowerCase().includes(q) ||
          p.room_type.toLowerCase().includes(q) ||
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
  }, [properties, statusFilter, dealFilter, searchQuery, sortKey])

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

      {/* 사진 라이트박스 */}
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

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* 타이틀 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">내 매물장</h1>
            <p className="mt-1 text-sm text-gray-500">등록한 매물 {properties.length}건</p>
          </div>
          <Link href="/broker/properties/new" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            <Plus className="h-4 w-4" />
            매물 등록
          </Link>
        </div>

        {/* 통계 카드 */}
        <div className="mb-6 grid grid-cols-4 gap-3">
          {[
            { label: '전체', value: properties.length, key: 'all' as const, color: 'text-gray-600 bg-gray-100' },
            { label: '매물 있음', value: properties.filter(p => p.status === 'available').length, key: 'available' as const, color: 'text-green-600 bg-green-50' },
            { label: '계약 완료', value: properties.filter(p => p.status === 'contracted').length, key: 'contracted' as const, color: 'text-blue-600 bg-blue-50' },
            { label: '숨김', value: properties.filter(p => p.status === 'hidden').length, key: 'hidden' as const, color: 'text-yellow-600 bg-yellow-50' },
          ].map(stat => (
            <button
              key={stat.key}
              onClick={() => setStatusFilter(stat.key)}
              className={`rounded-2xl p-4 text-left transition-all border-2 bg-white ${statusFilter === stat.key ? 'border-blue-500 shadow-sm' : 'border-transparent'}`}
            >
              <div className={`mb-1 inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${stat.color}`}>{stat.label}</div>
              <div className="text-2xl font-black text-gray-900">{stat.value}</div>
            </button>
          ))}
        </div>

        {/* 검색 + 거래유형 필터 + 정렬 */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* 검색 */}
          <div className="relative flex flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
            <select
              value={searchField}
              onChange={e => setSearchField(e.target.value as any)}
              className="border-r border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-medium text-gray-600 focus:outline-none"
            >
              <option value="all">전체</option>
              <option value="address">주소</option>
              <option value="assignee">담당자</option>
              <option value="room_type">매물유형</option>
            </select>
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="검색어 입력..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-transparent py-2.5 pl-9 pr-4 text-sm focus:outline-none"
              />
            </div>
          </div>

          {/* 거래유형 탭 */}
          <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
            {DEAL_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setDealFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${dealFilter === f ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* 정렬 */}
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-600 focus:border-blue-500 focus:outline-none"
          >
            <option value="newest">최신순</option>
            <option value="oldest">오래된순</option>
            <option value="price_desc">가격 높은순</option>
            <option value="price_asc">가격 낮은순</option>
          </select>
        </div>

        {/* 결과 수 */}
        {(searchQuery || dealFilter !== '전체' || statusFilter !== 'all') && (
          <p className="mb-3 text-sm text-gray-500">검색 결과 {filtered.length}건</p>
        )}

        {/* 매물 목록 */}
        {filtered.length === 0 ? (
          <Card>
            <CardBody className="py-16 text-center">
              <Building2 className="mx-auto mb-4 h-12 w-12 text-gray-200" />
              <p className="font-semibold text-gray-500">
                {searchQuery || dealFilter !== '전체' ? '검색 결과가 없습니다' : '등록된 매물이 없습니다'}
              </p>
              <p className="mt-1 text-sm text-gray-400">매물을 등록하면 채팅에서 바로 공유할 수 있어요</p>
              {!searchQuery && dealFilter === '전체' && (
                <Link href="/broker/properties/new" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                  <Plus className="h-4 w-4" />첫 매물 등록하기
                </Link>
              )}
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(property => (
              <Card key={property.id} className="overflow-hidden">
                <CardBody className="p-0">
                  <div className="flex items-stretch">
                    {/* 상태 컬러 바 */}
                    <div className={`w-1 flex-shrink-0 ${STATUS_COLOR[property.status]}`} />

                    <div className="flex flex-1 items-start gap-4 p-4">
                      {/* 매물 정보 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant={STATUS_VARIANT[property.status]}>
                            {STATUS_LABEL[property.status]}
                          </Badge>
                          <Badge variant="info">{property.deal_type}</Badge>
                          <Badge variant="default">{property.room_type}</Badge>
                        </div>

                        <div className="flex items-start gap-1.5 mb-1">
                          <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
                          <span className="font-semibold text-gray-900">{property.address}</span>
                        </div>

                        <div className="text-lg font-black text-blue-600 mb-1">
                          {formatPropertyPrice(property)}
                        </div>

                        <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                          {property.size_pyeong && <span>{property.size_pyeong}평</span>}
                          {property.floor && (
                            <span>{property.floor}층{property.total_floors ? `/${property.total_floors}층` : ''}</span>
                          )}
                          {(property.options ?? []).slice(0, 3).map(opt => (
                            <span key={opt} className="rounded-full bg-gray-100 px-2 py-0.5">{opt}</span>
                          ))}
                          {(property.options ?? []).length > 3 && (
                            <span className="text-gray-400">+{(property.options ?? []).length - 3}</span>
                          )}
                        </div>

                        {/* 사진 썸네일 */}
                        {property.images?.length > 0 && (
                          <div className="mt-2 flex gap-1.5">
                            {property.images.slice(0, 4).map((src, i) => (
                              <button
                                key={i}
                                type="button"
                                onClick={() => setLightbox({ images: property.images, index: i })}
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

                        {/* 매물 설명 */}
                        {property.description && (
                          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                            <Building2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                            <p className="text-xs text-gray-600 line-clamp-1">{property.description}</p>
                          </div>
                        )}

                        {/* 담당자 + 중개사 메모 */}
                        {(property.assignee || property.memo) && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {property.assignee && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">
                                👤 {property.assignee}
                              </span>
                            )}
                            {property.memo && (
                              <div className="flex w-full items-start gap-1.5 rounded-lg bg-orange-50 border border-orange-100 px-3 py-2">
                                <StickyNote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-400" />
                                <p className="text-xs text-orange-700 line-clamp-1">{property.memo}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* 액션 버튼 */}
                      <div className="flex flex-col items-end gap-1.5">
                        {/* 수정 */}
                        <Link
                          href={`/broker/properties/${property.id}/edit`}
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <Pencil className="h-3.5 w-3.5" />수정
                        </Link>

                        {/* 상태 변경 (순환) */}
                        <button
                          onClick={() => cycleStatus(property)}
                          title="클릭하면 상태가 변경됩니다 (매물있음→계약완료→숨김)"
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          {property.status === 'available' && <><ToggleRight className="h-4 w-4 text-green-500" />매물 있음</>}
                          {property.status === 'contracted' && <><ToggleLeft className="h-4 w-4 text-gray-400" />계약 완료</>}
                          {property.status === 'hidden' && <><EyeOff className="h-4 w-4 text-yellow-500" />숨김</>}
                        </button>

                        {/* 복사 */}
                        <button
                          onClick={() => duplicateProperty(property)}
                          title="이 매물을 복제합니다"
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" />복사
                        </button>

                        {/* 채팅 공유용 클립보드 복사 */}
                        <button
                          onClick={() => copyAddress(property)}
                          title="채팅에 붙여넣기 할 수 있도록 정보를 복사합니다"
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            copiedId === property.id
                              ? 'border-blue-300 bg-blue-50 text-blue-600'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {copiedId === property.id
                            ? <><Check className="h-3.5 w-3.5" />복사됨</>
                            : <><LinkIcon className="h-3.5 w-3.5" />공유</>
                          }
                        </button>

                        {/* 삭제 */}
                        <button
                          onClick={() => deleteProperty(property.id)}
                          className="flex items-center gap-1.5 rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />삭제
                        </button>
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
