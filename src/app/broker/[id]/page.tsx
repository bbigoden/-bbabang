import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FavoriteButton } from '@/components/favorite-button'
import { Star, MapPin, Building2, Award } from 'lucide-react'
import { formatDate, formatPrice } from '@/lib/utils'
import Image from 'next/image'
import { notFound } from 'next/navigation'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('broker_profiles')
    .select('office_name, district, rating, review_count, profiles(name)')
    .eq('id', id)
    .maybeSingle()
  const profile = (data?.profiles as { name?: string } | null) ?? null
  const name = profile?.name ?? '중개사'
  const office = data?.office_name ?? '공인중개사사무소'
  const district = data?.district ?? ''
  const rating = data?.rating ?? null
  const reviewCount = data?.review_count ?? 0
  const title = `${name} (${office}) | 빠방`
  const description = `${district ? district + ' ' : ''}${office} ${name} 중개사 — ${rating ? `평점 ${rating.toFixed(1)} (${reviewCount}개) · ` : ''}빠방 인증 부동산 중개사 프로필.`
  return {
    title,
    description,
    alternates: { canonical: `/broker/${id}` },
    openGraph: { title, description, url: `/broker/${id}` },
  }
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

export default async function BrokerPublicProfilePage({ params }: Props) {
  const { id: brokerId } = await params
  const supabase = await createClient()

  let user: any = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch { /* 비로그인으로 표시 */ }

  let broker: any = null
  let reviews: any[] = []
  let properties: any[] = []
  try {
    const [{ data: b }, { data: r }, { data: p }] = await Promise.all([
      supabase
        .from('broker_profiles')
        .select('*, profiles(name, email)')
        .eq('id', brokerId)
        .single(),
      supabase
        .from('reviews')
        .select('*, profiles(name)')
        .eq('broker_id', brokerId)
        .order('created_at', { ascending: false }),
      supabase
        .from('broker_properties')
        .select('*')
        .eq('broker_id', brokerId)
        .eq('status', 'available')
        .order('created_at', { ascending: false }),
    ])
    broker = b
    reviews = r ?? []
    properties = p ?? []
  } catch { /* 데이터 로드 실패 시 빈 상태 */ }

  if (!broker) notFound()

  // 로그인 사용자의 broker·property 찜 상태 한 번에 fetch
  let brokerFavorited = false
  const propFavSet = new Set<string>()
  if (user) {
    const propIds = properties.map(p => p.id)
    const targets = [
      supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id)
        .eq('target_type', 'broker')
        .eq('target_id', brokerId)
        .maybeSingle(),
      propIds.length > 0
        ? supabase
            .from('favorites')
            .select('target_id')
            .eq('user_id', user.id)
            .eq('target_type', 'property')
            .in('target_id', propIds)
        : Promise.resolve({ data: [] as { target_id: string }[] }),
    ]
    const [bf, pf] = await Promise.all(targets)
    brokerFavorited = !!(bf as any).data
    ;((pf as any).data ?? []).forEach((row: { target_id: string }) => propFavSet.add(row.target_id))
  }

  const districts = broker.district?.split(',').map((d: string) => d.trim()).filter(Boolean) ?? []

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
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-gray-900">{broker.profiles?.name}</h1>
                  <FavoriteButton type="broker" id={brokerId} variant="pill" initialFavorited={brokerFavorited} />
                </div>
                <p className="text-gray-500">{broker.office_name}</p>
              </div>
              <div className="text-right">
                {broker.review_count > 0 ? (
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
              {districts.map((d: string) => (
                <span key={d} className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">{d}</span>
              ))}
            </div>

            {broker.description && (
              <p className="mt-4 text-sm text-gray-600 leading-relaxed">{broker.description}</p>
            )}
          </CardBody>
        </Card>

        {/* 매물 있음 목록 */}
        {properties && properties.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-lg font-bold text-gray-900">
              현재 매물 <span className="text-blue-600">{properties.length}</span>
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {properties.map(p => (
                <Card key={p.id} className="relative">
                  <CardBody className="p-4">
                    {p.images?.[0] ? (
                      <div className="relative mb-3 h-32 w-full overflow-hidden rounded-xl">
                        <Image
                          src={p.images[0]}
                          alt={p.address}
                          fill
                          className="object-cover"
                          sizes="(max-width: 640px) 100vw, 50vw"
                        />
                        <div className="absolute right-2 top-2">
                          <FavoriteButton type="property" id={p.id} initialFavorited={propFavSet.has(p.id)} />
                        </div>
                      </div>
                    ) : (
                      <div className="absolute right-3 top-3">
                        <FavoriteButton type="property" id={p.id} initialFavorited={propFavSet.has(p.id)} />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {p.deal_type && <Badge variant="info">{p.deal_type}</Badge>}
                      {p.room_type && <Badge variant="default">{p.room_type}</Badge>}
                    </div>
                    <p className="font-semibold text-gray-800 text-sm truncate">{p.address || '주소 미입력'}</p>
                    <p className="text-blue-600 font-black mt-1">
                      {!p.price
                        ? '가격 협의'
                        : p.deal_type === '월세'
                          ? `보증금 ${formatPrice(p.price)} / 월 ${formatPrice(p.monthly_rent ?? 0)}`
                          : formatPrice(p.price)
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
            고객 리뷰 <span className="text-blue-600">{reviews?.length ?? 0}</span>
          </h2>

          {!reviews || reviews.length === 0 ? (
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
