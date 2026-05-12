import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatPrice } from '@/lib/utils'
import { Star, MessageCircle, MapPin, CheckCircle, Building2, Target, BarChart2, ThumbsUp, Users, ClipboardList } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BrokerRequestsFilter } from '@/components/broker-requests-filter'

export default async function BrokerDashboardPage() {
  const supabase = await createClient()

  let user: any = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    redirect('/auth/login?redirect=/dashboard/broker')
  }
  if (!user) redirect('/auth/login?redirect=/dashboard/broker')

  // ── 역할 확인 (redirect는 try/catch 밖에서 호출) ───────────
  const { data: profileData } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profileData || profileData.role !== 'broker') redirect('/dashboard/user')

  const { data: brokerData } = await supabase
    .from('broker_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()
  if (!brokerData) redirect('/broker/register')

  const profile = profileData
  const broker = brokerData

  const brokerDistricts: string[] = broker.district
    ? broker.district.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []

  // ── 부가 데이터 조회 (실패해도 빈 상태로 처리) ────────────
  let proposals: any[] = []
  let recentReviews: any[] = []

  try {
    const [{ data: pr }, { data: rv }] = await Promise.all([
      supabase
        .from('proposals')
        .select('*, request_posts(*, profiles(*))')
        .eq('broker_id', broker.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('reviews')
        .select('*, profiles(name)')
        .eq('broker_id', broker.id)
        .order('created_at', { ascending: false })
        .limit(3),
    ])
    proposals = pr ?? []
    recentReviews = rv ?? []
  } catch {
    // 부가 데이터 로드 실패 시 빈 상태로 렌더링
  }

  const statusLabel = { pending: '대기 중', accepted: '수락됨', rejected: '거절됨' }
  const statusVariant = { pending: 'warning', accepted: 'success', rejected: 'danger' } as const

  // ── 성과 지표 계산 ──────────────────────────────────
  const totalProposals = proposals.length
  const acceptedProposals = proposals.filter(p => p.status === 'accepted').length
  const rejectedProposals = proposals.filter(p => p.status === 'rejected').length
  const acceptanceRate = totalProposals > 0
    ? Math.round((acceptedProposals / totalProposals) * 100)
    : 0

  const now = new Date()
  const thisMonthProposals = proposals.filter(p => {
    const d = new Date(p.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  const acceptedWithPrice = proposals.filter(p => p.status === 'accepted' && p.price)
  const avgPrice = acceptedWithPrice.length > 0
    ? Math.round(acceptedWithPrice.reduce((sum, p) => sum + p.price, 0) / acceptedWithPrice.length)
    : 0

  // 최근 6개월 월별 제안 현황
  const monthlyStats = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const month = d.getMonth()
    const year = d.getFullYear()
    const total = proposals.filter(p => {
      const pd = new Date(p.created_at)
      return pd.getMonth() === month && pd.getFullYear() === year
    }).length
    const accepted = proposals.filter(p => {
      const pd = new Date(p.created_at)
      return pd.getMonth() === month && pd.getFullYear() === year && p.status === 'accepted'
    }).length
    return { label: `${d.getMonth() + 1}월`, total, accepted }
  })
  const maxMonthly = Math.max(...monthlyStats.map(m => m.total), 1)

  const rateColor = acceptanceRate >= 50
    ? 'text-green-600'
    : acceptanceRate >= 25
      ? 'text-yellow-600'
      : 'text-red-500'

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role="broker" />

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* 중개사 프로필 */}
        <Card className="mb-8">
          <CardBody>
            <div className="flex items-center gap-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 text-2xl font-black">
                {profile?.name?.[0]}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-gray-900">{profile?.name}</h1>
                  {broker.is_verified && (
                    <CheckCircle className="h-5 w-5 text-blue-500" />
                  )}
                </div>
                <p className="text-gray-500">{broker.office_name} · {brokerDistricts.join(' · ')}</p>
                <div className="mt-2 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-yellow-600">
                    <Star className="h-4 w-4 fill-yellow-400" />
                    <strong>{broker.rating?.toFixed(1) ?? '0.0'}</strong>
                    <span className="text-gray-400">({broker.review_count ?? 0})</span>
                  </span>
                  <span className="text-gray-500">성사 {broker.deal_count ?? 0}건</span>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* 빠른 메뉴 4타일 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/broker/customers">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-5 hover:border-blue-200 hover:bg-blue-50 transition-colors cursor-pointer shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-100">
                <Users className="h-5 w-5 text-indigo-600" />
              </div>
              <span className="text-sm font-bold text-gray-800">고객목록</span>
            </div>
          </Link>
          <Link href="/broker/properties">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-5 hover:border-blue-200 hover:bg-blue-50 transition-colors cursor-pointer shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-100">
                <Building2 className="h-5 w-5 text-blue-600" />
              </div>
              <span className="text-sm font-bold text-gray-800">매물목록</span>
            </div>
          </Link>
          <Link href="/broker/diary">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-5 hover:border-blue-200 hover:bg-blue-50 transition-colors cursor-pointer shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-100">
                <ClipboardList className="h-5 w-5 text-green-600" />
              </div>
              <span className="text-sm font-bold text-gray-800">업무일지</span>
            </div>
          </Link>
          <Link href="/broker/customers">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-5 hover:border-blue-200 hover:bg-blue-50 transition-colors cursor-pointer shadow-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100">
                <MessageCircle className="h-5 w-5 text-orange-600" />
              </div>
              <span className="text-sm font-bold text-gray-800">대화목록</span>
            </div>
          </Link>
        </div>


        {/* ── 성과 분석 ─────────────────────────────────── */}
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-blue-600" />
            <h2 className="font-bold text-gray-900">성과 분석</h2>
          </div>

          <div className="grid gap-4 md:grid-cols-3 mb-4">
            {/* 수락률 */}
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">제안 수락률</span>
                </div>
                <div className={`text-4xl font-black ${rateColor}`}>
                  {acceptanceRate}%
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  전체 {totalProposals}건 중 수락 {acceptedProposals}건 · 거절 {rejectedProposals}건
                </div>
                {/* 수락률 바 */}
                <div className="mt-3 h-2 w-full rounded-full bg-gray-100">
                  <div
                    className={`h-2 rounded-full transition-all ${
                      acceptanceRate >= 50 ? 'bg-green-500' : acceptanceRate >= 25 ? 'bg-yellow-400' : 'bg-red-400'
                    }`}
                    style={{ width: `${acceptanceRate}%` }}
                  />
                </div>
              </CardBody>
            </Card>

            {/* 이번 달 제안 */}
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <MessageCircle className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">이번 달 제안</span>
                </div>
                <div className="text-4xl font-black text-blue-600">
                  {thisMonthProposals}
                  <span className="text-lg font-medium text-gray-400">건</span>
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  {now.getMonth() + 1}월 기준
                </div>
              </CardBody>
            </Card>

            {/* 평균 성사가 */}
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsUp className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">수락된 제안 평균가</span>
                </div>
                <div className="text-3xl font-black text-gray-900">
                  {avgPrice > 0 ? formatPrice(avgPrice) : '-'}
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  수락된 {acceptedProposals}건 기준
                </div>
              </CardBody>
            </Card>
          </div>

          {/* 월별 제안 추이 */}
          <Card>
            <CardBody>
              <p className="mb-4 text-sm font-semibold text-gray-700">최근 6개월 제안 추이</p>
              <div className="flex items-end gap-3 h-28">
                {monthlyStats.map((m) => (
                  <div key={m.label} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-xs font-bold text-gray-500">
                      {m.total > 0 ? m.total : ''}
                    </span>
                    <div className="relative w-full flex flex-col justify-end" style={{ height: '80px' }}>
                      {/* 전체 제안 (연한 색) */}
                      <div
                        className="w-full rounded-t-lg bg-blue-100 absolute bottom-0"
                        style={{ height: `${Math.round((m.total / maxMonthly) * 80)}px` }}
                      />
                      {/* 수락된 제안 (진한 색) */}
                      <div
                        className="w-full rounded-t-lg bg-blue-500 absolute bottom-0"
                        style={{ height: `${Math.round((m.accepted / maxMonthly) * 80)}px` }}
                      />
                    </div>
                    <span className="text-xs text-gray-400">{m.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-500" />
                  수락된 제안
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-100" />
                  전체 제안
                </span>
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ── 최근 리뷰 ─────────────────────────────────── */}
        {recentReviews.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500 fill-yellow-400" />
                <h2 className="font-bold text-gray-900">최근 고객 리뷰</h2>
              </div>
              <Link href={`/broker/${broker.id}`} className="text-xs text-blue-600 hover:underline">
                전체 보기 →
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {recentReviews.map((review: any) => (
                <Card key={review.id}>
                  <CardBody className="py-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map(i => (
                          <Star
                            key={i}
                            className={`h-3.5 w-3.5 ${i <= review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-200'}`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">{formatDate(review.created_at)}</span>
                    </div>
                    {review.content && (
                      <p className="text-sm text-gray-600 line-clamp-2">{review.content}</p>
                    )}
                    <p className="mt-2 text-xs text-gray-400">{review.profiles?.name ?? '익명'}</p>
                  </CardBody>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-2">
          {/* 주변 신규 요청 */}
          <div id="nearby-requests">
            <BrokerRequestsFilter brokerDistricts={brokerDistricts} />
          </div>

          {/* 내 제안 현황 */}
          <div id="my-proposals">
            <h2 className="mb-4 font-bold text-gray-900">내 제안 현황</h2>
            <div className="space-y-3">
              {(!proposals || proposals.length === 0) ? (
                <Card>
                  <CardBody className="py-8 text-center text-sm text-gray-400">
                    아직 제안이 없습니다
                  </CardBody>
                </Card>
              ) : (
                proposals.slice(0, 8).map((proposal: any) => {
                  const req = proposal.request_posts
                  return (
                    <Link key={proposal.id} href={`/chat/${proposal.id}`}>
                      <Card hover>
                        <CardBody className="py-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <Badge variant={statusVariant[proposal.status as keyof typeof statusVariant]}>
                                {statusLabel[proposal.status as keyof typeof statusLabel]}
                              </Badge>
                              <div className="mt-1 font-bold text-gray-900">
                                {formatPrice(proposal.price)}
                              </div>
                              {req && (
                                <div className="mt-0.5 flex items-center gap-1 text-xs text-gray-400">
                                  <MapPin className="h-3.5 w-3.5" />
                                  {req.district} · {req.deal_type}
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-gray-400">{formatDate(proposal.created_at)}</span>
                          </div>
                        </CardBody>
                      </Card>
                    </Link>
                  )
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
