import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import Link from 'next/link'
import { MapPin, ChevronRight } from 'lucide-react'
import { formatPrice } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Params = { sido: string; sigungu: string }

function dec(s: string) { return decodeURIComponent(s) }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { sido, sigungu } = await params
  const sidoN = dec(sido), sigunguN = dec(sigungu)
  const label = `${sidoN} ${sigunguN}`
  return {
    title: `${label} 부동산 요청 모음`,
    description: `${label}의 동·읍·면별 실시간 부동산 매물 요청. 매매·전세·월세 모두.`,
    alternates: { canonical: `/regions/${sido}/${sigungu}` },
    openGraph: {
      title: `${label} 부동산 요청 모음`,
      description: `${label}의 실시간 매물 요청을 한곳에서`,
    },
  }
}

export default async function RegionSigunguPage({ params }: { params: Promise<Params> }) {
  const { sido, sigungu } = await params
  const sidoN = dec(sido), sigunguN = dec(sigungu)
  const supabase = await createClient()

  const { data: requests } = await supabase.rpc('get_public_request_feed', {
    p_city: sidoN, p_district: sigunguN, p_dong: null, p_deal_type: null,
    p_limit: 60, p_offset: 0,
  })

  // 동별 그룹화 (사용자가 동 단위로 진입할 수 있게)
  const byDong = new Map<string, { count: number; latest: string }>()
  for (const r of (requests ?? []) as Array<{ dong: string | null; created_at: string }>) {
    if (!r.dong) continue
    const cur = byDong.get(r.dong)
    if (!cur) byDong.set(r.dong, { count: 1, latest: r.created_at })
    else { cur.count += 1; if (r.created_at > cur.latest) cur.latest = r.created_at }
  }
  const dongs = Array.from(byDong.entries()).sort((a, b) => b[1].count - a[1].count)

  // 등록된 중개사 (이 사·군·구를 alert_regions에 가진)
  const { count: brokerCount } = await supabase
    .from('broker_profiles')
    .select('id', { count: 'exact', head: true })
    .contains('alert_regions', [{ sido: sidoN, sigungu: sigunguN }])

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav className="mb-3 text-xs text-gray-400">
          <Link href="/" className="hover:text-blue-600">홈</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <Link href={`/regions/${sido}`} className="hover:text-blue-600">{sidoN}</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <span className="text-gray-700 font-medium">{sigunguN}</span>
        </nav>

        <h1 className="text-3xl font-black text-gray-900 flex items-center gap-2">
          <MapPin className="h-7 w-7 text-blue-600" />
          {sidoN} {sigunguN}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          활성 요청 <span className="font-bold text-gray-800">{requests?.length ?? 0}</span>건 · 관심 등록 중개사 <span className="font-bold text-gray-800">{brokerCount ?? 0}</span>명
        </p>

        {/* 동·읍·면 카드 */}
        {dongs.length > 0 && (
          <>
            <h2 className="mt-8 mb-3 text-lg font-bold text-gray-900">동·읍·면별 요청</h2>
            <ul className="grid gap-3 md:grid-cols-3">
              {dongs.map(([dongName, info]) => (
                <li key={dongName}>
                  <Link
                    href={`/regions/${sido}/${sigungu}/${encodeURIComponent(dongName)}`}
                    className="block rounded-2xl border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-bold text-gray-900">{dongName}</h3>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">{info.count}건</span>
                    </div>
                    <p className="text-xs text-gray-400">최근: {new Date(info.latest).toLocaleDateString('ko-KR')}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className="mt-10 mb-3 text-lg font-bold text-gray-900">{sigunguN} 최근 요청</h2>
        {(!requests || requests.length === 0) ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
            아직 이 지역에 활성 요청이 없어요.
            <Link href={`/request/new?city=${encodeURIComponent(sidoN)}&district=${encodeURIComponent(sigunguN)}`} className="text-blue-600 hover:underline ml-1">
              첫 요청 등록하기
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {requests.slice(0, 12).map((r: any) => (
              <li key={r.id}>
                <Link href={`/auth/login?redirect=/request/${r.id}`}
                  className="block rounded-2xl border border-gray-200 bg-white p-5 hover:border-blue-300 hover:shadow-sm transition-all">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{r.deal_type || '거래'}</span>
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{r.room_type || '매물'}</span>
                    {r.dong && <span className="text-xs text-gray-500">{r.dong}</span>}
                  </div>
                  <div className="text-sm font-semibold text-gray-900">
                    {r.min_price != null && r.max_price != null
                      ? `${formatPrice(r.min_price)} ~ ${formatPrice(r.max_price)}`
                      : <span className="text-gray-400">가격 미지정</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
