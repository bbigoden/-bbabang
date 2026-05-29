'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Header } from '@/components/layout/header'
import { ChatPanel } from '@/components/chat-panel'
import { cn, formatDate } from '@/lib/utils'
import { MessageCircle } from 'lucide-react'

interface ChatRoom {
  id: string
  broker_id: string
  user_id: string
  proposal_id: string
  request_id: string
  created_at: string
  proposals: {
    id: string
    price: number
    status: string
    created_at: string
    request_posts: {
      id: string
      city: string
      district: string
      deal_type: string
      profiles: {
        name: string
      } | null
    } | null
  } | null
}

export function BrokerChatsClient({ user }: { user: any }) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current

  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProposalId, setSelectedId] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<'list' | 'chat'>('list')

  useEffect(() => {
    const fetchRooms = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('chat_rooms')
        .select(`
          id, broker_id, user_id, proposal_id, request_id, created_at,
          proposals(
            id, price, status, created_at,
            request_posts(
              id, city, district, deal_type,
              profiles(name)
            )
          )
        `)
        .eq('broker_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      setChatRooms((data ?? []) as unknown as ChatRoom[])
      setLoading(false)
    }
    fetchRooms()
  }, [])

  const handleSelect = (proposalId: string) => {
    setSelectedId(proposalId)
    setMobileTab('chat')
  }

  return (
    <div className="flex flex-col bg-gray-50 dark:bg-gray-950" style={{ height: '100dvh' }}>
      <Header user={user} role="broker" />

      <div className="flex flex-1 overflow-hidden">
        {/* ── 왼쪽 패널: 대화 목록 ── */}
        <div className={cn(
          'flex flex-col border-r border-gray-200 bg-white overflow-hidden flex-shrink-0',
          'w-full md:w-[380px] lg:w-[420px]',
          mobileTab === 'chat' ? 'hidden md:flex' : 'flex'
        )}>
          {/* 헤더 */}
          <div className="px-4 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-gray-900 dark:text-white">대화목록</h1>
              {!loading && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">
                  {chatRooms.length}
                </span>
              )}
            </div>
          </div>

          {/* 목록 */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <div className="h-6 w-6 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" />
                <p className="text-xs text-gray-400">불러오는 중...</p>
              </div>
            ) : chatRooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <MessageCircle className="h-10 w-10 text-gray-200 mb-3" />
                <p className="text-sm font-semibold text-gray-500">아직 대화가 없습니다</p>
                <p className="mt-1 text-xs text-gray-400">고객 요청에 제안하면 대화가 시작됩니다</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {chatRooms.map(room => {
                  const proposal = room.proposals
                  const req = proposal?.request_posts
                  const customerName = req?.profiles?.name ?? '고객'
                  const location = req ? `${req.city} ${req.district}` : '-'
                  const dealType = req?.deal_type ?? ''
                  const isSelected = selectedProposalId === room.proposal_id

                  return (
                    <button
                      key={room.id}
                      onClick={() => handleSelect(room.proposal_id)}
                      className={cn(
                        'w-full text-left px-4 py-3.5 transition-colors flex items-center gap-3',
                        isSelected ? 'bg-blue-50 border-l-2 border-blue-500' : 'hover:bg-gray-50'
                      )}
                    >
                      {/* 아바타 */}
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold text-sm">
                        {customerName[0]}
                      </div>

                      {/* 내용 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className={cn('text-sm font-bold truncate', isSelected ? 'text-blue-800' : 'text-gray-900')}>
                            {customerName}
                          </span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {formatDate(proposal?.created_at ?? room.created_at)}
                          </span>
                        </div>
                        <p className={cn('text-xs truncate mt-0.5', isSelected ? 'text-blue-600' : 'text-gray-500')}>
                          {location}{dealType ? ` · ${dealType}` : ''}
                        </p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── 오른쪽 패널: 채팅 ── */}
        <div className={cn(
          'flex-1 flex flex-col overflow-hidden',
          mobileTab === 'list' ? 'hidden md:flex' : 'flex'
        )}>
          {selectedProposalId ? (
            <ChatPanel
              key={selectedProposalId}
              proposalId={selectedProposalId}
              currentUser={user}
              isOwner={false}
              onBack={() => setMobileTab('list')}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center px-4 bg-gray-50 dark:bg-gray-950">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
                <MessageCircle className="h-8 w-8 text-blue-500" />
              </div>
              <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">대화를 선택하세요</h3>
              <p className="mt-1.5 text-sm text-gray-400">왼쪽 목록에서 대화를 클릭하면<br />채팅 내용을 확인할 수 있어요</p>
            </div>
          )}
        </div>
      </div>

      {/* 모바일 하단 탭 */}
      <div className="md:hidden flex border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
        <button
          onClick={() => setMobileTab('list')}
          className={cn('flex-1 py-3 text-sm font-semibold transition-colors',
            mobileTab === 'list' ? 'text-blue-600 border-t-2 border-blue-600 -mt-px' : 'text-gray-500')}
        >
          목록 ({chatRooms.length})
        </button>
        <button
          onClick={() => selectedProposalId && setMobileTab('chat')}
          className={cn('flex-1 py-3 text-sm font-semibold transition-colors',
            mobileTab === 'chat' ? 'text-blue-600 border-t-2 border-blue-600 -mt-px' : selectedProposalId ? 'text-gray-500' : 'text-gray-300')}
        >
          {selectedProposalId ? '대화' : '대화 (목록에서 선택)'}
        </button>
      </div>
    </div>
  )
}
