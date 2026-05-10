import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatPrice } from '@/lib/utils'
import { Star, TrendingUp, MessageCircle, MapPin, CheckCircle, Building2 } from 'lucide-react'
// formatDate, Badge, formatPrice used in proposals section
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

  let profile: any = null
  let broker: any = null
  let proposals: any[] = []
  let activeRequests: any[] = []
  let brokerDistricts: string[] = []

  try {
    const { data: p } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    profile = p
    if (profile?.role !== 'broker') redirect('/dashboard/user')

    const { data: b } = await supabase
      .from('broker_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()
    broker = b
    if (!broker) redirect('/broker/register')

    brokerDistricts = broker.district
      ? broker.district.split(',').map((s: string) => s.trim()).filter(Boolean)
      : []

    // proposals와 activeRequests는 서로 독립적 → 병렬 실행
    const [{ data: pr }, { data: ar }] = await Promise.all([
      supabase
        .from('proposals')
        .select('*, request_posts(*, profiles(*))')
        .eq('broker_id', broker.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('request_posts')
        .select('*, profiles(*)')
        .in('district', brokerDistricts.length > 0 ? brokerDistricts : [''])
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    proposals = pr ?? []
    activeRequests = ar ?? []
  } catch (e: any) {
    // Next.js redirect는 다시 throw
    if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e
    // 데이터 로드 실패 시 빈 상태로 표시
  }

  if (!broker) redirect('/broker/register')

  const statusLabel = { pending: '대기 중', accepted: '수락됨', rejected: '거절됨' }
  const statusVariant = { pending: 'warning', accepted: 'success', rejected: 'danger' } as const

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

        {/* 매물장 바로가기 */}
        <Link href="/broker/properties">
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 hover:bg-blue-100 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="font-bold text-gray-900">내 매물장</p>
                <p className="text-xs text-gray-500">등록한 매물을 채팅에서 바로 공유하세요</p>
              </div>
            </div>
            <span className="text-sm font-semibold text-blue-600">관리하기 →</span>
          </div>
        </Link>

        {/* 통계 */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          {[
            { label: '내 제안', value: proposals?.length ?? 0, icon: MessageCircle, color: 'text-blue-600 bg-blue-50' },
            { label: '수락된 제안', value: proposals?.filter(p => p.status === 'accepted').length ?? 0, icon: CheckCircle, color: 'text-green-600 bg-green-50' },
            { label: '주변 요청', value: activeRequests?.length ?? 0, icon: TrendingUp, color: 'text-purple-600 bg-purple-50' },
          ].map((stat) => (
            <Card key={stat.label}>
              <CardBody className="flex items-center gap-4">
                <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-black text-gray-900">{stat.value}</div>
                  <div className="text-xs text-gray-500">{stat.label}</div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          {/* 주변 신규 요청 (필터/검색 포함) */}
          <BrokerRequestsFilter brokerDistricts={brokerDistricts} />

          {/* 내 제안 현황 */}
          <div>
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
                    <Card key={proposal.id} hover>
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
