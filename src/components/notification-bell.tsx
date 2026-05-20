'use client'

import { useState, useRef, useEffect } from 'react'
import { Bell, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useNotificationsCtx } from '@/lib/notifications-context'
import { useRouter } from 'next/navigation'
import { formatDate } from '@/lib/utils'

const TYPE_ICON: Record<string, string> = {
  new_proposal: '📨',
  proposal_accepted: '✅',
  proposal_rejected: '❌',
  new_message: '💬',
  new_matching_property: '🏠',
  new_matching_request: '📨',
  announcement: '📢',
  new_review: '⭐',
  request_renewal_reminder: '⏰',
  request_expired: '📁',
  property_stale_reminder: '🏚️',
  referral_signup: '🎁',
}

// userId prop은 호환성을 위해 받지만 NotificationsProvider가 AuthContext의 user를 사용한다.
export function NotificationBell({ userId: _userId }: { userId?: string }) {
  const router = useRouter()
  const { notifications, unread, markAllRead, markRead } = useNotificationsCtx()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleClick = async (n: typeof notifications[0]) => {
    try { await markRead(n.id) } catch { /* 읽음 처리 실패해도 이동은 진행 */ }
    setOpen(false)
    if (n.link) router.push(n.link)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl hover:bg-gray-100 transition-colors"
      >
        <Bell className="h-5 w-5 text-gray-600" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-gray-200 bg-white shadow-xl">
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="font-bold text-gray-900">알림</span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                모두 읽음
              </button>
            )}
          </div>

          {/* 목록 */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-400">
                <Bell className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                알림이 없습니다
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 ${
                    !n.is_read ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <span className="mt-0.5 text-xl flex-shrink-0">{TYPE_ICON[n.type] ?? '🔔'}</span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!n.is_read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
                      {n.title}
                    </p>
                    {n.body && <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">{n.body}</p>}
                    <p className="mt-1 text-xs text-gray-400">{formatDate(n.created_at)}</p>
                  </div>
                  {!n.is_read && (
                    <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" />
                  )}
                </button>
              ))
            )}
          </div>

          {/* 푸터 — 전체 보기 */}
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1 border-t border-gray-100 py-2.5 text-xs font-semibold text-blue-600 hover:bg-gray-50 transition-colors rounded-b-2xl"
          >
            전체 알림 보기
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  )
}
