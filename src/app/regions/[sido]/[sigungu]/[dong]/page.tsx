import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import Link from 'next/link'
import { MapPin, Clock, ChevronRight } from 'lucide-react'
import { formatPrice } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Params = { sido: string; sigungu: string; dong: string }

function dec(s: string) { return decodeURIComponent(s) }
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return '방금 전'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { sido, sigungu, dong } = await params
  const sidoN = dec(sido), sigunguN = dec(sigungu), dongN = dec(dong)
  const label = `${sidoN} ${sigunguN} ${dongN}`
  return {
    title: `${label} 부동산 매물 요청`,
    description: `${label}에서 진행 중인 부동산 매물 요청을 모아봤어요. 매매·전세·월세 실시간 요청, 인증 중개사 매칭.`,
    alternates: { canonical: `/regions/${sido}/${sigungu}/${dong}` },
    openGraph: {
      title: `${label} 부동산 매물 요청`,
      description: `${label}의 실시간 매물 요청과 인증 중개사를 한눈에`,
    },
  }
}

export default async function RegionDongPage({ params }: { params: Promise<Params> }) {
  const { sido, sigungu, dong } = await params
  const sidoN = dec(sido), sigunguN = dec(sigungu), dongN = dec(dong)
  const supabase = await createClient()

  const { data: requests } = await supabase.rpc('get_public_request_feed', {
    p_city: sidoN, p_district: sigunguN, p_dong: dongN, p_deal_type: null,
    p_limit: 12, p_offset: 0,
  })

  // 이 지역을 관심 지역으로 등록한 중개사 수 (전체 목록은 추후)
  const { count: brokerCount } = await supabase
    .from('broker_profiles')
    .select('id', { count: 'exact', head: true })
    .contains('alert_regions', [{ sido: sidoN, sigungu: sigunguN, dong: dongN }])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* breadcrumb */}
        <nav className="mb-3 text-xs text-gray-400">
          <Link href="/" className="hover:text-blue-600">홈</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <Link href={`/regions/${sido}`} className="hover:text-blue-600">{sidoN}</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <Link href={`/regions/${sido}/${sigungu}`} className="hover:text-blue-600">{sigunguN}</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <span className="text-gray-700 dark:text-gray-300 font-medium">{dongN}</span>
        </nav>

        <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2">
          <MapPin className="h-7 w-7 text-blue-600" />
          {sidoN} {sigunguN} {dongN}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          이 지역의 부동산 매물 요청을 실시간으로 보세요. 활성 요청 <span className="font-bold text-gray-800 dark:text-gray-100">{requests?.length ?? 0}</span>건 · 관심 등록 중개사 <span className="font-bold text-gray-800 dark:text-gray-100">{brokerCount ?? 0}</span>명
        </p>

        {/* CTA */}
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          <Link href={`/request/new?city=${encodeURIComponent(sidoN)}&district=${encodeURIComponent(sigunguN)}&dong=${encodeURIComponent(dongN)}`}
            className="rounded-2xl bg-blue-600 px-6 py-5 text-white hover:bg-blue-700 transition-colors">
            <p className="text-xs opacity-80 mb-1">고객</p>
            <p className="text-lg font-bold">{dongN}에서 집을 찾고 있어요</p>
            <p className="text-xs opacity-80 mt-1">조건만 올리면 중개사가 먼저 제안</p>
          </Link>
          <Link href={`/auth/signup?role=broker`}
            className="rounded-2xl border-2 border-blue-200 bg-white dark:bg-gray-900 px-6 py-5 hover:border-blue-400 transition-colors">
            <p className="text-xs text-blue-600 mb-1">중개사</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{dongN} 매물 등록·제안</p>
            <p className="text-xs text-gray-500 mt-1">관심 지역으로 등록하고 매칭 알림 받기</p>
          </Link>
        </div>

        {/* 요청 목록 */}
        <h2 className="mt-10 mb-3 text-lg font-bold text-gray-900 dark:text-white">{dongN} 최근 요청</h2>
        {(!requests || requests.length === 0) ? (
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-400">
            아직 이 지역에 활성 요청이 없어요. <Link href="/request/new" className="text-blue-600 hover:underline ml-1">첫 요청 등록하기</Link>
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {requests.map((r: any) => (
              <li key={r.id}>
                <Link href={`/auth/login?redirect=/request/${r.id}`}
                  className="block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-blue-300 hover:shadow-sm transition-all">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{r.deal_type || '거래'}</span>
                    <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400">{r.room_type || '매물'}</span>
                  </div>
                  <div className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
                    {r.min_price != null && r.max_price != null
                      ? <>{formatPrice(r.min_price)} ~ {formatPrice(r.max_price)}
                          {r.min_monthly != null && r.max_monthly != null && r.min_monthly > 0 && (
                            <span className="text-gray-500"> · 월 {r.min_monthly}만 ~ {r.max_monthly}만</span>
                          )}
                        </>
                      : <span className="text-gray-400">가격 미지정</span>}
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span><Clock className="inline h-3 w-3 mr-0.5" /> {timeAgo(r.created_at)}</span>
                    <span className="font-medium text-blue-600">{r.proposal_count ?? 0}개 제안</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-10 text-center">
          <Link href="/explore/requests" className="text-sm text-blue-600 hover:underline">
            전체 지역 요청 모아보기 →
          </Link>
        </div>
      </div>
    </div>
  )
}
