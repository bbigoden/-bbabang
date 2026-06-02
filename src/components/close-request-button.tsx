'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { XCircle, AlertTriangle } from 'lucide-react'
import { useToast } from '@/components/toast'

export function CloseRequestButton({ requestId }: { requestId: string }) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const _router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)

  const handleClose = async () => {
    setLoading(true)
    const { error } = await supabase
      .from('request_posts')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', requestId)
    if (error) {
      toast.error('마감 처리에 실패했어요. 다시 시도해주세요.')
      setLoading(false)
      return
    }
    setShowModal(false)
    setLoading(false)
    window.location.href = '/dashboard/user'
  }

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors"
      >
        <XCircle className="h-4 w-4" />
        요청 마감
      </button>

      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => !loading && setShowModal(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-xl mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
                <AlertTriangle className="h-7 w-7 text-red-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">요청을 마감할까요?</h3>
              <p className="mt-2 text-sm text-gray-500 leading-relaxed">
                마감하면 새로운 제안을 받을 수 없어요.<br />
                이미 받은 제안들은 계속 확인할 수 있습니다.
              </p>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowModal(false)}
                disabled={loading}
                className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button
                onClick={handleClose}
                disabled={loading}
                className="flex-1 rounded-xl bg-red-500 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {loading ? '처리 중...' : '마감하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
