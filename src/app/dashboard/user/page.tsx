import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatPrice } from '@/lib/utils'
import { Plus, Home, MessageCircle, Clock, Archive, ChevronRight, FileText, Users, MessageSquare, FileCheck } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function UserDashboardPage() {
  const supabase = await createClient()

  // ── 인증 확인 (redirect는 try/catch 밖에서 호출) ──────────
  let user: any = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    redirect('/auth/login?redirect=/dashboard/user')
  }
  if (!user) redirect('/auth/login?redirect=/dashboard/user')

  // ── 부가 데이터 조회 (실패해도 빈 상태로 처리) ────────────
  let profile: any = null
  let requests: any[] = []
  let unreadCount = 0
  try {
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
  } catch {
    // 데이터 로드 실패 시 빈 상태로 표시
  }

  // 고객(user) 전용 페이지 — 다른 역할은 본인 대시보드로 이동
  if (profile?.role === 'broker') redirect('/dashboard/broker')
  if (profile?.role === 'admin') redirect('/admin')

  const activeRequests = requests?.filter(r => r.status !== 'closed') ?? []
  const closedRequests = requests?.filter(r => r.status === 'closed') ?? []

  const statusLabel = { active: '모집 중', closed: '마감' }
  const statusVariant = { active: 'success', closed: 'default' } as const

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role={profile?.role} unreadCount={unreadCount} />

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* 상단 인사 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              안녕하세요, {profile?.name ?? '회원'}님 👋
            </h1>
            <p className="mt-1 text-sm text-gray-500">내 방 찾기 현황을 확인하세요</p>
          </div>
          <Link href="/request/new" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
            <Plus className="h-4 w-4" />
            요청 등록
          </Link>
        </div>

        {/* 이용 흐름 안내 */}
        <div className="mb-8 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
          <p className="mb-3 text-xs font-bold text-blue-500 uppercase tracking-wide">빠방 이용 흐름</p>
          <div className="flex items-center gap-1 overflow-x-auto">
            {[
              { icon: FileText, label: '요청 등록', desc: '조건 입력', active: activeRequests.length === 0 },
              { icon: Users, label: '제안 받기', desc: '중개사 제안', active: activeRequests.length > 0 && requests?.reduce((a, r) => a + (r.proposal_count ?? 0), 0) === 0 },
              { icon: MessageSquare, label: '대화목록', desc: '매물 협의', active: (requests?.reduce((a, r) => a + (r.proposal_count ?? 0), 0) ?? 0) > 0 },
              { icon: FileCheck, label: '계약', desc: '직접 진행', active: false },
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-1 flex-shrink-0">
                <div className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2 ${step.active ? 'bg-blue-600 text-white' : 'bg-white text-gray-500'}`}>
                  <step.icon className="h-4 w-4" />
                  <span className="text-xs font-bold">{step.label}</span>
                  <span className={`text-[10px] ${step.active ? 'text-blue-100' : 'text-gray-400'}`}>{step.desc}</span>
                </div>
                {i < 3 && <ChevronRight className="h-4 w-4 text-blue-300 flex-shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        {/* 활성 요청 목록 */}
        <h2 className="mb-4 font-bold text-gray-900">진행 중인 요청 ({activeRequests.length})</h2>

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
