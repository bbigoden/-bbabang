'use client'

/**
 * 전역 알림 컨텍스트.
 *
 * 기존 useNotifications hook이 NotificationBell 안에서 호출되어 매 페이지 mount마다
 * notifications fetch + realtime channel subscribe/unsubscribe가 반복됐다. root layout에서
 * 한 번만 mount되도록 Context로 옮긴다.
 *
 * AuthProvider 안쪽에 wrap되며, auth.user 변화에 자동으로 재로드·재구독한다.
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'

export interface Notification {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

interface NotificationsState {
  notifications: Notification[]
  unread: number
  markAllRead: () => Promise<void>
  markRead: (id: string) => Promise<void>
  reload: () => Promise<void>
}

const NotificationsContext = createContext<NotificationsState | null>(null)

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const { user } = useAuthOptional()
  const userId = user?.id ?? null

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)

  const load = useCallback(async () => {
    if (!userId) { setNotifications([]); setUnread(0); return }
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications(data ?? [])
    setUnread((data ?? []).filter(n => !n.is_read).length)
  }, [userId, supabase])

  // 초기 로드 + userId 변경 시
  useEffect(() => { load() }, [load])

  // 실시간 구독 — userId 별 채널 1개, mount 시 1회
  useEffect(() => {
    if (!userId) return
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel(`notifications:${userId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        }, (payload) => {
          const n = payload.new as Notification
          setNotifications(prev => [n, ...prev])
          setUnread(prev => prev + 1)
        })
        .subscribe()
    } catch (e) {
      console.warn('Notification realtime subscription failed:', e)
    }
    return () => {
      if (channel) { try { supabase.removeChannel(channel) } catch {} }
    }
  }, [userId, supabase])

  const markAllRead = async () => {
    if (!userId) return
    await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnread(0)
  }

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnread(prev => Math.max(0, prev - 1))
  }

  return (
    <NotificationsContext.Provider value={{ notifications, unread, markAllRead, markRead, reload: load }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotificationsCtx(): NotificationsState {
  const v = useContext(NotificationsContext)
  if (v) return v
  // Provider 없을 때 안전한 기본값 (예: 로그인 전 페이지)
  return {
    notifications: [], unread: 0,
    markAllRead: async () => {},
    markRead: async () => {},
    reload: async () => {},
  }
}
