import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, formatPrice } from '@/lib/utils'
import { MessageCircle, Clock } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

export default async function ChatListPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  const isBroker = profile?.role === 'broker'

  let chatRooms: any[] = []

  if (isBroker) {
    // 중개사: 본인 broker_profile로 연결된 proposals
    const { data: broker } = await supabase
      .from('broker_profiles')
      .select('id')
      .eq('user_id', user.id)
      .single()

    if (broker) {
      const { data } = await supabase
        .from('proposals')
        .select(`
          id, status, price, created_at,
          request_posts(id, district, deal_type, room_type, min_price, max_price, profiles(name, email))
        `)
        .eq('broker_id', broker.id)
        .order('created_at', { ascending: false })

      chatRooms = data ?? []
    }
  } else {
    // 일반 유저: 본인 요청에 달린 수락된 제안들
    const { data } = await supabase
      .from('proposals')
      .select(`
        id, status, price, created_at,
        request_posts!inner(id, district, deal_type, room_type, min_price, max_price, user_id),
        broker_profiles(id, office_name, profiles(name))
      `)
      .eq('request_posts.user_id', user.id)
      .order('created_at', { ascending: false })

    chatRooms = data ?? []
  }

  // ── 읽지 않은 메시지 수 계산 ──────────────────────────────
  const proposalIds = chatRooms.map((p: any) => p.id)
  let unreadMap: Record<string, number> = {}

  if (proposalIds.length > 0) {
    const { data: rooms } = await supabase
      .from('chat_rooms')
      .select('id, proposal_id')
      .in('proposal_id', proposalIds)

    if (rooms && rooms.length > 0) {
      const roomIds = rooms.map(r => r.id)
      const { data: unreadMsgs } = await supabase
        .from('chat_messages')
        .select('room_id')
        .in('room_id', roomIds)
        .neq('sender_id', user.id)
        .eq('is_read', false)

      const roomToProposal = Object.fromEntries(rooms.map(r => [r.id, r.proposal_id]))
      for (const msg of unreadMsgs ?? []) {
        const pid = roomToProposal[msg.room_id]
        if (pid) unreadMap[pid] = (unreadMap[pid] ?? 0) + 1
      }
    }
  }

  const statusLabel: Record<string, string> = { pending: '대기 중', accepted: '수락됨', rejected: '거절됨' }
  const statusVariant: Record<string, 'warning' | 'success' | 'danger'> = {
    pending: 'warning', accepted: 'success', rejected: 'danger'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} role={profile?.role} />

      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">채팅</h1>
            <p className="text-sm text-gray-500">
              {isBroker ? '내가 보낸 제안들의 채팅방' : '내 요청에 온 제안들의 채팅방'}
            </p>
          </div>
        </div>

        {chatRooms.length === 0 ? (
          <Card>
            <CardBody className="py-16 text-center">
              <MessageCircle className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-gray-500 font-medium">채팅방이 없습니다</p>
              <p className="mt-1 text-sm text-gray-400">
                {isBroker ? '매물 요청에 제안을 보내보세요' : '요청을 등록하면 중개사가 제안을 보냅니다'}
              </p>
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {chatRooms.map((proposal: any) => {
              const req = proposal.request_posts
              const brokerProfile = proposal.broker_profiles

              return (
                <Link key={proposal.id} href={`/chat/${proposal.id}`}>
                  <Card hover>
                    <CardBody className="py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant={statusVariant[proposal.status]}>
                              {statusLabel[proposal.status]}
                            </Badge>
                            {req && (
                              <span className="text-sm font-semibold text-gray-900 truncate">
                                {req.district} · {req.deal_type?.split(',')[0]}
                              </span>
                            )}
                          </div>

                          {isBroker ? (
                            <p className="text-sm text-gray-500">
                              요청자: {req?.profiles?.name ?? req?.profiles?.email ?? '(이름 없음)'}
                            </p>
                          ) : (
                            <p className="text-sm text-gray-500">
                              중개사: {brokerProfile?.profiles?.name ?? brokerProfile?.office_name ?? '(이름 없음)'}
                            </p>
                          )}

                          <p className="mt-1 text-sm font-bold text-blue-600">
                            제안가: {formatPrice(proposal.price)}
                          </p>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <Clock className="h-3 w-3" />
                            {formatDate(proposal.created_at)}
                          </span>
                          {unreadMap[proposal.id] > 0 ? (
                            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-xs font-bold text-white">
                              {unreadMap[proposal.id]}
                            </span>
                          ) : (
                            <span className="text-xs text-blue-500 font-medium">채팅 열기 →</span>
                          )}
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
