'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { MessageCircle, CheckCircle, XCircle } from 'lucide-react'
import Link from 'next/link'

interface ProposalActionsProps {
  proposalId: string
  requestId: string
  currentStatus: string
  brokerId?: string   // 알림 전송용
  requestOwnerId?: string  // 알림 전송용
}

export function ProposalActions({ proposalId, requestId, currentStatus, brokerId, requestOwnerId }: ProposalActionsProps) {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [status, setStatus] = useState(currentStatus)
  const [loading, setLoading] = useState<'accept' | 'reject' | null>(null)

  const handleAccept = async () => {
    setLoading('accept')
    await supabase.from('proposals').update({ status: 'accepted' }).eq('id', proposalId)
    await supabase.from('request_posts').update({ status: 'matched' }).eq('id', requestId)

    // 중개사에게 수락 알림
    if (brokerId) {
      await supabase.from('notifications').insert({
        user_id: brokerId,
        type: 'proposal_accepted',
        title: '제안이 수락되었습니다! 🎉',
        body: '고객이 제안을 수락했어요. 채팅으로 이동해 상담을 시작하세요.',
        link: `/chat/${proposalId}`,
      })
    }

    setStatus('accepted')
    setLoading(null)
    router.refresh()
  }

  const handleReject = async () => {
    setLoading('reject')
    await supabase.from('proposals').update({ status: 'rejected' }).eq('id', proposalId)

    // 중개사에게 거절 알림
    if (brokerId) {
      await supabase.from('notifications').insert({
        user_id: brokerId,
        type: 'proposal_rejected',
        title: '제안이 거절되었습니다',
        body: '고객이 제안을 거절했어요.',
        link: `/dashboard/broker`,
      })
    }

    setStatus('rejected')
    setLoading(null)
    router.refresh()
  }

  if (status === 'accepted') {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1 text-sm font-semibold text-green-600">
          <CheckCircle className="h-4 w-4" /> 수락됨
        </span>
        <Link href={`/chat/${proposalId}`} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
          <MessageCircle className="h-4 w-4" />
          채팅하기
        </Link>
      </div>
    )
  }

  if (status === 'rejected') {
    return (
      <span className="flex items-center gap-1 text-sm font-semibold text-red-400">
        <XCircle className="h-4 w-4" /> 거절됨
      </span>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleReject}
        loading={loading === 'reject'}
        className="border-red-200 text-red-500 hover:bg-red-50"
      >
        거절
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={handleAccept}
        loading={loading === 'accept'}
      >
        <CheckCircle className="mr-1.5 h-4 w-4" />
        수락
      </Button>
      <Link href={`/chat/${proposalId}`} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
        <MessageCircle className="h-4 w-4" />
        채팅
      </Link>
    </div>
  )
}
