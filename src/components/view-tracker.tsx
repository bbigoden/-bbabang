'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'

type Target = 'broker' | 'property' | 'request'

interface Props {
  type: Target
  id: string
}

/**
 * 페이지 mount 시 view_history에 upsert.
 * 본인 글(요청자/중개사 본인)은 기록 생략 가능하지만 일단 단순하게 모두 기록.
 * 비로그인 사용자는 아무것도 하지 않음.
 */
export function ViewTracker({ type, id }: Props) {
  const supabaseRef = useRef(createClient())
  const { user, loading } = useAuthOptional()
  const recordedRef = useRef<string | null>(null)

  useEffect(() => {
    if (loading || !user) return
    const key = `${type}:${id}:${user.id}`
    if (recordedRef.current === key) return
    recordedRef.current = key

    ;(async () => {
      const supabase = supabaseRef.current
      await supabase
        .from('view_history')
        .upsert(
          { user_id: user.id, target_type: type, target_id: id, viewed_at: new Date().toISOString() },
          { onConflict: 'user_id,target_type,target_id' }
        )
    })().catch(() => {/* 조용히 실패 */})
  }, [user, loading, type, id])

  return null
}
