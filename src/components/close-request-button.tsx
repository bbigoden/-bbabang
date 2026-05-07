'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { XCircle } from 'lucide-react'

export function CloseRequestButton({ requestId }: { requestId: string }) {
  const supabase = createClient()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleClose = async () => {
    if (!confirm('이 요청을 마감하시겠어요? 더 이상 제안을 받지 않습니다.')) return
    setLoading(true)
    await supabase
      .from('request_posts')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', requestId)
    router.refresh()
    setLoading(false)
  }

  return (
    <button
      onClick={handleClose}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
    >
      <XCircle className="h-4 w-4" />
      {loading ? '처리 중...' : '요청 마감'}
    </button>
  )
}
