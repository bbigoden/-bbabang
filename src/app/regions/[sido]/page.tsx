import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import Link from 'next/link'
import { MapPin, ChevronRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

type Params = { sido: string }
function dec(s: string) { return decodeURIComponent(s) }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { sido } = await params
  const sidoN = dec(sido)
  return {
    title: `${sidoN} 부동산 요청·중개사`,
    description: `${sidoN}의 실시간 부동산 매물 요청과 인증 중개사를 시·군·구별로 둘러보세요.`,
    alternates: { canonical: `/regions/${sido}` },
    openGraph: {
      title: `${sidoN} 부동산 요청·중개사`,
      description: `${sidoN} 시·군·구별 실시간 매물 요청과 인증 중개사`,
    },
  }
}

export default async function RegionSidoPage({ params }: { params: Promise<Params> }) {
  const { sido } = await params
  const sidoN = dec(sido)
  const supabase = await createClient()

  const { data: requests } = await supabase.rpc('get_public_request_feed', {
    p_city: sidoN, p_district: null, p_dong: null, p_deal_type: null,
    p_limit: 100, p_offset: 0,
  })

  // 시·군·구별 그룹화
  const bySigungu = new Map<string, { count: number; dongs: Set<string> }>()
  for (const r of (requests ?? []) as Array<{ district: string | null; dong: string | null }>) {
    if (!r.district) continue
    const cur = bySigungu.get(r.district)
    if (!cur) bySigungu.set(r.district, { count: 1, dongs: new Set(r.dong ? [r.dong] : []) })
    else { cur.count += 1; if (r.dong) cur.dongs.add(r.dong) }
  }
  const sigungus = Array.from(bySigungu.entries()).sort((a, b) => b[1].count - a[1].count)

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav className="mb-3 text-xs text-gray-400">
          <Link href="/" className="hover:text-blue-600">홈</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <span className="text-gray-700 font-medium">{sidoN}</span>
        </nav>

        <h1 className="text-3xl font-black text-gray-900 flex items-center gap-2">
          <MapPin className="h-7 w-7 text-blue-600" />
          {sidoN}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          활성 요청 <span className="font-bold text-gray-800">{requests?.length ?? 0}</span>건이 진행 중. 시·군·구를 선택해 더 자세히 보세요.
        </p>

        {sigungus.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-400">
            아직 이 지역에 활성 요청이 없어요.
            <Link href="/request/new" className="text-blue-600 hover:underline ml-1">첫 요청 등록하기</Link>
          </div>
        ) : (
          <>
            <h2 className="mt-8 mb-3 text-lg font-bold text-gray-900">시·군·구별 요청</h2>
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {sigungus.map(([sigunguName, info]) => (
                <li key={sigunguName}>
                  <Link href={`/regions/${sido}/${encodeURIComponent(sigunguName)}`}
                    className="block rounded-2xl border border-gray-200 bg-white p-4 hover:border-blue-300 hover:shadow-sm transition-all">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-bold text-gray-900">{sigunguName}</h3>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">{info.count}건</span>
                    </div>
                    <p className="text-xs text-gray-500">{info.dongs.size}개 동·읍·면에서 요청</p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-10 rounded-2xl bg-blue-50 border border-blue-100 p-6 text-center">
          <Link href={`/request/new?city=${encodeURIComponent(sidoN)}`}
            className="inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            {sidoN}에서 부동산 요청 등록하기
          </Link>
        </div>
      </div>
    </div>
  )
}
