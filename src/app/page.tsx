import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody } from '@/components/ui/card'
import { AutoRedirectHome } from '@/components/auto-redirect-home'
import { SiteBanner, FeaturedMain } from '@/components/site-curation'
import {
  Search, ArrowRight, CheckCircle, Star, MessageCircle,
  Shield, TrendingUp, Users, Clock, Home
} from 'lucide-react'

// 공개 랜딩 페이지는 정적 렌더링 — 로그인 사용자 redirect는 proxy.ts가 처리
// CDN 캐시 가능 → 첫 방문자 TTFB 대폭 단축
export const dynamic = 'force-static'
// 콘텐츠 자체는 거의 안 바뀌지만 메타/링크 정도는 배포 후 자동 갱신용
export const revalidate = 3600

export default function LandingPage() {
  // 정적 페이지라 user/role은 항상 null (비로그인용 콘텐츠).
  // 로그인 사용자는 proxy.ts(서버) 또는 AutoRedirectHome(클라이언트)이 대시보드로 보냄.
  const user = null
  const userRole: string | null = null

  return (
    <div className="min-h-screen">
      {/* 관리자가 메인 노출 관리에서 켠 상단 띠 배너 (클라이언트 후수화) */}
      <SiteBanner />
      {/* Header에 prop 안 넘김 → AuthContext에서 자동 인식 (bfcache 대응) */}
      <Header />
      {/* 로그인 사용자가 bfcache 등으로 / 로 돌아오면 적절한 대시보드로 자동 이동 */}
      <AutoRedirectHome />

      {/* 히어로 섹션 */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 px-4 py-24 text-white">
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
        <div className="relative mx-auto max-w-4xl text-center">
          <h1 className="mb-6 text-4xl font-extrabold leading-tight tracking-tight md:text-6xl">
            내 조건을 올리면<br />
            <span className="text-yellow-300">중개사가 먼저 제안합니다</span>
          </h1>
          <p className="mb-10 text-lg text-blue-100 md:text-xl">
            더 이상 발품 팔지 마세요.<br />
            전국 인증 중개사들이 내 조건에 딱 맞는 매물을 찾아드립니다.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {userRole === 'broker' ? (
              <Link href="/dashboard/broker" className="inline-flex items-center gap-2 rounded-xl bg-white dark:bg-gray-900 px-8 py-3.5 text-base font-bold text-blue-700 hover:bg-blue-50 shadow-lg transition-colors">
                중개사 대시보드로 이동
                <ArrowRight className="h-5 w-5" />
              </Link>
            ) : (
              <>
                <Link href="/request/new" className="inline-flex items-center gap-2 rounded-xl bg-white dark:bg-gray-900 px-8 py-3.5 text-base font-bold text-blue-700 hover:bg-blue-50 shadow-lg transition-colors">
                  무료로 조건 등록하기
                  <ArrowRight className="h-5 w-5" />
                </Link>
                {!user && (
                  <Link href="/auth/signup?role=broker" className="inline-flex items-center gap-2 rounded-xl border border-white px-8 py-3.5 text-base font-semibold text-white hover:bg-white/10 transition-colors">
                    중개사로 시작하기
                  </Link>
                )}
              </>
            )}
          </div>

          {/* 신뢰 지표 */}
          <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-blue-200">
            <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-400" /> 가입비 무료</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-400" /> 인증 중개사만</span>
            <span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4 text-green-400" /> 24시간 이내 제안</span>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link href="/explore/requests" className="text-blue-100 hover:text-white underline-offset-4 hover:underline">
              실시간 요청 둘러보기 →
            </Link>
          </div>
        </div>
      </section>

      {/* 작동 방식 */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">이렇게 작동해요</h2>
            <p className="mt-3 text-gray-500">3단계로 내 방 찾기 완성</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                step: '01',
                icon: Search,
                title: '조건 등록',
                desc: '지역, 예산, 평수, 거래유형을 입력하세요. 3분이면 충분합니다.',
                color: 'bg-blue-50 text-blue-600',
              },
              {
                step: '02',
                icon: MessageCircle,
                title: '제안 받기',
                desc: '인증 중개사들이 조건에 맞는 매물을 직접 제안합니다.',
                color: 'bg-green-50 text-green-600',
              },
              {
                step: '03',
                icon: CheckCircle,
                title: '선택하기',
                desc: '여러 제안을 비교하고 마음에 드는 중개사와 채팅하세요.',
                color: 'bg-purple-50 text-purple-600',
              },
            ].map((item) => (
              <Card key={item.step} className="relative p-2" hover>
                <CardBody>
                  <span aria-hidden="true" className="text-5xl font-black text-gray-500 dark:text-gray-500 absolute top-4 right-5 pointer-events-none select-none">{item.step}</span>
                  <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl ${item.color}`}>
                    <item.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mb-2 text-lg font-bold text-gray-900 dark:text-white">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">{item.desc}</p>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* 왜 부소장? */}
      <section className="bg-white dark:bg-gray-900 px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">왜 부소장인가요?</h2>
            <p className="mt-3 text-gray-500">기존 부동산 플랫폼과 완전히 다릅니다</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {/* 기존 vs 부소장 비교 */}
            <Card className="border-red-100">
              <CardBody>
                <h3 className="mb-4 font-bold text-red-600 dark:text-red-400">😩 기존 플랫폼</h3>
                <ul className="space-y-3 text-sm text-gray-600 dark:text-gray-500">
                  {[
                    '수백 개 매물을 직접 찾아다녀야 함',
                    '허위매물에 낚여 시간 낭비',
                    '중개사 비교가 불가능',
                    '내 정보가 여러 곳에 노출',
                    '연락이 와도 원하는 매물이 없음',
                  ].map((text) => (
                    <li key={text} className="flex items-start gap-2">
                      <span className="mt-0.5 text-red-400">✕</span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
            <Card className="border-blue-100 bg-blue-50/30">
              <CardBody>
                <h3 className="mb-4 font-bold text-blue-600">✨ 부소장</h3>
                <ul className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
                  {[
                    '중개사가 먼저 내 조건에 맞는 매물 제안',
                    '인증된 중개사만 활동 (허위매물 차단)',
                    '평점·리뷰로 중개사 비교 선택',
                    '내가 원하는 중개사에게만 연락',
                    '24시간 내 여러 제안 수신',
                  ].map((text) => (
                    <li key={text} className="flex items-start gap-2">
                      <span className="mt-0.5 text-blue-500">✓</span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>
        </div>
      </section>

      {/* 관리자가 고른 추천 사무소·매물 (있을 때만 노출) */}
      <FeaturedMain />

      {/* 통계 */}
      <section className="bg-gradient-to-r from-blue-600 to-indigo-700 px-4 py-16 text-white">
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-8 text-center md:grid-cols-4">
            {[
              { icon: Users, value: '2,400+', label: '인증 중개사' },
              { icon: Home, value: '18,000+', label: '성사 건수' },
              { icon: Star, value: '4.8', label: '평균 만족도' },
              { icon: Clock, value: '8시간', label: '평균 첫 제안 시간' },
            ].map((stat) => (
              <div key={stat.label}>
                <stat.icon className="mx-auto mb-2 h-6 w-6 text-blue-200" />
                <div className="text-3xl font-black">{stat.value}</div>
                <div className="mt-1 text-sm text-blue-200">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 중개사 섹션 - 비로그인 or 중개사만 표시 */}
      {(!user || userRole === 'broker') && <section className="px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-center gap-10 md:flex-row">
            <div className="flex-1">
              <Badge variant="info" className="mb-4">공인중개사 전용</Badge>
              <h2 className="mb-4 text-3xl font-bold text-gray-900 dark:text-white">
                중개사님,<br />
                고객이 먼저 찾아옵니다
              </h2>
              <p className="mb-6 text-gray-700 dark:text-gray-300 leading-relaxed">
                더 이상 매물 홍보에 광고비를 쏟지 마세요.<br />
                부소장에서는 원하는 매물이 있는 고객에게만 제안할 수 있습니다.
              </p>
              <ul className="mb-8 space-y-3 text-sm">
                {[
                  { icon: TrendingUp, text: '월 기본 10건 무료 제안' },
                  { icon: Shield, text: '자격증 인증으로 신뢰도 상승' },
                  { icon: Star, text: '리뷰 누적으로 자연스러운 홍보' },
                ].map((item) => (
                  <li key={item.text} className="flex items-center gap-3 text-gray-700 dark:text-gray-300">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
                      <item.icon className="h-4 w-4 text-blue-600" />
                    </div>
                    {item.text}
                  </li>
                ))}
              </ul>
              {userRole === 'broker' ? (
                <Link href="/dashboard/broker" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white hover:bg-blue-700 transition-colors">
                  중개사 대시보드로 이동
                  <ArrowRight className="h-5 w-5" />
                </Link>
              ) : !user ? (
                <Link href="/auth/signup?role=broker" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-base font-semibold text-white hover:bg-blue-700 transition-colors">
                  중개사로 무료 가입하기
                  <ArrowRight className="h-5 w-5" />
                </Link>
              ) : null}
            </div>
            <div className="flex-1">
              <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-blue-50 p-8 border border-gray-100 dark:border-gray-800">
                <h3 className="mb-6 font-bold text-gray-700 dark:text-gray-300 text-sm">실시간 요청 현황</h3>
                <div className="space-y-3">
                  {[
                    { area: '강남구', type: '전세', budget: '5억~7억', time: '방금 전', rooms: '아파트' },
                    { area: '마포구', type: '월세', budget: '100/80만', time: '12분 전', rooms: '투룸' },
                    { area: '송파구', type: '매매', budget: '9억~12억', time: '31분 전', rooms: '아파트' },
                    { area: '용산구', type: '전세', budget: '3억~4억', time: '1시간 전', rooms: '원룸' },
                  ].map((req, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-white dark:bg-gray-900 p-3 shadow-sm border border-gray-50">
                      <div>
                        <span className="font-semibold text-sm text-gray-900 dark:text-white">{req.area}</span>
                        <span className="mx-2 text-gray-300">|</span>
                        <span className="text-xs text-gray-500">{req.rooms} {req.type}</span>
                        <div className="mt-0.5 text-xs font-medium text-blue-600">{req.budget}</div>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-500">{req.time}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-500">* 예시 데이터입니다</p>
              </div>
            </div>
          </div>
        </div>
      </section>}

      {/* CTA */}
      <section className="px-4 py-20 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-3xl font-bold text-gray-900 dark:text-white">지금 바로 시작하세요</h2>
          <p className="mb-8 text-gray-500">가입비, 광고비 없이 조건만 올리면 중개사가 찾아옵니다</p>
          <Link href="/request/new" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-10 py-3.5 text-base font-semibold text-white hover:bg-blue-700 transition-colors">
            무료로 조건 등록하기
            <ArrowRight className="h-5 w-5" />
          </Link>
        </div>
      </section>

      {/* 푸터는 글로벌 Footer 컴포넌트(layout.tsx)가 렌더 — 사업자정보·법적표기 포함 */}
    </div>
  )
}
