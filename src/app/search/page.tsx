'use client'

import { useEffect, useState, useRef, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { PropertyCard } from '@/components/property-card'
import { formatPrice, formatDate } from '@/lib/utils'
import { Search as SearchIcon, X, Home, FileText, MapPin } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'

interface PropertyHit {
  id: string
  broker_id: string
  address: string | null
  deal_type: string | null
  room_type: string | null
  price: number | null
  monthly_rent: number | null
  images: string[] | null
  broker_profiles: { office_name: string | null } | null
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
  const _router = useRouter()
  const sp = useSearchParams()
  const initialQ = sp.get('q') ?? ''
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const [query, setQuery] = useState(initialQ)
  const [debounced, setDebounced] = useState(initialQ)
  const [loading, setLoading] = useState(false)
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
      setProperties([]); setRequests([])
      return
    }
    setLoading(true)
    const like = `%${q}%`
    const [pRes, rRes] = await Promise.all([
      supabase
        .from('public_properties')
        // 중개사 실명은 조회만 하고 화면엔 쓰지 않았다 — 공개 화면은 사무소명까지다
        .select('id, seq_no, broker_id, address, deal_type, room_type, price, monthly_rent, images, broker_profiles(office_name)')
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
    setProperties((pRes.data ?? []) as any)
    setRequests((rRes.data ?? []) as any)
    setLoading(false)
  }, [supabase])

  useEffect(() => { search(debounced) }, [debounced, search])

  const total = properties.length + requests.length
  const hasQuery = debounced.length >= 2

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="sr-only">통합 검색</h1>
        <div className="mb-5 relative">
          <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-500" />
          <input
            autoFocus
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="지역·매물 통합 검색 (예: 강남구, 원룸)"
            className="w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 pl-11 pr-11 py-3.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="지우기"
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 hover:text-gray-700 dark:text-gray-300">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {!hasQuery ? (
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
            <SearchIcon className="mx-auto mb-3 h-12 w-12 text-gray-200" />
            <p className="font-semibold text-gray-700 dark:text-gray-300">검색어를 2자 이상 입력해주세요</p>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">매물 · 요청을 한 번에 찾아드려요</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="md" />
          </div>
        ) : total === 0 ? (
          <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 py-16 text-center">
            <SearchIcon className="mx-auto mb-3 h-12 w-12 text-gray-200" />
            <p className="font-semibold text-gray-500">&quot;{debounced}&quot;에 대한 결과가 없어요</p>
            <p className="mt-1 text-sm text-gray-500">다른 키워드로 검색해보세요</p>
          </div>
        ) : (
          <div className="space-y-8">
            {properties.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                  <Home className="h-4 w-4 text-emerald-500" />
                  매물 <span className="text-emerald-600">{properties.length}</span>
                </h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {properties.map(p => (
                    <li key={p.id}>
                      <PropertyCard property={p} href={`/property/${p.id}`} size="sm" />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {requests.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                  <FileText className="h-4 w-4 text-blue-500" />
                  요청 <span className="text-blue-600">{requests.length}</span>
                </h2>
                <ul className="grid gap-2 md:grid-cols-2">
                  {requests.map(r => (
                    <li key={r.id}>
                      <Link href={`/request/${r.id}`}
                        className="block rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {r.deal_type && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">{r.deal_type}</span>}
                          {r.room_type && <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-gray-500">{r.room_type}</span>}
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5 text-gray-500" />
                          {[r.city, r.district, r.dong].filter(Boolean).join(' ') || '지역 미지정'}
                        </p>
                        {r.min_price != null && r.max_price != null && (
                          <p className="mt-0.5 text-sm text-blue-600 font-semibold">
                            {formatPrice(r.min_price)} ~ {formatPrice(r.max_price)}
                          </p>
                        )}
                        <div className="mt-1.5 flex items-center justify-between text-xs text-gray-500">
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Spinner size="md" />
      </div>
    }>
      <SearchInner />
    </Suspense>
  )
}
