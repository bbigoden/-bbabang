'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useNotificationsCtx, type Notification } from '@/lib/notifications-context'
import { Header } from '@/components/layout/header'
import { Bell, Check, CheckCheck } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/layout/page-header'

const PAGE_SIZE = 30

const TYPE_ICON: Record<string, string> = {
  new_proposal: '📨',
  proposal_accepted: '✅',
  proposal_rejected: '❌',
  new_message: '💬',
  new_review: '⭐',
  announcement: '📢',
  new_matching_property: '🏠',
  new_matching_request: '📨',
  request_renewal_reminder: '⏰',
  request_expired: '📁',
  property_stale_reminder: '🏚️',
  referral_signup: '🎁',
  stage_changed: '🚀',
  saved_search_match: '🔖',
  property_price_changed: '💰',
  deal_completed: '🎉',
  admin_property_status_changed: '🛡️',
}

type Filter = 'all' | 'unread'

export default function NotificationsPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()
  const { reload: reloadCtx } = useNotificationsCtx()

  const [items, setItems] = useState<Notification[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) {
      router.push('/auth/login?redirect=/notifications')
    }
  }, [auth.loading, auth.user, router])

  const load = useCallback(async (reset = false) => {
    if (!auth.user) return
    const targetPage = reset ? 0 : page
    if (reset) setLoading(true)
    else setLoadingMore(true)

    let q = supabase
      .from('notifications')
      .select('id, type, title, body, link, is_read, created_at')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)

    if (filter === 'unread') q = q.eq('is_read', false)

    const { data, error } = await q
    if (!error) {
      const rows = data ?? []
      setItems(prev => reset ? rows : [...prev, ...rows])
      setHasMore(rows.length === PAGE_SIZE)
      setPage(targetPage + 1)
    }
    if (reset) setLoading(false)
    else setLoadingMore(false)
  }, [auth.user, filter, page, supabase])

  useEffect(() => {
    if (auth.loading || !auth.user) return
    setPage(0)
    setHasMore(true)
    load(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id, filter])

  const handleClick = async (n: Notification) => {
    if (!n.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', n.id)
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
      reloadCtx()
    }
    if (n.link) router.push(n.link)
  }

  const markAllRead = async () => {
    if (!auth.user || busy) return
    setBusy(true)
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', auth.user.id)
      .eq('is_read', false)
    if (!error) {
      setItems(prev => prev.map(n => ({ ...n, is_read: true })))
      reloadCtx()
    }
    setBusy(false)
  }

  if (auth.loading || (!auth.user && !auth.loading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  const unreadCount = items.filter(n => !n.is_read).length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          icon={Bell}
          iconColor="text-blue-600"
          title="알림"
          description="새 제안·메시지·공지 등 받은 알림을 모아봐요"
          actions={unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3.5 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              <CheckCheck className="h-4 w-4" />
              {busy ? '처리 중...' : '모두 읽음'}
            </button>
          )}
        />

        <div className="mb-4 flex gap-2">
          {([
            { key: 'all', label: '전체' },
            { key: 'unread', label: '안 읽음' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${
                filter === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            variant="full"
            icon={Bell}
            message={filter === 'unread' ? '안 읽은 알림이 없어요' : '알림이 없어요'}
            description="새 알림이 도착하면 여기에 표시돼요"
            darkBg
          />
        ) : (
          <>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm">
              {items.map(n => (
                <li key={n.id}>
                  <button
                    onClick={() => handleClick(n)}
                    className={`w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors ${
                      !n.is_read ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    <span className="mt-0.5 text-xl flex-shrink-0">{TYPE_ICON[n.type] ?? '🔔'}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.is_read ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                        {!n.is_read && <span className="sr-only">안 읽음 알림: </span>}
                        {n.title}
                      </p>
                      {n.body && <p className="mt-1 text-sm text-gray-500 line-clamp-2">{n.body}</p>}
                      <p className="mt-1.5 text-xs text-gray-500">{formatDate(n.created_at)}</p>
                    </div>
                    {!n.is_read ? (
                      <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" aria-label="안 읽음" />
                    ) : (
                      <Check className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-gray-300" aria-label="읽음" />
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {hasMore && (
              <div className="mt-4 flex justify-center">
                <button
                  onClick={() => load(false)}
                  disabled={loadingMore}
                  className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? '불러오는 중...' : '더 보기'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
