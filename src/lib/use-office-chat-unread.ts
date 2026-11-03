'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'
import { setAppBadgeCount } from '@/lib/app-badge'
import { playMessageSound, shouldRingFor } from '@/lib/message-sound'

/**
 * 사내 메신저 전체 안 읽은 메시지 수 (사이드바/하단탭 '대화' 배지용).
 * office_chat_unread_count RPC 호출 + 실시간(메시지/멤버 변경) 재계산.
 *
 * 사이드바와 하단탭이 같은 화면에 함께 붙는다(폰에서도 사이드바는 CSS로만 숨는다).
 * 인스턴스마다 채널·RPC 를 따로 돌리면 메시지 한 통에 RPC 가 두 번 나갔다 —
 * 그래서 구독은 모듈에 하나만 두고 쓰는 쪽이 늘고 줄 때 붙였다 뗀다.
 */

let shared: {
  brokerId: string
  count: number
  listeners: Set<(n: number) => void>
  refresh: () => void
  stop: () => void
} | null = null

/** 방을 읽음 처리한 직후 바로 다시 센다 — 실시간 이벤트를 놓쳐도 배지가 남지 않게 */
export function refreshOfficeChatUnread() {
  shared?.refresh()
}

function start(brokerId: string) {
  const supabase = createClient()
  let alive = true
  let timer: ReturnType<typeof setTimeout> | null = null

  const publish = (n: number) => {
    if (!alive || !shared) return
    shared.count = n
    shared.listeners.forEach(l => l(n))
    setAppBadgeCount(n)
  }

  const refresh = async () => {
    // auth 캐시(localStorage)에 broker 프로필이 남은 채 세션만 만료된 순간(로그아웃 직후
    // 로그인 페이지 등)에 RPC가 401로 발화하는 노이즈 방지 — 세션 실존을 먼저 확인
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { publish(0); return }
    const { data } = await supabase.rpc('office_chat_unread_count')
    publish(typeof data === 'number' ? data : 0)
  }
  // 메시지·읽음 표시가 연달아 들어오면 마지막 한 번만 센다
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(refresh, 400)
  }

  // 남이 보낸 새 메세지면 알림음 — 알림 끈 방은 조용히
  const ring = async (row: { thread_id?: string; sender_broker_id?: string | null }) => {
    if (!row.thread_id || !row.sender_broker_id || row.sender_broker_id === brokerId) return
    if (!shouldRingFor(row.thread_id)) return
    const { data } = await supabase.from('office_chat_members')
      .select('muted').eq('thread_id', row.thread_id).eq('broker_id', brokerId).maybeSingle()
    if (data?.muted) return
    playMessageSound()
  }

  const ch = supabase
    .channel(`oc-unread:${brokerId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'office_chat_messages' }, payload => {
      schedule()
      ring(payload.new as { thread_id?: string; sender_broker_id?: string | null })
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'office_chat_messages' }, schedule)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'office_chat_members' }, schedule)
    .subscribe()

  // 폰에서 앱을 내렸다 올리면 그동안 실시간 연결이 끊겨 이벤트를 놓친다 — 돌아올 때 다시 센다
  const onVisible = () => { if (document.visibilityState === 'visible') schedule() }
  document.addEventListener('visibilitychange', onVisible)

  shared = {
    brokerId,
    count: 0,
    listeners: new Set(),
    refresh: schedule,
    stop: () => {
      alive = false
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(ch)
    },
  }
  refresh()
}

export function useOfficeChatUnread(): number {
  const auth = useAuthOptional()
  const brokerId = !auth.loading && auth.profile?.role === 'broker' ? auth.broker?.id ?? null : null
  const signedOut = !auth.loading && !auth.user
  const [count, setCount] = useState(0)

  // 로그아웃하면 앱 아이콘에 남은 숫자도 지운다(다음 사람에게 앞사람 수가 보이지 않게)
  useEffect(() => { if (signedOut) setAppBadgeCount(0) }, [signedOut])

  useEffect(() => {
    if (!brokerId) { setCount(0); return }
    if (shared && shared.brokerId !== brokerId) { shared.stop(); shared = null }
    if (!shared) start(brokerId)
    const s = shared!
    s.listeners.add(setCount)
    setCount(s.count)
    return () => {
      s.listeners.delete(setCount)
      if (s.listeners.size === 0 && shared === s) { s.stop(); shared = null }
    }
  }, [brokerId])

  return count
}
