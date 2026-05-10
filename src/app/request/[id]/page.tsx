import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDate, formatPrice, maskAddress } from '@/lib/utils'
import { MapPin, Clock, Star, MessageCircle, ChevronRight, Home, CheckCircle, Pencil, Archive } from 'lucide-react'
import { ProposalActions } from '@/components/proposal-actions'
import { CloseRequestButton } from '@/components/close-request-button'
import { ShareButton } from '@/components/share-button'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  let user: any = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch { /* 비로그인으로 표시 */ }

  let userRole: string | null = null
  let request: any = null
  let proposals: any[] = []

  try {
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      userRole = profile?.role ?? null
    }

    // 요청 데이터
    const { data: req } = await supabase
      .from('request_posts')
      .select('*, profiles(*)')
      .eq('id', id)
      .single()
    request = req

    // 제안 목록
    const { data: pr } = await supabase
      .from('proposals')
      .select('*, broker_profiles(*, profiles(*))')
      .eq('request_id', id)
      .order('created_at', { ascending: false })
    proposals = pr ?? []
  } catch (e: any) {
    if (e?.digest?.startsWith('NEXT_REDIRECT')) throw e
    /* 데이터 로드 실패 시 빈 상태 */
  }

  if (!request) notFound()

  const isOwner = user?.id === request.user_id

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role={userRole} />

      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* 요청 요약 카드 */}
        <Card className="mb-6">
          <CardBody>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {request.is_co_broker && (
                    <Badge variant="default" className="bg-purple-100 text-purple-700 border-purple-200">공동중개</Badge>
                  )}
                  {(request.deal_type?.split(',') ?? []).map((t: string) => (
                    <Badge key={t} variant="info">{t.trim()}</Badge>
                  ))}
                  {(request.room_type?.split(',') ?? []).map((t: string) => (
                    <Badge key={t} variant="default">{t.trim()}</Badge>
                  ))}
                  <Badge variant={request.status === 'active' ? 'success' : request.status === 'matched' ? 'info' : 'default'}>
                    {request.status === 'active' ? '모집 중' : request.status === 'matched' ? '매칭 완료' : request.status === 'closed' ? '마감' : '종료'}
                  </Badge>
                </div>
                <h1 className="text-xl font-bold text-gray-900">
                  {request.city} {request.district} · {request.deal_type?.split(',')?.[0]}
                </h1>
                <div className="mt-2 flex flex-wrap gap-4 text-sm text-gray-500">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" /> {request.district}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" /> {formatDate(request.created_at)}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-black text-blue-600">
                  {formatPrice(request.min_price)}~{formatPrice(request.max_price)}
                </div>
                {request.min_monthly && (
                  <div className="text-sm font-semibold text-gray-500 mt-0.5">
                    월세 {formatPrice(request.min_monthly)}~{formatPrice(request.max_monthly)}
                  </div>
                )}
                <div className="text-xs text-gray-400 mt-1">
                  제안 {proposals?.length ?? 0}개
                </div>
              </div>
            </div>

            {request.description && (
              <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
                {request.description}
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-4 text-sm text-gray-500">
              {request.min_size && <span>최소 {request.min_size}평</span>}
              {request.max_size && <span>최대 {request.max_size}평</span>}
              {request.move_in_date && <span>입주 희망: {request.move_in_date}</span>}
            </div>

            <div className="mt-4 flex justify-end">
              <ShareButton
                title={`${request.city} ${request.district} · ${request.deal_type?.split(',')?.[0]} 구합니다`}
                text={`빠방에서 ${request.city} ${request.district} 매물을 찾고 있어요. 제안해주세요!`}
                url={`https://bbabang.vercel.app/request/${id}`}
              />
            </div>
          </CardBody>
        </Card>

        {/* 마감된 요청 배너 */}
        {request.status === 'closed' && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Archive className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">마감된 요청입니다</p>
              <p className="text-xs text-amber-600">더 이상 새로운 제안을 받지 않으며, 이미 받은 제안들만 확인할 수 있습니다.</p>
            </div>
          </div>
        )}

        {/* 요청자용: 수정 + 마감 버튼 */}
        {isOwner && (
          <div className="mb-4 flex justify-end gap-2">
            {request.status === 'active' && (
              <CloseRequestButton requestId={id} />
            )}
            <Link href={`/request/${id}/edit`}>
              <Button variant="outline" size="sm">
                <Pencil className="mr-1.5 h-4 w-4" />
                요청 수정
              </Button>
            </Link>
          </div>
        )}

        {/* 중개사용: 제안하기 버튼 */}
        {userRole === 'broker' && request.status === 'active' && (
          <div className="mb-6">
            <Link href={`/request/${id}/propose`}>
              <Button variant="primary" size="lg" className="w-full">
                <Home className="mr-2 h-5 w-5" />
                이 고객에게 매물 제안하기
              </Button>
            </Link>
          </div>
        )}

        {/* 제안 목록 */}
        <div>
          <h2 className="mb-4 text-lg font-bold text-gray-900">
            중개사 제안 ({proposals?.length ?? 0}건)
          </h2>

          {(!proposals || proposals.length === 0) ? (
            <Card>
              <CardBody className="py-12 text-center">
                <Home className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                <p className="text-gray-500">아직 제안이 없습니다</p>
                <p className="mt-1 text-sm text-gray-400">인근 중개사들에게 알림이 발송됩니다</p>
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-4">
              {proposals.map((proposal: any) => {
                const broker = proposal.broker_profiles
                const brokerProfile = broker?.profiles

                return (
                  <Card key={proposal.id} hover>
                    <CardBody>
                      <div className="flex items-start gap-4">
                        {/* 중개사 아바타 */}
                        <Link href={`/broker/${broker?.id}`}>
                          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-lg hover:ring-2 hover:ring-blue-300 transition-all cursor-pointer">
                            {brokerProfile?.name?.[0] ?? 'B'}
                          </div>
                        </Link>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-bold text-gray-900">{brokerProfile?.name ?? '중개사'}</span>
                              {broker?.is_verified && (
                                <CheckCircle className="ml-1 inline h-4 w-4 text-blue-500" />
                              )}
                              <span className="ml-2 text-sm text-gray-500">{broker?.office_name}</span>
                            </div>
                            <div className="flex items-center gap-1 text-sm">
                              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                              <span className="font-semibold">{broker?.rating?.toFixed(1) ?? '신규'}</span>
                              <span className="text-gray-400">({broker?.review_count ?? 0})</span>
                            </div>
                          </div>

                          <div className="mt-1 text-xl font-black text-blue-600">
                            {formatPrice(proposal.price)}
                          </div>

                          {proposal.property_address && (
                            <div className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                              <MapPin className="h-3.5 w-3.5" />
                              {maskAddress(proposal.property_address)}
                            </div>
                          )}

                          <p className="mt-2 text-sm text-gray-600 line-clamp-2">
                            {proposal.description}
                          </p>

                          <div className="mt-3 flex items-center justify-between">
                            <span className="text-xs text-gray-400">{formatDate(proposal.created_at)}</span>

                            {isOwner && (
                              <ProposalActions
                                proposalId={proposal.id}
                                requestId={id}
                                currentStatus={proposal.status}
                                brokerId={broker?.user_id}
                                requestOwnerId={request.user_id}
                              />
                            )}
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
