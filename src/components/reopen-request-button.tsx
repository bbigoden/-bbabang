'use client'

import { useState, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RotateCcw } from 'lucide-react'
import { useToast } from '@/components/toast'

/**
 * 마감된 요청을 다시 활성화한다.
 * cron(expire-requests)이 created_at 기준 30일로 자동 마감하므로,
 * 재오픈 시 created_at을 지금으로 갱신해 30일 유효기간을 다시 부여한다.
 */
export function ReopenRequestButton({ requestId, variant = 'default' }: {
  requestId: string
  variant?: 'default' | 'compact'
}) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  const handleReopen = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    e?.preventDefault()
    if (loading) return
    setLoading(true)
    const { error } = await supabase
      .from('request_posts')
      .update({
        status: 'active',
        closed_at: null,
        created_at: new Date().toISOString(),
      })
      .eq('id', requestId)
    if (error) {
      toast.error('재오픈에 실패했어요. 다시 시도해주세요.')
      setLoading(false)
      return
    }
    toast.success('요청을 다시 열었어요. 30일 동안 새 제안을 받을 수 있어요.')
    setLoading(false)
    window.location.reload()
  }

  if (variant === 'compact') {
    return (
      <button
        onClick={handleReopen}
        disabled={loading}
        className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
      >
        <RotateCcw className="h-3 w-3" />
        {loading ? '처리 중' : '다시 열기'}
      </button>
    )
  }

  return (
    <button
      onClick={handleReopen}
      disabled={loading}
      className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
    >
      <RotateCcw className="h-4 w-4" />
      {loading ? '처리 중...' : '다시 열기'}
    </button>
  )
}
