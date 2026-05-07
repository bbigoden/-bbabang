'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Star, MapPin, Building2, Award, MessageCircle } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'

interface BrokerProfile {
  id: string
  office_name: string
  district: string
  license_number: string
  description: string | null
  is_verified: boolean
  rating: number | null
  review_count: number | null
  profiles: { name: string; email: string }
}

interface Review {
  id: string
  rating: number
  comment: string | null
  created_at: string
  profiles: { name: string }
}

function StarRating({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <Star
          key={i}
          className={`h-4 w-4 ${i <= Math.round(value) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'}`}
        />
      ))}
    </div>
  )
}

export default function BrokerPublicProfilePage() {
  const params = useParams()
  const brokerId = params.id as string
  const supabase = createClient()
  const [user, setUser] = useState<any>(null)
  const [broker, setBroker] = useState<BrokerProfile | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [properties, setProperties] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const { data: { user: u } } = await supabase.auth.getUser()
      setUser(u)

      const { data: b } = await supabase
        .from('broker_profiles')
        .select('*, profiles(name, email)')
        .eq('id', brokerId)
        .single()
      setBroker(b)

      const { data: r } = await supabase
        .from('reviews')
        .select('*, profiles(name)')
        .eq('broker_id', brokerId)
        .order('created_at', { ascending: false })
      setReviews(r ?? [])

      const { data: p } = await supabase
        .from('broker_properties')
        .select('*')
        .eq('broker_id', brokerId)
        .eq('status', 'available')
        .order('created_at', { ascending: false })
      setProperties(p ?? [])

      setLoading(false)
    }
    load()
  }, [brokerId])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  if (!broker) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">존재하지 않는 중개사입니다.</p>
      </div>
    )
  }

  const districts = broker.district?.split(',').map(d => d.trim()).filter(Boolean) ?? []

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} />

      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* 프로필 카드 */}
        <Card className="mb-6 overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-blue-600 to-blue-400" />
          <CardBody className="-mt-8 pt-0">
            <div className="flex items-end gap-4 mb-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white border-4 border-white shadow-md">
                <Building2 className="h-8 w-8 text-blue-600" />
              </div>
              {broker.is_verified && (
                <div className="mb-1 flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-600">
                  <Award className="h-3.5 w-3.5" />
                  공인 인증 중개사
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{broker.profiles?.name}</h1>
                <p className="text-gray-500">{broker.office_name}</p>
              </div>
              <div className="text-right">
                {broker.rating ? (
                  <div>
                    <div className="flex items-center gap-2 justify-end">
                      <StarRating value={broker.rating} />
                      <span className="text-2xl font-black text-gray-900">{broker.rating.toFixed(1)}</span>
                    </div>
                    <p className="text-sm text-gray-400">리뷰 {broker.review_count}개</p>
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">아직 리뷰가 없어요</p>
                )}
              </div>
            </div>

            {/* 담당 지역 */}
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
              {districts.map(d => (
                <span key={d} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{d}</span>
              ))}
            </div>

            {broker.description && (
              <p className="mt-4 text-sm text-gray-600 leading-relaxed">{broker.description}</p>
            )}
          </CardBody>
        </Card>

        {/* 매물 있음 목록 */}
        {properties.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-lg font-bold text-gray-900">
              현재 매물 <span className="text-blue-600">{properties.length}</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {properties.map(p => (
                <Card key={p.id}>
                  <CardBody className="p-4">
                    {p.images?.[0] && (
                      <img src={p.images[0]} alt="" className="mb-3 h-32 w-full rounded-xl object-cover" />
                    )}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      <Badge variant="info">{p.deal_type}</Badge>
                      <Badge variant="default">{p.room_type}</Badge>
                    </div>
                    <p className="font-semibold text-gray-800 text-sm truncate">{p.address}</p>
                    <p className="text-blue-600 font-black mt-1">
                      {p.deal_type === '월세'
                        ? `보증금 ${(p.price/10000).toFixed(0)}억 / 월 ${p.monthly_rent}만`
                        : `${(p.price/10000) >= 1 ? (p.price/10000).toFixed(1)+'억' : p.price+'만'}`
                      }
                    </p>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* 리뷰 목록 */}
        <div>
          <h2 className="mb-3 text-lg font-bold text-gray-900">
            고객 리뷰 <span className="text-blue-600">{reviews.length}</span>
          </h2>

          {reviews.length === 0 ? (
            <Card>
              <CardBody className="py-10 text-center">
                <Star className="mx-auto mb-3 h-10 w-10 text-gray-200" />
                <p className="text-gray-500">아직 리뷰가 없습니다</p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-3">
              {reviews.map(review => (
                <Card key={review.id}>
                  <CardBody className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-500">
                          {review.profiles?.name?.[0] ?? '?'}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{review.profiles?.name}</p>
                          <p className="text-xs text-gray-400">{formatDate(review.created_at)}</p>
                        </div>
                      </div>
                      <StarRating value={review.rating} />
                    </div>
                    {review.comment && (
                      <p className="mt-3 text-sm text-gray-600 leading-relaxed">{review.comment}</p>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
