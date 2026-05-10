import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, formatPrice } from '@/lib/utils'
import { Plus, Home, MessageCircle, Clock, Archive } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function UserDashboardPage() {
  let supabase: any
  let user: any = null

  try {
    supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e
    redirect('/auth/login?redirect=/dashboard/user')
  }
  if (!user) redirect('/auth/login?redirect=/dashboard/user')

  let profile: any = null
  let requests: any[] = []
  let unreadCount = 0
  try {
    // profiles와 request_posts는 서로 독립적 → 병렬 실행
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase
        .from('request_posts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false }),
    ])
    profile = p
    requests = r ?? []

    const requestIds = requests.map((req: any) => req.id)
    if (requestIds.length > 0) {
      const { count } = await supabase
        .from('proposals')
        .select('*', { count: 'exact', head: true })
        .in('request_id', requestIds)
        .eq('status', 'pending')
      unreadCount = count ?? 0
    }
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e
    // 데이터 로드 실패 시 빈 상태로 표시
  }

  const activeRequests = requests?.filter(r => r.status !== 'closed') ?? []
  const closedRequests = requests?.filter(r => r.status === 'closed') ?? []

  const statusLabel = { active: '모집 중', matched: '매칭 완료', closed: '마감' }
  const statusVariant = { active: 'success', matched: 'info', closed: 'default' } as const

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role={profile?.role} unreadCount={unreadCount} />

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* 상단 인사 */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              안녕하세요, {profile?.name ?? '회원'}님 👋
            </h1>
            <p className="mt-1 text-sm text-gray-500">내 방 찾기 현황을 확인하세요</p>
          </div>
          <Link href="/request/new" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            <Plus className="h-4 w-4" />
            새 요청 등록
          </Link>
        </div>

        {/* 요약 통계 */}
        <div className="mb-8 grid grid-cols-3 gap-4">
          {[
            { label: '전체 요청', value: requests?.length ?? 0, icon: Home, color: 'text-blue-600 bg-blue-50' },
            { label: '활성 요청', value: requests?.filter(r => r.status === 'active').length ?? 0, icon: Clock, color: 'text-green-600 bg-green-50' },
            { label: '받은 제안', value: requests?.reduce((acc, r) => acc + (r.proposal_count ?? 0), 0) ?? 0, icon: MessageCircle, color: 'text-purple-600 bg-purple-50' },
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

        {/* 활성 요청 목록 */}
        <h2 className="mb-4 font-bold text-gray-900">활성 요청</h2>

        {activeRequests.length === 0 ? (
          <Card>
            <CardBody className="py-16 text-center">
              <Home className="mx-auto mb-4 h-12 w-12 text-gray-200" />
              <p className="font-semibold text-gray-500">활성 요청이 없습니다</p>
              <p className="mt-1 text-sm text-gray-400">조건을 등록하면 중개사들이 매물을 제안합니다</p>
              <Link href="/request/new" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                <Plus className="h-4 w-4" />첫 요청 등록하기
              </Link>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-4">
            {activeRequests.map((req) => (
              <Link key={req.id} href={`/request/${req.id}`}>
                <Card hover>
                  <CardBody>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex flex-wrap gap-2 mb-2">
                          <Badge variant={statusVariant[req.status as keyof typeof statusVariant]}>
                            {statusLabel[req.status as keyof typeof statusLabel]}
                          </Badge>
                          {(req.deal_type?.split(',') ?? []).map((t: string) => (
                            <Badge key={t} variant="info">{t.trim()}</Badge>
                          ))}
                          {(req.room_type?.split(',') ?? []).slice(0, 2).map((t: string) => (
                            <Badge key={t} variant="default">{t.trim()}</Badge>
                          ))}
                        </div>
                        <h3 className="font-bold text-gray-900">
                          {req.city} {req.district}
                        </h3>
                        <div className="mt-1 text-sm text-blue-600 font-semibold">
                          {formatPrice(req.min_price)} ~ {formatPrice(req.max_price)}
                        </div>
                        <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                          <span className="flex items-center gap-1">
                            <MessageCircle className="h-3.5 w-3.5" />
                            제안 {req.proposal_count ?? 0}건
                          </span>
                          <span>{formatDate(req.created_at)}</span>
                        </div>
                      </div>
                      <span className="flex-shrink-0 rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">제안 보기</span>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        )}

        {/* 마감된 요청 */}
        {closedRequests.length > 0 && (
          <div className="mt-8">
            <div className="mb-4 flex items-center gap-2">
              <Archive className="h-4 w-4 text-gray-400" />
              <h2 className="font-bold text-gray-500">마감된 요청 ({closedRequests.length})</h2>
            </div>
            <div className="space-y-3">
              {closedRequests.map((req) => (
                <Link key={req.id} href={`/request/${req.id}`}>
                  <Card>
                    <CardBody className="opacity-60">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex flex-wrap gap-2 mb-2">
                            <Badge variant="default">마감</Badge>
                            {(req.deal_type?.split(',') ?? []).map((t: string) => (
                              <Badge key={t} variant="default">{t.trim()}</Badge>
                            ))}
                          </div>
                          <h3 className="font-semibold text-gray-700">
                            {req.city} {req.district}
                          </h3>
                          <div className="mt-1 text-sm text-gray-500">
                            {formatPrice(req.min_price)} ~ {formatPrice(req.max_price)}
                          </div>
                          <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                            <span className="flex items-center gap-1">
                              <MessageCircle className="h-3.5 w-3.5" />
                              제안 {req.proposal_count ?? 0}건
                            </span>
                            <span>마감: {formatDate(req.closed_at ?? req.created_at)}</span>
                          </div>
                        </div>
                        <span className="text-xs text-gray-400">기록 보기 →</span>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
