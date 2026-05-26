'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { FavoriteButton } from '@/components/favorite-button'
import { formatDate, formatPrice, maskAddressByType } from '@/lib/utils'
import { Heart, Building2, Home as HomeIcon, FileText, Star, MapPin, ShieldCheck, Clock } from 'lucide-react'

type Tab = 'broker' | 'property' | 'request'

interface FavRow {
  id: string
  target_type: Tab
  target_id: string
  created_at: string
}

export default function FavoritesPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [tab, setTab] = useState<Tab>('broker')
  const [favs, setFavs] = useState<FavRow[]>([])
  const [brokers, setBrokers] = useState<Record<string, any>>({})
  const [properties, setProperties] = useState<Record<string, any>>({})
  const [requests, setRequests] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) router.push('/auth/login?redirect=/favorites')
  }, [auth.loading, auth.user, router])

  const load = useCallback(async () => {
    if (!auth.user) return
    setLoading(true)
    const { data: favRows } = await supabase
      .from('favorites')
      .select('id, target_type, target_id, created_at')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })

    const rows = (favRows ?? []) as FavRow[]
    setFavs(rows)

    const brokerIds = rows.filter(r => r.target_type === 'broker').map(r => r.target_id)
    const propertyIds = rows.filter(r => r.target_type === 'property').map(r => r.target_id)
    const requestIds = rows.filter(r => r.target_type === 'request').map(r => r.target_id)

    const [bRes, pRes, rRes] = await Promise.all([
      brokerIds.length
        ? supabase.from('broker_profiles').select('id, office_name, address, district, rating, review_count, is_verified, profiles(name)').in('id', brokerIds)
        : Promise.resolve({ data: [] as any[] }),
      propertyIds.length
        ? supabase.from('broker_properties').select('id, address, deal_type, room_type, price, monthly_rent, status, images, broker_id, broker_profiles(office_name)').in('id', propertyIds)
        : Promise.resolve({ data: [] as any[] }),
      requestIds.length
        ? supabase.from('request_posts').select('id, city, district, dong, deal_type, room_type, min_price, max_price, proposal_count, status, created_at').in('id', requestIds)
        : Promise.resolve({ data: [] as any[] }),
    ])

    const bMap: Record<string, any> = {}; (bRes.data ?? []).forEach((x: any) => { bMap[x.id] = x })
    const pMap: Record<string, any> = {}; (pRes.data ?? []).forEach((x: any) => { pMap[x.id] = x })
    const rMap: Record<string, any> = {}; (rRes.data ?? []).forEach((x: any) => { rMap[x.id] = x })

    setBrokers(bMap)
    setProperties(pMap)
    setRequests(rMap)
    setLoading(false)
  }, [auth.user, supabase])

  useEffect(() => {
    if (!auth.user) return
    load()
  }, [auth.user, load])

  if (auth.loading || !auth.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  const counts = {
    broker: favs.filter(f => f.target_type === 'broker').length,
    property: favs.filter(f => f.target_type === 'property').length,
    request: favs.filter(f => f.target_type === 'request').length,
  }

  const tabFavs = favs.filter(f => f.target_type === tab)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <Heart className="h-6 w-6 fill-pink-500 text-pink-500" />
            찜 목록
          </h1>
          <p className="mt-1 text-sm text-gray-500">찜한 중개사·매물·요청을 모아봐요</p>
        </div>

        {/* 탭 */}
        <div className="mb-6 flex gap-2 overflow-x-auto" role="tablist" aria-label="찜 카테고리">
          {([
            { key: 'broker', label: '중개사', icon: Building2 },
            { key: 'property', label: '매물', icon: HomeIcon },
            { key: 'request', label: '요청', icon: FileText },
          ] as const).map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all flex-shrink-0 ${
                tab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              <t.icon className="h-4 w-4" />
              {t.label} {counts[t.key] > 0 && <span className={`ml-0.5 text-xs ${tab === t.key ? 'text-blue-100' : 'text-gray-400'}`}>{counts[t.key]}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : tabFavs.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-20 text-center">
            <Heart className="mx-auto mb-3 h-12 w-12 text-gray-200" />
            <p className="font-semibold text-gray-500">
              {tab === 'broker' && '찜한 중개사가 없어요'}
              {tab === 'property' && '찜한 매물이 없어요'}
              {tab === 'request' && '찜한 요청이 없어요'}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              {tab === 'broker' && <>마음에 드는 중개사 카드의 ♡ 버튼을 눌러 모아보세요</>}
              {tab === 'property' && <>관심 매물의 ♡ 버튼을 눌러 모아보세요</>}
              {tab === 'request' && <>관심 요청의 ♡ 버튼을 눌러 모아보세요</>}
            </p>
          </div>
        ) : tab === 'broker' ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {tabFavs.map(f => {
              const b = brokers[f.target_id]
              if (!b) return (
                <DeletedCard key={f.id} type="broker" id={f.target_id} onUnfav={load} />
              )
              return (
                <li key={f.id} className="relative">
                  <Link href={`/broker/${b.id}`}
                    className="block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-blue-300 hover:shadow-sm transition-all">
                    <div className="flex-1 min-w-0 pr-8">
                      <div className="flex items-center gap-1.5 mb-1">
                        <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{b.office_name || '(상호 없음)'}</h2>
                        {b.is_verified && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
                            <ShieldCheck className="h-3 w-3" /> 인증
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        <MapPin className="inline h-3 w-3 mr-0.5" /> {b.address || '주소 미공개'}
                      </p>
                      {b.profiles?.name && <p className="text-xs text-gray-400 mt-0.5">대표: {b.profiles.name}</p>}
                    </div>
                    <div className="mt-3 flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-0.5 text-amber-500 font-semibold">
                        <Star className="h-3.5 w-3.5 fill-current" /> {Number(b.rating ?? 0).toFixed(1)}
                      </span>
                      <span className="text-gray-500">후기 {b.review_count ?? 0}</span>
                    </div>
                  </Link>
                  <div className="absolute right-4 top-4">
                    <FavoriteButton type="broker" id={b.id} initialFavorited={true} />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : tab === 'property' ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {tabFavs.map(f => {
              const p = properties[f.target_id]
              if (!p) return (
                <DeletedCard key={f.id} type="property" id={f.target_id} onUnfav={load} />
              )
              return (
                <li key={f.id} className="relative rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden hover:border-blue-300 hover:shadow-sm transition-all">
                  <Link href={`/broker/${p.broker_id}`}>
                    {p.images?.[0] && (
                      <div className="relative h-32 w-full">
                        <Image src={p.images[0]} alt={p.address ?? ''} fill className="object-cover" sizes="(max-width: 640px) 100vw, 50vw" />
                      </div>
                    )}
                    <div className="p-4">
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {p.deal_type && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">{p.deal_type}</span>}
                        {p.room_type && <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-400">{p.room_type}</span>}
                        {p.status !== 'available' && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">{p.status === 'contracted' ? '계약완료' : '숨김'}</span>}
                      </div>
                      <p className="font-semibold text-gray-800 dark:text-gray-100 text-sm truncate">{p.address ? maskAddressByType(p.address, p.room_type) : '주소 미입력'}</p>
                      <p className="text-blue-600 font-black mt-1 text-sm">
                        {!p.price ? '가격 협의'
                          : p.deal_type === '월세' ? `보증금 ${formatPrice(p.price)} / 월 ${formatPrice(p.monthly_rent ?? 0)}`
                          : formatPrice(p.price)}
                      </p>
                      <p className="mt-1 text-xs text-gray-400 truncate">{p.broker_profiles?.office_name}</p>
                    </div>
                  </Link>
                  <div className="absolute right-3 top-3">
                    <FavoriteButton type="property" id={p.id} initialFavorited={true} />
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {tabFavs.map(f => {
              const r = requests[f.target_id]
              if (!r) return (
                <DeletedCard key={f.id} type="request" id={f.target_id} onUnfav={load} />
              )
              return (
                <li key={f.id} className="relative">
                  <Link href={`/request/${r.id}`}
                    className="block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-blue-300 hover:shadow-sm transition-all">
                    <div className="mb-2 flex items-center gap-2 pr-8">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{r.deal_type || '거래'}</span>
                      <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">{r.room_type || '매물'}</span>
                      {r.status === 'closed' && <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">마감</span>}
                    </div>
                    <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                      <MapPin className="h-3.5 w-3.5 text-gray-400" />
                      {[r.city, r.district, r.dong].filter(Boolean).join(' ') || '지역 미지정'}
                    </div>
                    <div className="mb-3 text-sm text-gray-700 dark:text-gray-300">
                      {r.min_price != null && r.max_price != null
                        ? <>{formatPrice(r.min_price)} ~ {formatPrice(r.max_price)}</>
                        : <span className="text-gray-400">가격 미지정</span>}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span><Clock className="inline h-3 w-3 mr-0.5" /> {formatDate(r.created_at)}</span>
                      <span className="font-medium text-blue-600">{r.proposal_count ?? 0}개 제안</span>
                    </div>
                  </Link>
                  <div className="absolute right-4 top-4">
                    <FavoriteButton type="request" id={r.id} initialFavorited={true} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function DeletedCard({ type, id, onUnfav }: { type: Tab; id: string; onUnfav: () => void }) {
  const supabase = useRef(createClient()).current
  const auth = useAuth()
  const [removing, setRemoving] = useState(false)
  const label = type === 'broker' ? '중개사' : type === 'property' ? '매물' : '요청'

  const remove = async () => {
    if (!auth.user || removing) return
    setRemoving(true)
    await supabase.from('favorites').delete()
      .eq('user_id', auth.user.id)
      .eq('target_type', type)
      .eq('target_id', id)
    onUnfav()
  }

  return (
    <li className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-5">
      <p className="text-sm font-semibold text-gray-500">삭제된 {label}</p>
      <p className="mt-1 text-xs text-gray-400">원본이 삭제되어 표시할 수 없어요</p>
      <button onClick={remove} disabled={removing}
        className="mt-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 disabled:opacity-50">
        {removing ? '삭제 중...' : '목록에서 빼기'}
      </button>
    </li>
  )
}
