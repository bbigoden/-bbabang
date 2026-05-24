import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { FavoriteButton } from '@/components/favorite-button'
import { ReportButton } from '@/components/report-button'
import { ViewTracker } from '@/components/view-tracker'
import { PropertyCard } from '@/components/property-card'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatPrice, maskAddressByType, formatAddress } from '@/lib/utils'
import {
  Building2, MapPin, Home, Hash, ShieldCheck, Calendar, Star,
  TrendingDown, TrendingUp, MessageCircle, Eye, ChevronRight
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface Props { params: Promise<{ id: string }> }

const BASE_URL = 'https://bbabang.vercel.app'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('broker_properties')
    .select('address, deal_type, room_type, price, monthly_rent')
    .eq('id', id)
    .maybeSingle()
  if (!data) return { title: '매물 | 빠방' }
  const region = maskAddressByType(data.address, data.room_type)
  const priceStr = data.deal_type === '월세'
    ? `보증금 ${data.price ? formatPrice(data.price) : '협의'}/월 ${data.monthly_rent ? formatPrice(data.monthly_rent) : '협의'}`
    : data.price ? formatPrice(data.price) : '가격 협의'
  const title = `${region} ${data.deal_type ?? ''} ${data.room_type ?? ''} ${priceStr}`.replace(/\s+/g, ' ').trim()
  return {
    title,
    description: `${title} — 빠방 인증 중개사가 등록한 매물`,
    alternates: { canonical: `/property/${id}` },
    openGraph: { title, description: `${title} — 빠방`, url: `/property/${id}` },
  }
}

export default async function PropertyDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  let user: any = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {/* 비로그인 */}

  const { data: prop } = await supabase
    .from('broker_properties')
    .select('*, broker_profiles(id, office_name, address, district, rating, review_count, deal_count, is_verified, avg_response_hours, acceptance_rate, profiles(name, phone))')
    .eq('id', id)
    .maybeSingle()

  if (!prop) notFound()

  // 본인(매물 등록 중개사) 여부 — 본인이면 풀 주소, 아니면 마스킹
  const broker = prop.broker_profiles as any
  const isOwnProperty = !!(user && broker?.profiles && (broker as any).user_id === user.id)
  // user_id가 broker_profiles에서 안 select되어 별도 체크
  let isMine = false
  if (user && prop.broker_id) {
    const { data: myBroker } = await supabase
      .from('broker_profiles').select('id').eq('user_id', user.id).maybeSingle()
    if (myBroker?.id === prop.broker_id) isMine = true
  }
  // 비본인: 먼저 '307-1502'→'307동 1502호'로 풀어쓴 다음 mask가 '1502호' 토큰을 제거하도록 순서를 뒤집음
  const displayAddress = isMine
    ? formatAddress(prop.address)
    : (prop.address ? maskAddressByType(formatAddress(prop.address), prop.room_type) : '주소 미입력')

  // 본인 찜 상태
  let isFavorited = false
  if (user) {
    const { data: fav } = await supabase
      .from('favorites')
      .select('id')
      .eq('user_id', user.id)
      .eq('target_type', 'property')
      .eq('target_id', id)
      .maybeSingle()
    isFavorited = !!fav
  }

  // 가격 히스토리 (최근 5개)
  const { data: priceHistory } = await supabase
    .from('property_price_history')
    .select('old_price, new_price, old_monthly_rent, new_monthly_rent, changed_at')
    .eq('property_id', id)
    .order('changed_at', { ascending: false })
    .limit(5)

  // 같은 중개사의 다른 매물 (4개)
  const { data: otherProps } = await supabase
    .from('broker_properties')
    .select('id, address, deal_type, room_type, price, monthly_rent, images')
    .eq('broker_id', prop.broker_id)
    .eq('status', 'available')
    .neq('id', id)
    .order('created_at', { ascending: false })
    .limit(4)

  const brokerProfile = broker?.profiles
  const priceText = prop.deal_type === '월세'
    ? `보증금 ${formatPrice(prop.price)} · 월 ${formatPrice(prop.monthly_rent ?? 0)}`
    : prop.price ? formatPrice(prop.price) : '가격 협의'

  const hasPriceDrop = priceHistory && priceHistory.length > 0 && priceHistory.some(p =>
    p.new_price != null && p.old_price != null && p.new_price < p.old_price
  )

  // JSON-LD
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: BASE_URL },
          { '@type': 'ListItem', position: 2, name: '매물', item: `${BASE_URL}/brokers` },
          { '@type': 'ListItem', position: 3, name: maskAddressByType(prop.address, prop.room_type) || '매물', item: `${BASE_URL}/property/${id}` },
        ],
      },
      {
        '@type': 'Product',
        name: `${maskAddressByType(prop.address, prop.room_type)} ${prop.deal_type ?? ''} ${prop.room_type ?? ''}`.trim(),
        description: prop.description ?? '',
        image: prop.images ?? [],
        offers: prop.price ? {
          '@type': 'Offer',
          price: prop.price,
          priceCurrency: 'KRW',
          availability: 'https://schema.org/InStock',
          seller: brokerProfile?.name ? { '@type': 'RealEstateAgent', name: brokerProfile.name } : undefined,
        } : undefined,
      },
    ],
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={user} />
      <ViewTracker type="property" id={id} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="mx-auto max-w-3xl px-4 py-6">
        {/* 빵 부스러기 */}
        <nav className="mb-3 text-xs text-gray-400" aria-label="경로">
          <Link href="/" className="hover:text-blue-600">홈</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <Link href={`/broker/${prop.broker_id}`} className="hover:text-blue-600">{broker?.office_name ?? '중개사'}</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <span className="text-gray-700 dark:text-gray-300 font-medium">매물</span>
        </nav>

        {/* 이미지 영역 */}
        {prop.images && prop.images.length > 0 ? (
          <div className="mb-5">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-gray-100 dark:bg-gray-800">
              <Image src={prop.images[0]} alt={displayAddress} fill className="object-cover" sizes="(max-width: 768px) 100vw, 768px" priority />
              <div className="absolute right-3 top-3">
                <FavoriteButton type="property" id={id} initialFavorited={isFavorited} />
              </div>
              {hasPriceDrop && (
                <span className="absolute left-3 top-3 rounded-full bg-red-500 px-3 py-1 text-xs font-bold text-white shadow-lg">
                  ⬇️ 가격 인하
                </span>
              )}
            </div>
            {prop.images.length > 1 && (
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {prop.images.slice(1, 5).map((url: string, i: number) => (
                  <div key={i} className="relative aspect-square overflow-hidden rounded-lg">
                    <Image src={url} alt={`${displayAddress} 사진 ${i + 2}`} fill className="object-cover" sizes="200px" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mb-5 relative aspect-[16/10] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
            <Home className="h-16 w-16 text-gray-300" />
            <div className="absolute right-3 top-3">
              <FavoriteButton type="property" id={id} initialFavorited={isFavorited} />
            </div>
          </div>
        )}

        {/* 핵심 정보 */}
        <div className="mb-5">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {prop.deal_type && <Badge variant="info">{prop.deal_type}</Badge>}
            {prop.room_type && <Badge variant="default">{prop.room_type}</Badge>}
            {prop.status === 'contracted' && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">계약 완료</span>}
            {prop.status === 'hidden' && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">숨김</span>}
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{displayAddress}</h1>
          <p className="mt-1 text-2xl font-black text-blue-600">{priceText}</p>
          {prop.management_fee && <p className="mt-0.5 text-sm text-gray-500">관리비 {formatPrice(prop.management_fee)}</p>}
        </div>

        {/* 상세 스펙 */}
        <Card className="mb-5">
          <CardBody>
            <h2 className="mb-3 font-bold text-gray-900 dark:text-white">매물 정보</h2>
            <dl className="grid grid-cols-2 gap-y-2.5 text-sm">
              <Spec label="주소" value={displayAddress} />
              <Spec label="면적" value={prop.size_pyeong ? `${prop.size_pyeong}${prop.area_unit ?? '평'} (${prop.area_type ?? '전용'})` : null} />
              <Spec label="층" value={prop.floor != null ? `${prop.floor}층${prop.total_floors ? ` / 총 ${prop.total_floors}층` : ''}` : null} />
              <Spec label="방·욕실" value={prop.rooms_bathrooms} />
              <Spec label="방향" value={prop.direction} />
              <Spec label="주차" value={prop.parking} />
              <Spec label="입주 가능" value={prop.move_in_date} />
              <Spec label="사용 승인" value={prop.approval_date} />
              {prop.premium != null && prop.premium > 0 && <Spec label="권리금" value={formatPrice(prop.premium)} />}
            </dl>
          </CardBody>
        </Card>

        {/* 옵션 */}
        {prop.options && prop.options.length > 0 && (
          <Card className="mb-5">
            <CardBody>
              <h2 className="mb-3 font-bold text-gray-900 dark:text-white">옵션</h2>
              <div className="flex flex-wrap gap-1.5">
                {prop.options.map((opt: string) => (
                  <span key={opt} className="rounded-full bg-gray-100 dark:bg-gray-800 px-3 py-1 text-xs font-medium text-gray-700 dark:text-gray-300">{opt}</span>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        {/* 설명 */}
        {prop.description && (
          <Card className="mb-5">
            <CardBody>
              <h2 className="mb-3 font-bold text-gray-900 dark:text-white">매물 설명</h2>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">{prop.description}</p>
            </CardBody>
          </Card>
        )}

        {/* 가격 변동 히스토리 */}
        {priceHistory && priceHistory.length > 0 && (
          <Card className="mb-5">
            <CardBody>
              <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                {hasPriceDrop ? <TrendingDown className="h-4 w-4 text-red-500" /> : <TrendingUp className="h-4 w-4 text-gray-400" />}
                가격 변동 내역
              </h2>
              <ul className="space-y-2 text-sm">
                {priceHistory.map((h, i) => {
                  if (h.new_price == null || h.old_price == null) return null
                  const dropped = h.new_price < h.old_price
                  const diff = Math.abs(h.new_price - h.old_price)
                  return (
                    <li key={i} className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800 last:border-0">
                      <span className="text-xs text-gray-500">{formatDate(h.changed_at)}</span>
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 line-through">{formatPrice(h.old_price)}</span>
                        <span className="text-gray-400">→</span>
                        <span className="font-bold text-gray-900 dark:text-white">{formatPrice(h.new_price)}</span>
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${dropped ? 'bg-red-50 text-red-600' : 'bg-orange-50 text-orange-600'}`}>
                          {dropped ? '▼' : '▲'} {formatPrice(diff)}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardBody>
          </Card>
        )}

        {/* 중개사 정보 */}
        {broker && (
          <Link href={`/broker/${prop.broker_id}`}>
            <Card className="mb-5 hover:border-blue-300 transition-colors cursor-pointer">
              <CardBody>
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 text-lg font-bold">
                    {brokerProfile?.name?.[0] ?? 'B'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <h3 className="font-bold text-gray-900 dark:text-white truncate">{brokerProfile?.name ?? '공인중개사'}</h3>
                      {broker.is_verified && <ShieldCheck className="h-4 w-4 text-blue-500 flex-shrink-0" />}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{broker.office_name}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      {broker.rating > 0 && (
                        <span className="flex items-center gap-0.5 text-amber-500 font-semibold">
                          <Star className="h-3 w-3 fill-current" /> {Number(broker.rating).toFixed(1)}
                        </span>
                      )}
                      <span>후기 {broker.review_count ?? 0}</span>
                      {broker.deal_count > 0 && <span>거래 {broker.deal_count}</span>}
                      {broker.acceptance_rate != null && <span className="text-blue-600">수락 {broker.acceptance_rate}%</span>}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-300" />
                </div>
              </CardBody>
            </Card>
          </Link>
        )}

        {/* 같은 중개사 다른 매물 */}
        {otherProps && otherProps.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 font-bold text-gray-900 dark:text-white">{brokerProfile?.name} 중개사의 다른 매물</h2>
            <ul className="grid gap-3 sm:grid-cols-2">
              {otherProps.map((p: any) => (
                <li key={p.id}>
                  <PropertyCard
                    property={p}
                    href={`/property/${p.id}`}
                    size="md"
                    showBroker={false}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 신고 */}
        {user && (
          <div className="mb-4 flex justify-end">
            <ReportButton type="property" id={id} variant="text" />
          </div>
        )}

        <p className="text-center text-xs text-gray-400">
          빠방 인증 중개사가 등록한 매물 · {formatDate(prop.created_at)} 등록
        </p>
      </div>
    </div>
  )
}

function Spec({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800 dark:text-gray-100 text-right">{value}</dd>
    </>
  )
}
