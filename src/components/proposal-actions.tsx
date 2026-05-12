'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { MessageCircle, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import Link from 'next/link'

interface ProposalActionsProps {
  proposalId: string
  requestId: string
  currentStatus: string
  brokerId?: string   // 알림 전송용
  requestOwnerId?: string  // 알림 전송용
  onChatClick?: () => void  // 채팅 패널 열기 (페이지 이동 대신)
}

export function ProposalActions({ proposalId, requestId, currentStatus, brokerId, requestOwnerId, onChatClick }: ProposalActionsProps) {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const [status, setStatus] = useState(currentStatus)
  const [loading, setLoading] = useState<'accept' | 'reject' | 'cancel' | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)

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

  const handleCancel = async () => {
    setLoading('cancel')
    await supabase.from('proposals').update({ status: 'rejected' }).eq('id', proposalId)
    await supabase.from('request_posts').update({ status: 'active' }).eq('id', requestId)

    // 중개사에게 매칭 취소 알림
    if (brokerId) {
      await supabase.from('notifications').insert({
        user_id: brokerId,
        type: 'proposal_rejected',
        title: '매칭이 취소되었습니다',
        body: '고객이 매칭을 취소했어요. 다른 요청을 확인해 보세요.',
        link: `/dashboard/broker`,
      })
    }

    setStatus('rejected')
    setShowCancelConfirm(false)
    setLoading(null)
    router.refresh()
  }

  if (status === 'accepted') {
    return (
      <>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-sm font-semibold text-green-600">
            <CheckCircle className="h-4 w-4" /> 수락됨
          </span>
          {onChatClick ? (
            <button onClick={onChatClick} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              <MessageCircle className="h-4 w-4" />
              대화하기
            </button>
          ) : (
            <Link href={`/chat/${proposalId}`} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors">
              <MessageCircle className="h-4 w-4" />
              대화하기
            </Link>
          )}
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-50 transition-colors"
          >
            <XCircle className="h-3.5 w-3.5" />
            취소
          </button>
        </div>

        {/* 매칭 취소 확인 모달 */}
        {showCancelConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowCancelConfirm(false)}>
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl mx-4" onClick={e => e.stopPropagation()}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100">
                  <AlertCircle className="h-5 w-5 text-red-500" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">매칭을 취소할까요?</h3>
                  <p className="text-xs text-gray-500 mt-0.5">취소 후 다른 중개사 제안을 받을 수 있어요</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  돌아가기
                </button>
                <button
                  onClick={handleCancel}
                  disabled={loading === 'cancel'}
                  className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
                >
                  {loading === 'cancel' ? '처리 중...' : '매칭 취소'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
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
      {onChatClick ? (
        <button onClick={onChatClick} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <MessageCircle className="h-4 w-4" />
          채팅
        </button>
      ) : (
        <Link href={`/chat/${proposalId}`} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
          <MessageCircle className="h-4 w-4" />
          채팅
        </Link>
      )}
    </div>
  )
}
