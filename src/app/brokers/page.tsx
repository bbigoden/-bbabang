import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { FavoriteButton } from '@/components/favorite-button'
import { SaveSearchButton } from '@/components/save-search-button'
import Link from 'next/link'
import { Filter, Clock, Target } from 'lucide-react'
import { OfficeCard } from '@/components/office-card'

function formatHours(h: number | null | undefined): string | null {
  if (h == null || h <= 0) return null
  if (h < 1) return `${Math.round(h * 60)}분`
  if (h < 24) return `${h.toFixed(1)}시간`
  return `${(h / 24).toFixed(1)}일`
}

export const metadata: Metadata = {
  title: '인증 공인중개사 둘러보기',
  description: '전국 인증 공인중개사를 한눈에. 지역·평점·후기로 필터링해서 신뢰할 수 있는 중개사를 찾으세요.',
  alternates: { canonical: '/brokers' },
}

export const dynamic = 'force-dynamic'

type Search = { sido?: string; sigungu?: string; verified?: string }

export default async function BrokersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams
  const supabase = await createClient()

  const { data: rows, error } = await supabase.rpc('get_public_brokers', {
    p_sido: sp.sido ?? null,
    p_sigungu: sp.sigungu ?? null,
    p_only_verified: sp.verified === '1',
    p_limit: 60,
    p_offset: 0,
  })

  // 로그인 사용자의 찜 목록을 한 번에 가져와 카드별 N+1 RTT 회피
  const { data: { user } } = await supabase.auth.getUser()
  let favSet = new Set<string>()
  if (user && rows && rows.length > 0) {
    const ids = rows.map((b: any) => b.id)
    const { data: favs } = await supabase
      .from('favorites')
      .select('target_id')
      .eq('user_id', user.id)
      .eq('target_type', 'broker')
      .in('target_id', ids)
    favSet = new Set((favs ?? []).map(f => f.target_id))
  }

  const filterActive = !!(sp.sido || sp.sigungu || sp.verified === '1')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900 dark:text-white">인증 공인중개사</h1>
          <p className="mt-1 text-sm text-gray-500">지역·평점으로 신뢰할 수 있는 중개사를 찾아보세요</p>
        </div>

        <form action="/brokers" method="GET" className="mb-5 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field name="sido" label="시·도" defaultValue={sp.sido} placeholder="예: 충청남도" />
            <Field name="sigungu" label="시·군·구" defaultValue={sp.sigungu} placeholder="예: 천안시 서북구" />
            <div className="flex items-center gap-2">
              <input type="checkbox" name="verified" value="1" defaultChecked={sp.verified === '1'}
                className="h-4 w-4 rounded border-gray-300 dark:border-gray-700 accent-blue-600" id="verified-only" />
              <label htmlFor="verified-only" className="text-sm text-gray-700 dark:text-gray-300">인증된 중개사만</label>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                <Filter className="inline h-3.5 w-3.5 mr-1" /> 필터
              </button>
              {filterActive && (
                <Link href="/brokers" className="rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">
                  초기화
                </Link>
              )}
              <SaveSearchButton
                target="broker"
                filters={{ sido: sp.sido ?? '', sigungu: sp.sigungu ?? '', verified: sp.verified === '1' }}
                defaultLabel={sp.sigungu ? `${sp.sigungu} 중개사` : sp.sido ? `${sp.sido} 중개사` : '인증 중개사'}
              />
            </div>
          </div>
        </form>

        <p className="mb-3 text-sm text-gray-500">총 <span className="font-bold text-gray-800 dark:text-gray-100">{rows?.length ?? 0}</span>명</p>

        {error ? (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">데이터 조회 실패</div>
        ) : !rows || rows.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-400">
            조건에 맞는 중개사가 없어요
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 list-none p-0">
            {rows.map((b: any) => (
              <li key={b.id} className="relative">
                <OfficeCard
                  variant="public"
                  theme="light"
                  href={`/broker/${b.id}`}
                  office={{
                    id: b.id,
                    office_name: b.office_name,
                    owner_name: b.user_name,
                    address: b.address,
                    is_verified: b.is_verified,
                    rating: b.rating,
                    review_count: b.review_count,
                  }}
                  rightSlot={<span />}
                  showChevron={false}
                  actionSlot={
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="text-gray-500">거래 {b.deal_count ?? 0}</span>
                      {b.acceptance_rate != null && (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
                          <Target className="h-3 w-3" /> 수락 {b.acceptance_rate}%
                        </span>
                      )}
                      {formatHours(b.avg_response_hours) && (
                        <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                          <Clock className="h-3 w-3" /> 평균 {formatHours(b.avg_response_hours)}
                        </span>
                      )}
                    </div>
                  }
                />
                <div className="absolute right-4 top-4 z-10">
                  <FavoriteButton type="broker" id={b.id} initialFavorited={favSet.has(b.id)} />
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 rounded-2xl bg-blue-50 border border-blue-100 p-6 text-center">
          <p className="text-sm text-blue-800 mb-2">중개사이신가요?</p>
          <p className="text-xs text-blue-600 mb-4">빠방에서 고객 요청을 직접 받아보세요</p>
          <Link href="/auth/signup?role=broker" className="inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            중개사 가입
          </Link>
        </div>
      </div>
    </div>
  )
}

function Field({ name, label, defaultValue, placeholder }: {
  name: string; label: string; defaultValue?: string; placeholder?: string
}) {
  return (
    <div className="flex-1 min-w-[140px]">
      <label className="mb-1 block text-xs font-semibold text-gray-500">{label}</label>
      <input name={name} defaultValue={defaultValue ?? ''} placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20" />
    </div>
  )
}
