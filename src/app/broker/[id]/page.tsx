import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FavoriteButton } from '@/components/favorite-button'
import { ReportButton } from '@/components/report-button'
import { ViewTracker } from '@/components/view-tracker'
import { Star, MapPin, Building2, Award, Clock, Target, TrendingUp, Hash, Phone, User } from 'lucide-react'

function formatHours(h: number | null | undefined): string | null {
  if (h == null || h <= 0) return null
  if (h < 1) return `${Math.round(h * 60)}분`
  if (h < 24) return `${h.toFixed(1)}시간`
  return `${(h / 24).toFixed(1)}일`
}
import { formatDate, formatPrice, maskAddressByType, formatAddress } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'
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
    // 매물은 1000건씩 페이지네이션 (PostgREST max-rows 우회)
    const fetchAllProps = async () => {
      const PAGE = 1000
      const all: any[] = []
      for (let from = 0; ; from += PAGE) {
        const { data: page } = await supabase
          .from('broker_properties').select('*').eq('broker_id', brokerId).eq('status', 'available')
          .order('created_at', { ascending: false }).range(from, from + PAGE - 1)
        if (!page || page.length === 0) break
        all.push(...page)
        if (page.length < PAGE) break
      }
      return all
    }
    const [{ data: b }, { data: r }, p] = await Promise.all([
      supabase
        .from('broker_profiles')
        .select('*, profiles(name, email, phone)')
        .eq('id', brokerId)
        .single(),
      supabase
        .from('reviews')
        .select('*, profiles(name)')
        .eq('broker_id', brokerId)
        .order('created_at', { ascending: false }),
      fetchAllProps(),
    ])
    broker = b
    reviews = r ?? []
    properties = p ?? []
  } catch { /* 데이터 로드 실패 시 빈 상태 */ }

  if (!broker) notFound()

  // 최근 7일 가격 인하 매물 ID 조회 — 1300+ 매물에서 .in() URL 길이 문제 회피하려 broker_id JOIN 사용
  const recentDropIds = new Set<string>()
  if (properties.length > 0) {
    try {
      const sinceISO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: drops } = await supabase
        .from('property_price_history')
        .select('property_id, old_price, new_price, broker_properties!inner(broker_id)')
        .eq('broker_properties.broker_id', brokerId)
        .gte('changed_at', sinceISO)
      ;(drops ?? []).forEach((d: any) => {
        if (d.new_price != null && d.old_price != null && d.new_price < d.old_price) {
          recentDropIds.add(d.property_id)
        }
      })
    } catch {/* 가격 히스토리 실패는 무시 — 페이지 자체는 정상 */}
  }

  // 로그인 사용자의 broker·property 찜 상태 한 번에 fetch
  // 매물 1300+ 인 경우 .in()이 URL 길이 초과 → 사용자의 모든 property 찜을 가져와 set으로 매칭
  let brokerFavorited = false
  const propFavSet = new Set<string>()
  if (user) {
    const [bf, pf] = await Promise.all([
      supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id)
        .eq('target_type', 'broker')
        .eq('target_id', brokerId)
        .maybeSingle(),
      supabase
        .from('favorites')
        .select('target_id')
        .eq('user_id', user.id)
        .eq('target_type', 'property'),
    ])
    brokerFavorited = !!bf.data
    ;(pf.data ?? []).forEach((row: { target_id: string }) => propFavSet.add(row.target_id))
  }

  const districts = broker.district?.split(',').map((d: string) => d.trim()).filter(Boolean) ?? []

  // JSON-LD 구조화 데이터
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: 'https://bbabang.vercel.app' },
          { '@type': 'ListItem', position: 2, name: '중개사', item: 'https://bbabang.vercel.app/brokers' },
          { '@type': 'ListItem', position: 3, name: broker.profiles?.name ?? '중개사', item: `https://bbabang.vercel.app/broker/${brokerId}` },
        ],
      },
      {
        '@type': 'RealEstateAgent',
        name: broker.profiles?.name ?? '공인중개사',
        url: `https://bbabang.vercel.app/broker/${brokerId}`,
        ...(broker.office_name && { brand: { '@type': 'Organization', name: broker.office_name } }),
        ...(broker.address && { address: { '@type': 'PostalAddress', streetAddress: broker.address, addressCountry: 'KR' } }),
        ...(broker.rating > 0 && broker.review_count > 0 && {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: broker.rating,
            reviewCount: broker.review_count,
            bestRating: 5,
          },
        }),
        ...(reviews.length > 0 && {
          review: reviews.slice(0, 5).map((r: any) => ({
            '@type': 'Review',
            author: { '@type': 'Person', name: r.profiles?.name ?? '익명' },
            datePublished: r.created_at,
            reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 },
            reviewBody: r.content,
          })),
        }),
      },
    ],
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} />
      <ViewTracker type="broker" id={brokerId} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

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
                  인증 공인중개사
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-gray-900 break-keep">{broker.office_name}</h1>
                  <FavoriteButton type="broker" id={brokerId} variant="pill" initialFavorited={brokerFavorited} />
                </div>
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

            {/* 사무소 정보 — 2열 (모바일 1열) — 1행: 소재지·등록번호 / 2행: 연락처·대표 */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-gray-600">
              {broker.address && (
                <div className="flex items-start gap-2 min-w-0">
                  <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span className="break-keep">{broker.address}</span>
                </div>
              )}
              {broker.office_reg_number && (
                <div className="flex items-start gap-2 min-w-0">
                  <Hash className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span>등록번호 <span className="font-mono text-gray-800">{broker.office_reg_number}</span></span>
                </div>
              )}
              {broker.profiles?.phone && (
                <div className="flex items-start gap-2 min-w-0">
                  <Phone className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <a href={`tel:${broker.profiles.phone}`} className="text-blue-600 hover:underline">
                    {broker.profiles.phone}
                  </a>
                </div>
              )}
              {broker.profiles?.name && (
                <div className="flex items-start gap-2 min-w-0">
                  <User className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <span>대표 <span className="font-semibold text-gray-800">{broker.profiles.name}</span></span>
                </div>
              )}
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

            {/* 신뢰 지표 */}
            {(broker.acceptance_rate != null || broker.avg_response_hours != null || broker.deal_count > 0) && (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {broker.acceptance_rate != null && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-center">
                    <div className="mb-0.5 inline-flex items-center justify-center text-blue-500">
                      <Target className="h-4 w-4" />
                    </div>
                    <p className="text-lg font-black text-blue-600">{broker.acceptance_rate}%</p>
                    <p className="text-[10px] font-medium text-blue-700">제안 수락률</p>
                  </div>
                )}
                {formatHours(broker.avg_response_hours) && (
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-center">
                    <div className="mb-0.5 inline-flex items-center justify-center text-emerald-500">
                      <Clock className="h-4 w-4" />
                    </div>
                    <p className="text-lg font-black text-emerald-600">{formatHours(broker.avg_response_hours)}</p>
                    <p className="text-[10px] font-medium text-emerald-700">평균 응답</p>
                  </div>
                )}
                {broker.deal_count > 0 && (
                  <div className="rounded-xl border border-purple-100 bg-purple-50 p-3 text-center">
                    <div className="mb-0.5 inline-flex items-center justify-center text-purple-500">
                      <TrendingUp className="h-4 w-4" />
                    </div>
                    <p className="text-lg font-black text-purple-600">{broker.deal_count}건</p>
                    <p className="text-[10px] font-medium text-purple-700">누적 거래</p>
                  </div>
                )}
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <ReportButton type="broker" id={brokerId} variant="text" />
            </div>
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
                <Link key={p.id} href={`/property/${p.id}`}>
                <Card className="relative hover:border-blue-300 transition-colors">
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
                      {recentDropIds.has(p.id) && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-600 animate-pulse">
                          ⬇️ 가격 인하
                        </span>
                      )}
                    </div>
                    <p className="font-semibold text-gray-800 text-sm truncate">{p.address ? formatAddress(maskAddressByType(p.address, p.room_type)) : '주소 미입력'}</p>
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
                </Link>
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
                    {review.content && (
                      <p className="mt-3 text-sm text-gray-600 leading-relaxed">{review.content}</p>
                    )}
                    {Array.isArray(review.images) && review.images.length > 0 && (
                      <div className="mt-3 flex gap-2 overflow-x-auto">
                        {review.images.map((url: string, i: number) => (
                          <div key={i} className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg">
                            <Image src={url} alt={`리뷰 사진 ${i + 1}`} fill className="object-cover" sizes="80px" />
                          </div>
                        ))}
                      </div>
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
