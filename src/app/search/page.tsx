'use client'

import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { formatPrice, formatDate, maskAddress } from '@/lib/utils'
import { Search as SearchIcon, X, Building2, Home, FileText, MapPin, Star, ShieldCheck } from 'lucide-react'

interface BrokerHit {
  id: string
  office_name: string | null
  address: string | null
  rating: number | null
  review_count: number | null
  is_verified: boolean | null
  profiles: { name: string | null } | null
}
interface PropertyHit {
  id: string
  broker_id: string
  address: string | null
  deal_type: string | null
  room_type: string | null
  price: number | null
  monthly_rent: number | null
  images: string[] | null
  broker_profiles: { office_name: string | null; profiles: { name: string | null } | null } | null
}
interface RequestHit {
  id: string
  city: string | null
  district: string | null
  dong: string | null
  deal_type: string | null
  room_type: string | null
  min_price: number | null
  max_price: number | null
  proposal_count: number | null
  created_at: string
}

function SearchInner() {
  const router = useRouter()
  const sp = useSearchParams()
  const initialQ = sp.get('q') ?? ''
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const [query, setQuery] = useState(initialQ)
  const [debounced, setDebounced] = useState(initialQ)
  const [loading, setLoading] = useState(false)
  const [brokers, setBrokers] = useState<BrokerHit[]>([])
  const [properties, setProperties] = useState<PropertyHit[]>([])
  const [requests, setRequests] = useState<RequestHit[]>([])

  // 디바운스
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])

  // URL 동기화
  useEffect(() => {
    const u = new URL(window.location.href)
    if (debounced) u.searchParams.set('q', debounced)
    else u.searchParams.delete('q')
    window.history.replaceState(null, '', u.toString())
  }, [debounced])

  const search = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setBrokers([]); setProperties([]); setRequests([])
      return
    }
    setLoading(true)
    const like = `%${q}%`
    const [bRes, pRes, rRes] = await Promise.all([
      supabase
        .from('broker_profiles')
        .select('id, office_name, address, rating, review_count, is_verified, profiles!inner(name)')
        .or(`office_name.ilike.${like},address.ilike.${like},district.ilike.${like}`)
        .eq('is_verified', true)
        .limit(10),
      supabase
        .from('broker_properties')
        .select('id, broker_id, address, deal_type, room_type, price, monthly_rent, images, broker_profiles(office_name, profiles(name))')
        .ilike('address', like)
        .eq('status', 'available')
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('request_posts')
        .select('id, city, district, dong, deal_type, room_type, min_price, max_price, proposal_count, created_at')
        .or(`city.ilike.${like},district.ilike.${like},dong.ilike.${like},deal_type.ilike.${like},room_type.ilike.${like}`)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    setBrokers((bRes.data ?? []) as any)
    setProperties((pRes.data ?? []) as any)
    setRequests((rRes.data ?? []) as any)
    setLoading(false)
  }, [supabase])

  useEffect(() => { search(debounced) }, [debounced, search])

  const total = brokers.length + properties.length + requests.length
  const hasQuery = debounced.length >= 2

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-4xl px-4 py-6">
        <div className="mb-5 relative">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="지역·매물·중개사 통합 검색 (예: 강남구, 원룸, 부동산)"
            className="w-full rounded-2xl border border-gray-200 bg-white pl-11 pr-11 py-3.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="지우기"
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {!hasQuery ? (
          <div className="rounded-2xl border border-gray-200 bg-white py-16 text-center">
            <SearchIcon className="mx-auto mb-3 h-12 w-12 text-gray-200" />
            <p className="font-semibold text-gray-500">검색어를 2자 이상 입력해주세요</p>
            <p className="mt-1 text-sm text-gray-400">중개사 · 매물 · 요청을 한 번에 찾아드려요</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : total === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white py-16 text-center">
            <SearchIcon className="mx-auto mb-3 h-12 w-12 text-gray-200" />
            <p className="font-semibold text-gray-500">"{debounced}"에 대한 결과가 없어요</p>
            <p className="mt-1 text-sm text-gray-400">다른 키워드로 검색해보세요</p>
          </div>
        ) : (
          <div className="space-y-8">
            {brokers.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900">
                  <Building2 className="h-4 w-4 text-purple-500" />
                  중개사 <span className="text-purple-600">{brokers.length}</span>
                </h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {brokers.map(b => (
                    <li key={b.id}>
                      <Link href={`/broker/${b.id}`}
                        className="block rounded-2xl border border-gray-200 bg-white p-4 hover:border-purple-300 hover:shadow-sm transition-all">
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="font-bold text-gray-900 truncate flex-1">{b.profiles?.name ?? '(이름 없음)'}</p>
                          {b.is_verified && <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />}
                        </div>
                        <p className="text-xs text-gray-500 truncate">{b.office_name}</p>
                        <p className="text-xs text-gray-400 truncate"><MapPin className="inline h-3 w-3 mr-0.5" />{b.address}</p>
                        <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-400">
                          <span className="flex items-center gap-0.5 text-amber-500 font-semibold">
                            <Star className="h-3 w-3 fill-current" /> {Number(b.rating ?? 0).toFixed(1)}
                          </span>
                          <span>후기 {b.review_count ?? 0}</span>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {properties.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900">
                  <Home className="h-4 w-4 text-emerald-500" />
                  매물 <span className="text-emerald-600">{properties.length}</span>
                </h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {properties.map(p => (
                    <li key={p.id}>
                      <Link href={`/broker/${p.broker_id}`}
                        className="block rounded-2xl border border-gray-200 bg-white overflow-hidden hover:border-emerald-300 hover:shadow-sm transition-all">
                        {p.images?.[0] && (
                          <div className="relative h-28 w-full">
                            <Image src={p.images[0]} alt="" fill className="object-cover" sizes="(max-width: 640px) 100vw, 50vw" />
                          </div>
                        )}
                        <div className="p-4">
                          <div className="flex flex-wrap gap-1.5 mb-1.5">
                            {p.deal_type && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">{p.deal_type}</span>}
                            {p.room_type && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{p.room_type}</span>}
                          </div>
                          <p className="text-sm font-semibold text-gray-800 truncate">{maskAddress(p.address)}</p>
                          <p className="mt-1 text-sm font-black text-blue-600">
                            {!p.price ? '가격 협의'
                              : p.deal_type === '월세' ? `${formatPrice(p.price)} / 월 ${formatPrice(p.monthly_rent ?? 0)}`
                              : formatPrice(p.price)}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-400 truncate">{p.broker_profiles?.profiles?.name} · {p.broker_profiles?.office_name}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {requests.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900">
                  <FileText className="h-4 w-4 text-blue-500" />
                  요청 <span className="text-blue-600">{requests.length}</span>
                </h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {requests.map(r => (
                    <li key={r.id}>
                      <Link href={`/request/${r.id}`}
                        className="block rounded-2xl border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {r.deal_type && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">{r.deal_type}</span>}
                          {r.room_type && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{r.room_type}</span>}
                        </div>
                        <p className="text-sm font-semibold text-gray-900 flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-gray-400" />
                          {[r.city, r.district, r.dong].filter(Boolean).join(' ') || '지역 미지정'}
                        </p>
                        {r.min_price != null && r.max_price != null && (
                          <p className="mt-0.5 text-sm text-blue-600 font-semibold">
                            {formatPrice(r.min_price)} ~ {formatPrice(r.max_price)}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center justify-between text-xs text-gray-400">
                          <span className="text-blue-500 font-medium">{r.proposal_count ?? 0}개 제안</span>
                          <span>{formatDate(r.created_at)}</span>
                        </div>
                      </Link>
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

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    }>
      <SearchInner />
    </Suspense>
  )
}
