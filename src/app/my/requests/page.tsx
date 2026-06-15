import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { PageHeader } from '@/components/layout/page-header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatPrice } from '@/lib/utils'
import { Plus, FileText, MessageCircle, Archive } from 'lucide-react'
import { ReopenRequestButton } from '@/components/reopen-request-button'

export const dynamic = 'force-dynamic'

const statusLabel = { active: '모집 중', closed: '마감' }
const statusVariant = { active: 'success', closed: 'default' } as const

export default async function MyRequestsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirect=/my/requests')

  const { data } = await supabase
    .from('request_posts')
    .select('id, status, deal_type, room_type, city, district, min_price, max_price, proposal_count, created_at, closed_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  const requests = data ?? []
  const active = requests.filter(r => r.status !== 'closed')
  const closed = requests.filter(r => r.status === 'closed')

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          title="내 요청"
          description="내가 등록한 매물 요청과 받은 제안을 한곳에서 확인"
          actions={
            <Link href="/request/new" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              <Plus className="h-4 w-4" />
              요청 등록
            </Link>
          }
        />

        {requests.length === 0 ? (
          <Card>
            <CardBody className="py-16 text-center">
              <FileText className="mx-auto mb-4 h-12 w-12 text-gray-200" />
              <p className="font-semibold text-gray-700 dark:text-gray-300">아직 등록한 요청이 없어요</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">조건을 등록하면 중개사들이 매물을 제안합니다</p>
              <Link href="/request/new" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
                <Plus className="h-4 w-4" />첫 요청 등록하기
              </Link>
            </CardBody>
          </Card>
        ) : (
          <>
            {/* 진행 중인 요청 */}
            <h2 className="mb-4 font-bold text-gray-900 dark:text-white">진행 중인 요청 ({active.length})</h2>
            {active.length === 0 ? (
              <Card>
                <CardBody className="py-10 text-center text-sm text-gray-500">
                  진행 중인 요청이 없어요
                </CardBody>
              </Card>
            ) : (
              <div className="space-y-4">
                {active.map((req) => (
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
                            <h3 className="font-bold text-gray-900 dark:text-white">
                              {req.city} {req.district}
                            </h3>
                            <div className="mt-1 text-sm text-blue-600 font-semibold">
                              {formatPrice(req.min_price)} ~ {formatPrice(req.max_price)}
                            </div>
                            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
                              <span className="flex items-center gap-1">
                                <MessageCircle className="h-3.5 w-3.5" />
                                제안 {req.proposal_count ?? 0}건
                              </span>
                              <span>{formatDate(req.created_at)}</span>
                            </div>
                          </div>
                          <span className="flex-shrink-0 rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors">제안 보기</span>
                        </div>
                      </CardBody>
                    </Card>
                  </Link>
                ))}
              </div>
            )}

            {/* 마감된 요청 */}
            {closed.length > 0 && (
              <div className="mt-8">
                <div className="mb-4 flex items-center gap-2">
                  <Archive className="h-4 w-4 text-gray-500" />
                  <h2 className="font-bold text-gray-500">마감된 요청 ({closed.length})</h2>
                </div>
                <div className="space-y-3">
                  {closed.map((req) => (
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
                              <h3 className="font-semibold text-gray-700 dark:text-gray-300">
                                {req.city} {req.district}
                              </h3>
                              <div className="mt-1 text-sm text-gray-500">
                                {formatPrice(req.min_price)} ~ {formatPrice(req.max_price)}
                              </div>
                              <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                                <span className="flex items-center gap-1">
                                  <MessageCircle className="h-3.5 w-3.5" />
                                  제안 {req.proposal_count ?? 0}건
                                </span>
                                <span>마감: {formatDate(req.closed_at ?? req.created_at)}</span>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                              <ReopenRequestButton requestId={req.id} variant="compact" />
                              <span className="text-xs text-gray-500">기록 보기 →</span>
                            </div>
                          </div>
                        </CardBody>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
