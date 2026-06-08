import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { FavoriteButton } from '@/components/favorite-button'
import { SaveSearchButton } from '@/components/save-search-button'
import Link from 'next/link'
import { MapPin, Clock, Home as HomeIcon, Filter } from 'lucide-react'
import { formatPrice } from '@/lib/utils'

export const metadata: Metadata = {
  title: '실시간 부동산 요청 모아보기',
  description: '전국 부동산 요청을 한곳에서. 어떤 지역에서 어떤 매물을 찾고 있는지 실시간으로 확인하세요.',
  alternates: { canonical: '/explore/requests' },
}

// 정적 prerendering 끄고 매 요청마다 서버에서 fetch (검색·필터)
export const dynamic = 'force-dynamic'

type Search = {
  city?: string
  district?: string
  dong?: string
  deal_type?: string
}

function buildLabel(c?: string | null, d?: string | null, dong?: string | null) {
  return [c, d, dong].filter(Boolean).join(' ')
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금 전'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  const d = Math.floor(h / 24)
  return `${d}일 전`
}

export default async function ExploreRequestsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const supabase = await createClient()

  const { data: rows, error } = await supabase.rpc('get_public_request_feed', {
    p_city: sp.city ?? null,
    p_district: sp.district ?? null,
    p_dong: sp.dong ?? null,
    p_deal_type: sp.deal_type ?? null,
    p_limit: 60,
    p_offset: 0,
  })

  const { data: { user } } = await supabase.auth.getUser()
  let favSet = new Set<string>()
  if (user && rows && rows.length > 0) {
    const ids = rows.map((r: any) => r.id)
    const { data: favs } = await supabase
      .from('favorites')
      .select('target_id')
      .eq('user_id', user.id)
      .eq('target_type', 'request')
      .in('target_id', ids)
    favSet = new Set((favs ?? []).map(f => f.target_id))
  }

  const filterActive = !!(sp.city || sp.district || sp.dong || sp.deal_type)
  const total = (rows ?? []).length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">실시간 부동산 요청</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">전국에서 올라온 요청을 한곳에서 둘러보세요</p>
        </div>

        {/* 필터 */}
        <form action="/explore/requests" method="GET" className="mb-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <FilterField name="city" label="시·도" defaultValue={sp.city} placeholder="예: 충청남도" />
            <FilterField name="district" label="시·군·구" defaultValue={sp.district} placeholder="예: 천안시 서북구" />
            <FilterField name="dong" label="동·읍·면" defaultValue={sp.dong} placeholder="예: 불당동" />
            <FilterField name="deal_type" label="거래" defaultValue={sp.deal_type} placeholder="매매·전세·월세" />
            <div className="flex gap-2">
              <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                <Filter className="inline h-3.5 w-3.5 mr-1" /> 필터
              </button>
              {filterActive && (
                <Link href="/explore/requests" className="rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors">
                  초기화
                </Link>
              )}
              <SaveSearchButton
                target="request"
                filters={{ city: sp.city ?? '', district: sp.district ?? '', dong: sp.dong ?? '', deal_type: sp.deal_type ?? '' }}
                defaultLabel={[sp.dong, sp.district, sp.city, sp.deal_type].filter(Boolean).join(' ') || '관심 요청'}
              />
            </div>
          </div>
        </form>

        {/* 결과 */}
        <p className="mb-3 text-sm text-gray-500">총 <span className="font-bold text-gray-800 dark:text-gray-100">{total}</span>건</p>

        {error ? (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">데이터 조회 실패</div>
        ) : total === 0 ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-500">
            {filterActive ? '조건에 맞는 요청이 없어요' : '아직 등록된 요청이 없어요'}
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {(rows ?? []).map((r: any) => (
              <li key={r.id} className="relative">
                <Link href={user ? `/request/${r.id}` : `/auth/login?redirect=/request/${r.id}`}
                  className="block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-blue-300 hover:shadow-sm transition-all">
                  <div className="mb-2 flex items-center gap-2 pr-8">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{r.deal_type || '거래'}</span>
                    <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-500">{r.room_type || '매물'}</span>
                  </div>
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                    <MapPin className="h-3.5 w-3.5 text-gray-500" />
                    {buildLabel(r.city, r.district, r.dong) || '지역 미지정'}
                  </div>
                  <div className="mb-3 text-sm text-gray-700 dark:text-gray-300">
                    <HomeIcon className="inline h-3.5 w-3.5 text-gray-500 mr-1" />
                    {r.min_price != null && r.max_price != null
                      ? <>{formatPrice(r.min_price)} ~ {formatPrice(r.max_price)}
                          {r.min_monthly != null && r.max_monthly != null && r.min_monthly > 0 && (
                            <span className="text-gray-500"> · 월 {r.min_monthly}만 ~ {r.max_monthly}만</span>
                          )}
                        </>
                      : <span className="text-gray-500">가격 미지정</span>}
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span><Clock className="inline h-3 w-3 mr-0.5" /> {timeAgo(r.created_at)}</span>
                    <span className="font-medium text-blue-600">{r.proposal_count ?? 0}개 제안</span>
                  </div>
                </Link>
                <div className="absolute right-4 top-4">
                  <FavoriteButton type="request" id={r.id} initialFavorited={favSet.has(r.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 rounded-2xl bg-blue-50 border border-blue-100 p-6 text-center">
          <p className="text-sm text-blue-800 mb-2">내 조건도 등록해보세요</p>
          <p className="text-xs text-blue-600 mb-4">전국 중개사가 내 조건에 맞는 매물을 직접 제안합니다</p>
          <Link href="/request/new" className="inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            무료로 조건 등록하기
          </Link>
        </div>
      </div>
    </div>
  )
}

function FilterField({ name, label, defaultValue, placeholder }: {
  name: string; label: string; defaultValue?: string; placeholder?: string
}) {
  return (
    <div className="w-full sm:flex-1 sm:min-w-[140px]">
      <label className="mb-1 block text-xs font-semibold text-gray-500">{label}</label>
      <input name={name} defaultValue={defaultValue ?? ''} placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20" />
    </div>
  )
}
