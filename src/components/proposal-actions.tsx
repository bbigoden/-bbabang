'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { MessageCircle, CheckCircle, XCircle } from 'lucide-react'
import Link from 'next/link'

interface ProposalActionsProps {
  proposalId: string
  requestId: string
  currentStatus: string
}

export function ProposalActions({ proposalId, requestId, currentStatus }: ProposalActionsProps) {
  const router = useRouter()
  const supabase = createClient()
  const [status, setStatus] = useState(currentStatus)
  const [loading, setLoading] = useState<'accept' | 'reject' | null>(null)

  const handleAccept = async () => {
    setLoading('accept')
    await supabase.from('proposals').update({ status: 'accepted' }).eq('id', proposalId)
    // 요청 상태도 matched로 변경
    await supabase.from('request_posts').update({ status: 'matched' }).eq('id', requestId)
    setStatus('accepted')
    setLoading(null)
    router.refresh()
  }

  const handleReject = async () => {
    setLoading('reject')
    await supabase.from('proposals').update({ status: 'rejected' }).eq('id', proposalId)
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
        <Link href={`/chat/${proposalId}`}>
          <Button variant="primary" size="sm">
            <MessageCircle className="mr-1.5 h-4 w-4" />
            채팅하기
          </Button>
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
      <Link href={`/chat/${proposalId}`}>
        <Button variant="outline" size="sm">
          <MessageCircle className="mr-1.5 h-4 w-4" />
          채팅
        </Button>
      </Link>
    </div>
  )
}
