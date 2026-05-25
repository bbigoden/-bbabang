import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatPrice } from '@/lib/utils'
import { Star, MapPin, CheckCircle, Target, Clock, Calculator, MessageCircle, ThumbsUp, FileText } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BrokerRequestsFilter } from '@/components/broker-requests-filter'
import { BrokerChangeOffice } from '@/components/broker-change-office'
import { PushPrompt } from '@/components/push-prompt'
import { BrokerStatsPanel } from '@/components/broker/stats-panel'
import { calcSettlement, fmtComma } from '@/lib/settlement'

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
  let recommendedRequests: any[] = []
  let settlements: any[] = []

  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  try {
    const [{ data: pr }, { data: rv }, { data: rec }, { data: st }] = await Promise.all([
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
      supabase.rpc('recommend_requests_for_broker', { p_broker_id: broker.id, p_limit: 6 }),
      supabase
        .from('settlements')
        .select('id, settlement_rate, seller_fee, buyer_fee, withhold_exempt, vat_override')
        .eq('assignee_broker_id', broker.id)
        .eq('record_month', thisMonth),
    ])
    proposals = pr ?? []
    recentReviews = rv ?? []
    recommendedRequests = rec ?? []
    settlements = st ?? []
  } catch {
    // 부가 데이터 로드 실패 시 빈 상태로 렌더링
  }

  const statusLabel = { pending: '대기 중', accepted: '수락됨', rejected: '거절됨' }
  const statusVariant = { pending: 'warning', accepted: 'success', rejected: 'danger' } as const

  // ── 이번 달 정산 요약 ─────────────────────────────────
  const settlementSummary = settlements.reduce((acc, s) => {
    const c = calcSettlement(s)
    acc.total += c.total
    acc.assignee += c.assignee
    acc.count += 1
    return acc
  }, { total: 0, assignee: 0, count: 0 })

  // ── 성과분석 보조 지표 (이번 달 제안·평균 성사가·6개월 추이) ──
  const thisMonthProposals = proposals.filter(p => {
    const d = new Date(p.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length

  const acceptedWithPrice = proposals.filter(p => p.status === 'accepted' && p.price)
  const avgPrice = acceptedWithPrice.length > 0
    ? Math.round(acceptedWithPrice.reduce((sum, p) => sum + p.price, 0) / acceptedWithPrice.length)
    : 0
  const acceptedProposals = proposals.filter(p => p.status === 'accepted').length

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* 중개사 프로필 */}
        <Card className="mb-8">
          <CardBody>
            <div className="flex items-center gap-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 text-2xl font-black dark:bg-blue-500/20 dark:text-blue-400">
                {profile?.name?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">{profile?.name}</h1>
                  {broker.is_verified && (
                    <CheckCircle className="h-5 w-5 text-blue-500 flex-shrink-0" />
                  )}
                </div>
                <p className="text-gray-500 dark:text-gray-400 truncate">{broker.office_name} · {brokerDistricts.join(' · ')}</p>
                <div className="mt-2 flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                    <Star className="h-4 w-4 fill-yellow-400" />
                    <strong>{broker.rating?.toFixed(1) ?? '0.0'}</strong>
                    <span className="text-gray-400 dark:text-gray-500">({broker.review_count ?? 0})</span>
                  </span>
                  <span className="text-gray-500 dark:text-gray-400">성사 {broker.deal_count ?? 0}건</span>
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* 승인 대기 중 배너 — 미승인 직원에게만 표시 */}
        {broker.is_owner === false && broker.is_approved === false && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl bg-yellow-50 border border-yellow-200 px-5 py-4">
            <Clock className="h-5 w-5 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-yellow-800">승인 대기 중</p>
              <p className="text-xs text-yellow-600 mt-0.5">대표가 아직 등록 신청을 승인하지 않았어요. 대표에게 문의해주세요.</p>
            </div>
          </div>
        )}

        {/* 사무소 탈퇴 버튼 — 승인된 직원에게만 표시 */}
        {broker.is_owner === false && broker.is_approved === true && broker.parent_broker_id && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{broker.office_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">소속 사무소</p>
            </div>
            <BrokerChangeOffice brokerId={broker.id} parentBrokerId={broker.parent_broker_id} />
          </div>
        )}

        {/* ── 이번 달 정산 요약 ─────────────────────────────── */}
        <div className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-teal-600" />
              <h2 className="font-bold text-gray-900 dark:text-white">{now.getMonth() + 1}월 정산</h2>
              <span className="text-xs text-gray-400">· 내 담당 기준</span>
            </div>
            <Link href="/broker/settlement" className="text-xs text-blue-600 hover:underline">정산 전체 보기 →</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">계약 건수</span>
                </div>
                <div className="text-3xl font-black text-gray-900 dark:text-white">
                  {settlementSummary.count}
                  <span className="text-lg font-medium text-gray-400">건</span>
                </div>
                <div className="mt-2 text-xs text-gray-400">정산월 {thisMonth} 기준</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <Calculator className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">총수수료</span>
                </div>
                <div className="text-3xl font-black text-teal-600">
                  {fmtComma(settlementSummary.total)}
                  <span className="text-lg font-medium text-gray-400">원</span>
                </div>
                <div className="mt-2 text-xs text-gray-400">매도+매수 합계</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsUp className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">내 수수료</span>
                </div>
                <div className="text-3xl font-black text-blue-600">
                  {fmtComma(settlementSummary.assignee)}
                  <span className="text-lg font-medium text-gray-400">원</span>
                </div>
                <div className="mt-2 text-xs text-gray-400">담당자 몫 (원천 전)</div>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* ── 이번 달 영업 활동 (제안 건수·평균 성사가·6개월 추이) ── */}
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <MessageCircle className="h-5 w-5 text-blue-600" />
            <h2 className="font-bold text-gray-900 dark:text-white">이번 달 영업 활동</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3 mb-4">
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
                <div className="mt-2 text-xs text-gray-400">{now.getMonth() + 1}월 기준</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsUp className="h-4 w-4 text-gray-400" />
                  <span className="text-xs font-medium text-gray-500">수락된 제안 평균가</span>
                </div>
                <div className="text-3xl font-black text-gray-900 dark:text-white">
                  {avgPrice > 0 ? formatPrice(avgPrice) : '-'}
                </div>
                <div className="mt-2 text-xs text-gray-400">수락된 {acceptedProposals}건 기준</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <p className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">최근 6개월 제안 추이</p>
                <div className="flex items-end gap-2 h-20">
                  {monthlyStats.map((m) => (
                    <div key={m.label} className="flex flex-1 flex-col items-center gap-1">
                      <span className="text-[10px] font-bold text-gray-500">{m.total > 0 ? m.total : ''}</span>
                      <div className="relative w-full flex flex-col justify-end" style={{ height: '52px' }}>
                        <div className="w-full rounded-t bg-blue-100 absolute bottom-0" style={{ height: `${Math.round((m.total / maxMonthly) * 52)}px` }} />
                        <div className="w-full rounded-t bg-blue-500 absolute bottom-0" style={{ height: `${Math.round((m.accepted / maxMonthly) * 52)}px` }} />
                      </div>
                      <span className="text-[10px] text-gray-400">{m.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-500" />수락</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-100" />전체</span>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* ── 추천 요청 (AI 매칭) ─────────────────────────── */}
        {recommendedRequests.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-purple-600" />
                <h2 className="font-bold text-gray-900 dark:text-white">관심 지역 매칭 요청</h2>
                <Badge variant="warning">추천</Badge>
              </div>
              <Link href="/settings/notifications" className="text-xs text-gray-500 hover:text-blue-600">
                관심 지역 설정 →
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {recommendedRequests.map((r: any) => (
                <Link key={r.request_id} href={`/request/${r.request_id}`}
                  className="block rounded-2xl border border-purple-100 bg-white dark:bg-gray-900 p-4 hover:border-purple-300 hover:shadow-sm transition-all">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Badge variant="info">{r.deal_type || '거래'}</Badge>
                      <Badge variant="default">{r.room_type || '매물'}</Badge>
                    </div>
                    <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700">매칭 {r.score}</span>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                    {[r.city, r.district, r.dong].filter(Boolean).join(' ')}
                  </p>
                  <p className="text-xs text-gray-500 mb-2">
                    {r.min_price != null && r.max_price != null
                      ? `${formatPrice(r.min_price)} ~ ${formatPrice(r.max_price)}`
                      : '가격 미지정'}
                  </p>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{formatDate(r.created_at)}</span>
                    <span>{r.proposal_count}개 제안 중</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* ── 실적 분석 (구 '성과 분석' + '실적 분석' 통합) ──── */}
        <div className="mb-8">
          <BrokerStatsPanel />
        </div>

        {/* ── 최근 리뷰 ─────────────────────────────────── */}
        {recentReviews.length > 0 && (
          <div className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500 fill-yellow-400" />
                <h2 className="font-bold text-gray-900 dark:text-white">최근 고객 리뷰</h2>
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
                      <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{review.content}</p>
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
            <h2 className="mb-4 font-bold text-gray-900 dark:text-white">내 제안 현황</h2>
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
                              <div className="mt-1 font-bold text-gray-900 dark:text-white">
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
      <PushPrompt message="새 메시지·고객 매칭 알림을 받아보세요" />
    </div>
  )
}
