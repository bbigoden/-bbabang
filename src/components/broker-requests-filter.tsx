'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatPrice } from '@/lib/utils'
import { MapPin, Clock, Search, SlidersHorizontal, X } from 'lucide-react'
import Link from 'next/link'

const DEAL_TYPES = ['매매', '전세', '월세']
const ROOM_TYPES = ['원룸', '투룸', '쓰리룸 이상', '아파트', '오피스텔', '빌라/연립']

interface Props {
  brokerDistricts: string[]
}

export function BrokerRequestsFilter({ brokerDistricts }: Props) {
  const supabase = createClient()
  const [requests, setRequests] = useState<any[]>([])
  const [filtered, setFiltered] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showFilter, setShowFilter] = useState(false)

  const [search, setSearch] = useState('')
  const [dealType, setDealType] = useState('')
  const [roomType, setRoomType] = useState('')
  const [maxPrice, setMaxPrice] = useState('')

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    const { data } = await supabase
      .from('request_posts')
      .select('*, profiles(name)')
      .in('district', brokerDistricts.length > 0 ? brokerDistricts : ['__none__'])
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    setRequests(data ?? [])
    setFiltered(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    let result = [...requests]

    if (search) {
      const s = search.toLowerCase()
      result = result.filter(r =>
        r.city?.toLowerCase().includes(s) ||
        r.district?.toLowerCase().includes(s) ||
        r.deal_type?.toLowerCase().includes(s) ||
        r.room_type?.toLowerCase().includes(s)
      )
    }
    if (dealType) {
      result = result.filter(r => r.deal_type?.includes(dealType))
    }
    if (roomType) {
      result = result.filter(r => r.room_type?.includes(roomType))
    }
    if (maxPrice) {
      result = result.filter(r => (r.max_price ?? Infinity) <= Number(maxPrice))
    }

    setFiltered(result)
  }, [search, dealType, roomType, maxPrice, requests])

  const hasFilter = dealType || roomType || maxPrice

  const clearFilters = () => {
    setDealType('')
    setRoomType('')
    setMaxPrice('')
    setSearch('')
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-gray-900 flex items-center gap-2">
          <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          내 담당 지역 신규 요청
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">{filtered.length}</span>
        </h2>
        <button
          onClick={() => setShowFilter(o => !o)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            hasFilter ? 'border-blue-500 bg-blue-50 text-blue-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          필터{hasFilter ? ' · ON' : ''}
        </button>
      </div>

      {/* 검색 */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="지역, 유형으로 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="h-4 w-4 text-gray-400" />
          </button>
        )}
      </div>

      {/* 상세 필터 */}
      {showFilter && (
        <div className="mb-3 rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          {/* 거래유형 */}
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">거래 유형</p>
            <div className="flex flex-wrap gap-2">
              {DEAL_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setDealType(dealType === t ? '' : t)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    dealType === t ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >{t}</button>
              ))}
            </div>
          </div>

          {/* 매물유형 */}
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">매물 유형</p>
            <div className="flex flex-wrap gap-2">
              {ROOM_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => setRoomType(roomType === t ? '' : t)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    roomType === t ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >{t}</button>
              ))}
            </div>
          </div>

          {/* 최대 가격 */}
          <div>
            <p className="mb-2 text-xs font-semibold text-gray-500">최대 가격 (만원)</p>
            <input
              type="number"
              placeholder="예: 50000"
              value={maxPrice}
              onChange={e => setMaxPrice(e.target.value)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          {hasFilter && (
            <button onClick={clearFilters} className="text-xs text-red-500 hover:text-red-600 font-medium">
              필터 초기화
            </button>
          )}
        </div>
      )}

      {/* 요청 목록 */}
      <div className="space-y-3">
        {loading ? (
          <Card><CardBody className="py-8 text-center text-sm text-gray-400">불러오는 중...</CardBody></Card>
        ) : filtered.length === 0 ? (
          <Card>
            <CardBody className="py-8 text-center text-sm text-gray-400">
              {hasFilter || search ? '검색 결과가 없습니다' : '현재 신규 요청이 없습니다'}
            </CardBody>
          </Card>
        ) : (
          filtered.map((req: any) => (
            <Card key={req.id} hover>
              <CardBody className="py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap gap-1.5 mb-1">
                      {(req.deal_type?.split(',') ?? []).map((t: string) => (
                        <Badge key={t} variant="info">{t.trim()}</Badge>
                      ))}
                      {(req.room_type?.split(',') ?? []).slice(0, 2).map((t: string) => (
                        <Badge key={t} variant="default">{t.trim()}</Badge>
                      ))}
                    </div>
                    <div className="font-bold text-blue-600">
                      {formatPrice(req.min_price)}~{formatPrice(req.max_price)}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs text-gray-400">
                      <MapPin className="h-3.5 w-3.5" />
                      {req.city} {req.district}
                      <span className="mx-1">·</span>
                      <Clock className="h-3.5 w-3.5" />
                      {formatDate(req.created_at)}
                    </div>
                  </div>
                  <Link href={`/request/${req.id}/propose`} className="flex-shrink-0">
                    <Button size="sm" variant="primary">제안</Button>
                  </Link>
                </div>
              </CardBody>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
