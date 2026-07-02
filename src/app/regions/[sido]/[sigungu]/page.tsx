import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import Link from 'next/link'
import { MapPin, ChevronRight, Star, ShieldCheck, TrendingUp, HelpCircle } from 'lucide-react'
import { formatPrice } from '@/lib/utils'

export const dynamic = 'force-dynamic'

type Params = { sido: string; sigungu: string }

function dec(s: string) { return decodeURIComponent(s) }

const BASE_URL = 'https://bbabang.vercel.app'

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { sido, sigungu } = await params
  const sidoN = dec(sido), sigunguN = dec(sigungu)
  const label = `${sidoN} ${sigunguN}`
  return {
    title: `${label} 부동산 요청·중개사`,
    description: `${label} 실시간 매물 요청과 인증된 공인중개사. 매매·전세·월세 모두. 조건만 올리면 중개사가 먼저 제안합니다.`,
    alternates: { canonical: `/regions/${sido}/${sigungu}` },
    openGraph: {
      title: `${label} 부동산 요청·중개사`,
      description: `${label}에서 부동산 매물을 찾는다면 빠방`,
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

  // 동별 그룹화
  const byDong = new Map<string, { count: number; latest: string }>()
  const dealTypeCount = new Map<string, number>()
  const requestsArr = (requests ?? []) as Array<{ id: string; dong: string | null; created_at: string; deal_type: string | null; room_type: string | null; min_price: number | null; max_price: number | null }>
  for (const r of requestsArr) {
    if (r.dong) {
      const cur = byDong.get(r.dong)
      if (!cur) byDong.set(r.dong, { count: 1, latest: r.created_at })
      else { cur.count += 1; if (r.created_at > cur.latest) cur.latest = r.created_at }
    }
    const dt = r.deal_type?.split(',')[0]?.trim() ?? '기타'
    dealTypeCount.set(dt, (dealTypeCount.get(dt) ?? 0) + 1)
  }
  const dongs = Array.from(byDong.entries()).sort((a, b) => b[1].count - a[1].count)
  const dealTypes = Array.from(dealTypeCount.entries()).sort((a, b) => b[1] - a[1])

  // 인증 중개사 — 이 지역 담당 (district ILIKE) 인증된 상위 5
  const { data: brokers } = await supabase.rpc('get_public_brokers', {
    p_sido: sidoN, p_sigungu: sigunguN, p_only_verified: true,
    p_limit: 5, p_offset: 0,
  })

  // 관심 등록 중개사
  const { count: brokerCount } = await supabase
    .from('broker_profiles')
    .select('id', { count: 'exact', head: true })
    .contains('alert_regions', [{ sido: sidoN, sigungu: sigunguN }])

  // ── JSON-LD 구조화 데이터 ────────────────────────────
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: '홈', item: BASE_URL },
          { '@type': 'ListItem', position: 2, name: sidoN, item: `${BASE_URL}/regions/${sido}` },
          { '@type': 'ListItem', position: 3, name: sigunguN, item: `${BASE_URL}/regions/${sido}/${sigungu}` },
        ],
      },
      {
        '@type': 'Place',
        name: `${sidoN} ${sigunguN}`,
        address: {
          '@type': 'PostalAddress',
          addressRegion: sidoN,
          addressLocality: sigunguN,
          addressCountry: 'KR',
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: [
          { '@type': 'Question', name: `${sigunguN}에서 부동산 매물 어떻게 찾나요?`, acceptedAnswer: { '@type': 'Answer', text: '빠방에서 조건만 등록하면 인증된 공인중개사가 매물을 직접 제안합니다. 가입·요청 등록 모두 무료입니다.' } },
          { '@type': 'Question', name: `${sigunguN}에 등록된 중개사는 몇 명인가요?`, acceptedAnswer: { '@type': 'Answer', text: `현재 ${brokerCount ?? 0}명의 공인중개사가 이 지역을 담당하고 있습니다.` } },
          { '@type': 'Question', name: `${sigunguN} 어떤 매물이 가장 인기 있나요?`, acceptedAnswer: { '@type': 'Answer', text: dealTypes.length > 0 ? `최근 가장 많이 요청된 거래는 ${dealTypes[0][0]}입니다.` : '아직 데이터가 충분하지 않습니다.' } },
        ],
      },
    ],
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      {/* JSON-LD: 지역명 등 외부 입력 포함 → `<` 이스케이프로 </script> 브레이크아웃(XSS) 차단 */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <nav className="mb-3 text-xs text-gray-500" aria-label="경로">
          <Link href="/" className="hover:text-blue-600">홈</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <Link href={`/regions/${sido}`} className="hover:text-blue-600">{sidoN}</Link>
          <ChevronRight className="inline h-3 w-3 mx-1" />
          <span className="text-gray-700 dark:text-gray-300 font-medium">{sigunguN}</span>
        </nav>

        <h1 className="text-3xl font-black text-gray-900 dark:text-white flex items-center gap-2">
          <MapPin className="h-7 w-7 text-blue-600" />
          {sidoN} {sigunguN}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          활성 요청 <span className="font-bold text-gray-800 dark:text-gray-100">{requestsArr.length}</span>건 · 관심 등록 중개사 <span className="font-bold text-gray-800 dark:text-gray-100">{brokerCount ?? 0}</span>명
        </p>

        {/* CTA */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link href={`/request/new?city=${encodeURIComponent(sidoN)}&district=${encodeURIComponent(sigunguN)}`}
            className="flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 p-5 hover:bg-blue-100 transition-colors">
            <div>
              <p className="font-bold text-blue-900">{sigunguN} 매물 찾고 계세요?</p>
              <p className="mt-0.5 text-xs text-blue-700">조건만 올리면 중개사가 직접 제안 (무료)</p>
            </div>
            <ChevronRight className="h-5 w-5 text-blue-500" />
          </Link>
          <Link href="/auth/signup?role=broker"
            className="flex items-center justify-between rounded-2xl border border-purple-200 bg-purple-50 p-5 hover:bg-purple-100 transition-colors">
            <div>
              <p className="font-bold text-purple-900">{sigunguN} 중개사이신가요?</p>
              <p className="mt-0.5 text-xs text-purple-700">고객 요청을 실시간으로 받아보세요</p>
            </div>
            <ChevronRight className="h-5 w-5 text-purple-500" />
          </Link>
        </div>

        {/* 인증 중개사 */}
        {brokers && brokers.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
              <ShieldCheck className="h-5 w-5 text-blue-500" />
              {sigunguN} 인증 공인중개사
            </h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {brokers.map((b: any) => (
                <li key={b.id}>
                  <div
                    className="block rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <p className="font-bold text-gray-900 dark:text-white truncate flex-1">{b.office_name ?? '(상호 없음)'}</p>
                      <ShieldCheck className="h-3.5 w-3.5 text-blue-500" />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-500">
                      <span className="flex items-center gap-0.5 text-amber-600 font-semibold">
                        <Star className="h-3 w-3 fill-current" /> {Number(b.rating ?? 0).toFixed(1)}
                      </span>
                      <span>후기 {b.review_count ?? 0}</span>
                      {b.deal_count > 0 && <span>거래 {b.deal_count}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 인기 거래 유형 */}
        {dealTypes.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              {sigunguN} 인기 거래 유형
            </h2>
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
              <ul className="space-y-2.5">
                {dealTypes.map(([dt, count]) => {
                  const pct = Math.round((count / requestsArr.length) * 100)
                  return (
                    <li key={dt}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{dt}</span>
                        <span className="text-gray-500">{count}건 · <span className="font-bold text-gray-800 dark:text-gray-100">{pct}%</span></span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
        )}

        {/* 동·읍·면 카드 */}
        {dongs.length > 0 && (
          <section className="mt-10">
            <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">동·읍·면별 요청</h2>
            <ul className="grid gap-3 md:grid-cols-3">
              {dongs.map(([dongName, info]) => (
                <li key={dongName}>
                  <Link
                    href={`/regions/${sido}/${sigungu}/${encodeURIComponent(dongName)}`}
                    className="block rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-base font-bold text-gray-900 dark:text-white">{dongName}</h3>
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">{info.count}건</span>
                    </div>
                    <p className="text-xs text-gray-500">최근: {new Date(info.latest).toLocaleDateString('ko-KR')}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 최근 요청 */}
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-white">{sigunguN} 최근 요청</h2>
          {requestsArr.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-10 text-center text-sm text-gray-500">
              아직 이 지역에 활성 요청이 없어요.
              <Link href={`/request/new?city=${encodeURIComponent(sidoN)}&district=${encodeURIComponent(sigunguN)}`} className="text-blue-600 hover:underline ml-1">
                첫 요청 등록하기
              </Link>
            </div>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {requestsArr.slice(0, 12).map(r => (
                <li key={r.id}>
                  <Link href={`/auth/login?redirect=/request/${r.id}`}
                    className="block rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-blue-300 hover:shadow-sm transition-all">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{r.deal_type || '거래'}</span>
                      <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-500">{r.room_type || '매물'}</span>
                      {r.dong && <span className="text-xs text-gray-500">{r.dong}</span>}
                    </div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {r.min_price != null && r.max_price != null
                        ? `${formatPrice(r.min_price)} ~ ${formatPrice(r.max_price)}`
                        : <span className="text-gray-500">가격 미지정</span>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* FAQ */}
        <section className="mt-12 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-gray-900 dark:text-white">
            <HelpCircle className="h-5 w-5 text-gray-500" />
            {sigunguN} 부동산 FAQ
          </h2>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="font-semibold text-gray-800 dark:text-gray-100">Q. {sigunguN}에서 부동산 매물 어떻게 찾나요?</dt>
              <dd className="mt-1 text-gray-500">A. 빠방에서 조건만 등록하면 인증된 공인중개사가 직접 매물을 제안해드려요. 가입·요청 등록 모두 무료입니다.</dd>
            </div>
            <div>
              <dt className="font-semibold text-gray-800 dark:text-gray-100">Q. {sigunguN}에 등록된 중개사는 몇 명인가요?</dt>
              <dd className="mt-1 text-gray-500">A. 현재 {brokerCount ?? 0}명이 이 지역을 담당하고 있습니다.</dd>
            </div>
            {dealTypes.length > 0 && (
              <div>
                <dt className="font-semibold text-gray-800 dark:text-gray-100">Q. {sigunguN}에서 가장 많이 요청되는 거래는?</dt>
                <dd className="mt-1 text-gray-500">A. {dealTypes[0][0]}({dealTypes[0][1]}건)이 가장 많이 요청됐어요.</dd>
              </div>
            )}
          </dl>
        </section>
      </div>
    </div>
  )
}
