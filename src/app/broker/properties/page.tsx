'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPrice } from '@/lib/utils'
import { Plus, Home, MapPin, Trash2, ToggleLeft, ToggleRight, Building2, StickyNote, Pencil } from 'lucide-react'
import Link from 'next/link'

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
  memo: string | null
  status: 'available' | 'contracted' | 'hidden'
  created_at: string
}

const STATUS_LABEL = { available: '매물 있음', contracted: '계약 완료', hidden: '숨김' }
const STATUS_VARIANT = { available: 'success', contracted: 'default', hidden: 'warning' } as const

export default function BrokerPropertiesPage() {
  const router = useRouter()
  const supabase = createClient()

  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<any>(null)
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'available' | 'contracted' | 'hidden'>('all')

  useEffect(() => {
    init()
  }, [])

  const init = async () => {
    const { data: { user: u } } = await supabase.auth.getUser()
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

  const toggleStatus = async (property: Property) => {
    const next = property.status === 'available' ? 'contracted' : 'available'
    const { error } = await supabase
      .from('broker_properties')
      .update({ status: next })
      .eq('id', property.id)
    if (error) { alert('상태 변경에 실패했어요. 다시 시도해주세요.'); return }
    setProperties(prev => prev.map(p => p.id === property.id ? { ...p, status: next } : p))
  }

  const deleteProperty = async (id: string) => {
    if (!confirm('이 매물을 삭제하시겠어요?')) return
    const { error } = await supabase.from('broker_properties').delete().eq('id', id)
    if (error) { alert('삭제에 실패했어요. 다시 시도해주세요.'); return }
    setProperties(prev => prev.filter(p => p.id !== id))
  }

  const filtered = filter === 'all' ? properties : properties.filter(p => p.status === filter)

  const formatPropertyPrice = (p: Property) => {
    if (p.deal_type === '월세') {
      return `보증금 ${formatPrice(p.price)} / 월 ${formatPrice(p.monthly_rent ?? 0)}`
    }
    return formatPrice(p.price)
  }

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

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* 타이틀 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">내 매물장</h1>
            <p className="mt-1 text-sm text-gray-500">등록한 매물 {properties.length}건</p>
          </div>
          <Link href="/broker/properties/new">
            <Button variant="primary">
              <Plus className="mr-2 h-4 w-4" />
              매물 등록
            </Button>
          </Link>
        </div>

        {/* 통계 */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          {[
            { label: '전체', value: properties.length, key: 'all' as const, color: 'text-gray-600 bg-gray-100' },
            { label: '매물 있음', value: properties.filter(p => p.status === 'available').length, key: 'available' as const, color: 'text-green-600 bg-green-50' },
            { label: '계약 완료', value: properties.filter(p => p.status === 'contracted').length, key: 'contracted' as const, color: 'text-blue-600 bg-blue-50' },
          ].map(stat => (
            <button
              key={stat.key}
              onClick={() => setFilter(stat.key)}
              className={`rounded-2xl p-4 text-left transition-all border-2 ${filter === stat.key ? 'border-blue-500 bg-white shadow-sm' : 'border-transparent bg-white'}`}
            >
              <div className={`mb-1 inline-flex rounded-lg px-2 py-0.5 text-xs font-semibold ${stat.color}`}>{stat.label}</div>
              <div className="text-2xl font-black text-gray-900">{stat.value}</div>
            </button>
          ))}
        </div>

        {/* 매물 목록 */}
        {filtered.length === 0 ? (
          <Card>
            <CardBody className="py-16 text-center">
              <Building2 className="mx-auto mb-4 h-12 w-12 text-gray-200" />
              <p className="font-semibold text-gray-500">등록된 매물이 없습니다</p>
              <p className="mt-1 text-sm text-gray-400">매물을 등록하면 채팅에서 바로 공유할 수 있어요</p>
              <Link href="/broker/properties/new" className="mt-6 inline-block">
                <Button variant="primary">
                  <Plus className="mr-2 h-4 w-4" />첫 매물 등록하기
                </Button>
              </Link>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map(property => (
              <Card key={property.id} className="overflow-hidden">
                <CardBody className="p-0">
                  <div className="flex items-stretch">
                    {/* 상태 컬러 바 */}
                    <div className={`w-1 flex-shrink-0 ${property.status === 'available' ? 'bg-green-500' : property.status === 'contracted' ? 'bg-gray-300' : 'bg-yellow-400'}`} />

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

                        {/* 중개사 메모 */}
                        {property.memo && (
                          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-orange-50 border border-orange-100 px-3 py-2">
                            <StickyNote className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-orange-400" />
                            <p className="text-xs text-orange-700 line-clamp-2">{property.memo}</p>
                          </div>
                        )}
                      </div>

                      {/* 액션 버튼 */}
                      <div className="flex flex-col items-end gap-2">
                        <Link href={`/broker/properties/${property.id}/edit`}>
                          <button className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                            <Pencil className="h-3.5 w-3.5" />수정
                          </button>
                        </Link>
                        <button
                          onClick={() => toggleStatus(property)}
                          title={property.status === 'available' ? '계약 완료로 변경' : '매물 있음으로 변경'}
                          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          {property.status === 'available'
                            ? <><ToggleRight className="h-4 w-4 text-green-500" /> 매물 있음</>
                            : <><ToggleLeft className="h-4 w-4 text-gray-400" /> 계약 완료</>
                          }
                        </button>
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
