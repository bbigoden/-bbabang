'use client'

import { useEffect, useState, useId } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'

/**
 * 사내 메신저 전체 안 읽은 메시지 수 (사이드바/하단탭 '대화' 배지용).
 * office_chat_unread_count RPC 호출 + 실시간(메시지/멤버 변경) 재계산.
 */
export function useOfficeChatUnread(): number {
  const auth = useAuthOptional()
  const [count, setCount] = useState(0)
  const uid = useId() // 컴포넌트 인스턴스마다 고유 — 같은 채널명 공유로 인한 subscribe 충돌 방지

  useEffect(() => {
    if (auth.loading || auth.profile?.role !== 'broker' || !auth.broker) { setCount(0); return }
    const supabase = createClient()
    let alive = true

    const refresh = async () => {
      const { data } = await supabase.rpc('office_chat_unread_count')
      if (alive) setCount(typeof data === 'number' ? data : 0)
    }
    refresh()

    const ch = supabase
      .channel(`oc-unread:${auth.broker.id}:${uid}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'office_chat_messages' }, refresh)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'office_chat_messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'office_chat_members' }, refresh)
      .subscribe()

    return () => { alive = false; supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.loading, auth.profile?.role, auth.broker?.id])

  return count
}
