'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { FavoriteButton } from '@/components/favorite-button'
import { PropertyCard } from '@/components/property-card'
import { formatPrice } from '@/lib/utils'
import { Sparkles, FileText, Heart, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'

interface Match {
  property: any
  request: any
  reasons: string[]
}

interface RequestRow {
  id: string
  city: string | null
  district: string | null
  dong: string | null
  deal_type: string | null
  room_type: string | null
  min_price: number | null
  max_price: number | null
  status: string
}

export default function RecommendationsPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [loading, setLoading] = useState(true)
  const [activeRequests, setActiveRequests] = useState<RequestRow[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [favSet, setFavSet] = useState<Set<string>>(new Set())
  const [favBrokerMatches, setFavBrokerMatches] = useState<any[]>([])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) router.push('/auth/login?redirect=/recommendations')
  }, [auth.loading, auth.user, router])

  const load = useCallback(async () => {
    if (!auth.user) return
    setLoading(true)

    // 1) 내 활성 요청
    const { data: reqs } = await supabase
      .from('request_posts')
      .select('id, city, district, dong, deal_type, room_type, min_price, max_price, status')
      .eq('user_id', auth.user.id)
      .eq('status', 'active')

    const requests = (reqs ?? []) as RequestRow[]
    setActiveRequests(requests)

    // 2) 각 요청 조건과 매물 매칭
    const allMatches: Match[] = []
    const seenProperties = new Set<string>()

    for (const req of requests) {
      // 지역 매칭 — district 또는 city를 address에 ILIKE
      const region = req.dong || req.district || req.city
      if (!region) continue

      // 가격 필터 (max_price 이하)
      let q = supabase
        .from('broker_properties')
        .select('*, broker_profiles(office_name, is_verified, profiles(name))')
        .eq('status', 'available')
        .ilike('address', `%${region}%`)
        .order('created_at', { ascending: false })
        .limit(20)

      if (req.max_price) q = q.lte('price', req.max_price)

      const { data: props } = await q
      ;(props ?? []).forEach((p: any) => {
        if (seenProperties.has(p.id)) return
        // 거래유형이 다른 매물 제외 — 요청·매물 모두 콤마 멀티값 지원 (예: "매매, 월세")
        const reqDeals = (req.deal_type ?? '').split(',').map(t => t.trim()).filter(Boolean)
        const propDeals = (p.deal_type ?? '').split(',').map((t: string) => t.trim()).filter(Boolean)
        const dealMatched = reqDeals.length === 0 || propDeals.length === 0 || reqDeals.some(t => propDeals.includes(t))
        if (!dealMatched) return
        seenProperties.add(p.id)
        const reasons: string[] = []
        reasons.push(`'${region}' 지역 매칭`)
        if (reqDeals.length > 0 && propDeals.length > 0) {
          reasons.push(`거래 유형 ${p.deal_type}`)
        }
        if (req.room_type && p.room_type && req.room_type.split(',').some(t => t.trim() === p.room_type)) {
          reasons.push(`매물 유형 ${p.room_type}`)
        }
        if (req.max_price && p.price && p.price <= req.max_price) {
          reasons.push(`가격 ${formatPrice(p.price)} (예산 내)`)
        }
        allMatches.push({ property: p, request: req, reasons })
      })
    }
    setMatches(allMatches.slice(0, 30))

    // 3) 찜한 중개사의 최신 매물
    const { data: favBrokers } = await supabase
      .from('favorites')
      .select('target_id')
      .eq('user_id', auth.user.id)
      .eq('target_type', 'broker')

    const favBrokerIds = (favBrokers ?? []).map(f => f.target_id)
    let brokerProps: any[] = []
    if (favBrokerIds.length > 0) {
      const { data } = await supabase
        .from('broker_properties')
        .select('*, broker_profiles(office_name, is_verified, profiles(name))')
        .eq('status', 'available')
        .in('broker_id', favBrokerIds)
        .order('created_at', { ascending: false })
        .limit(12)
      brokerProps = data ?? []
    }
    setFavBrokerMatches(brokerProps)

    // 4) 매물 찜 상태 일괄 체크 — setState 직전 로컬 값 사용 (stale state 회피)
    const allPropIds = [
      ...allMatches.slice(0, 30).map(m => m.property.id),
      ...brokerProps.map(p => p.id),
    ]
    if (allPropIds.length > 0) {
      const { data: favs } = await supabase
        .from('favorites')
        .select('target_id')
        .eq('user_id', auth.user.id)
        .eq('target_type', 'property')
        .in('target_id', allPropIds)
      setFavSet(new Set((favs ?? []).map(f => f.target_id)))
    }

    setLoading(false)
  }, [auth.user, supabase])

  useEffect(() => {
    if (auth.user) load()
  }, [auth.user, load])

  if (auth.loading || !auth.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  const hasAnyContent = matches.length > 0 || favBrokerMatches.length > 0

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          icon={Sparkles}
          iconColor="text-amber-500"
          title="추천 매물"
          description="내 요청·찜한 중개사 기반 맞춤 매물"
        />

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : !hasAnyContent ? (
          <EmptyState hasActiveRequests={activeRequests.length > 0} />
        ) : (
          <div className="space-y-8">
            {/* 내 요청 매칭 */}
            {matches.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                  <FileText className="h-4 w-4 text-blue-500" />
                  내 요청과 맞는 매물 <span className="text-blue-600">{matches.length}</span>
                </h2>
                <ul className="grid gap-3 md:grid-cols-2">
                  {matches.map((m, i) => (
                    <PropertyMatchCard key={`${m.property.id}-${i}`} match={m} favorited={favSet.has(m.property.id)} />
                  ))}
                </ul>
              </section>
            )}

            {/* 찜한 중개사 매물 */}
            {favBrokerMatches.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                  <Heart className="h-4 w-4 text-pink-500 fill-current" />
                  찜한 중개사의 최신 매물 <span className="text-pink-600">{favBrokerMatches.length}</span>
                </h2>
                <ul className="grid gap-3 md:grid-cols-2">
                  {favBrokerMatches.map(p => (
                    <li key={p.id}>
                      <PropertyCard
                        property={p}
                        href={`/property/${p.id}`}
                        size="md"
                        overlay={<FavoriteButton type="property" id={p.id} initialFavorited={favSet.has(p.id)} />}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function PropertyMatchCard({ match, favorited }: { match: Match; favorited: boolean }) {
  const p = match.property
  return (
    <li>
      <PropertyCard
        property={p}
        href={`/property/${p.id}`}
        size="lg"
        overlay={<FavoriteButton type="property" id={p.id} initialFavorited={favorited} />}
        footer={match.reasons.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {match.reasons.slice(0, 3).map((r, i) => (
              <span key={i} className="inline-flex items-center gap-0.5 rounded-md bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                <Sparkles className="h-2.5 w-2.5" />
                {r}
              </span>
            ))}
          </div>
        ) : undefined}
      />
    </li>
  )
}

function EmptyState({ hasActiveRequests }: { hasActiveRequests: boolean }) {
  return (
    <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50">
        <Sparkles className="h-7 w-7 text-amber-500" />
      </div>
      {!hasActiveRequests ? (
        <>
          <p className="font-semibold text-gray-700 dark:text-gray-300">아직 추천할 매물이 없어요</p>
          <p className="mt-1 text-sm text-gray-500">매물 요청을 등록하면 조건에 맞는 매물을 추천해드려요</p>
          <Link href="/request/new"
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            <Plus className="h-4 w-4" />
            첫 요청 등록하기
          </Link>
        </>
      ) : (
        <>
          <p className="font-semibold text-gray-700 dark:text-gray-300">조건에 맞는 매물이 아직 없어요</p>
          <p className="mt-1 text-sm text-gray-500">중개사가 매물을 등록하면 자동으로 추천해드려요</p>
        </>
      )}
    </div>
  )
}
