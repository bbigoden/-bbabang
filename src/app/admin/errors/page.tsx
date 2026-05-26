'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { formatDate } from '@/lib/utils'
import { logAdminAction } from '@/lib/audit'
import {
  AlertOctagon, ArrowLeft, X, CheckCircle2, Clock, EyeOff, Search,
  Globe, AlertCircle, RefreshCw
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

type StatusFilter = 'open' | 'investigating' | 'resolved' | 'ignored' | 'all'

interface ErrLog {
  id: string
  user_id: string | null
  message: string
  stack: string | null
  source: string | null
  url: string | null
  user_agent: string | null
  status: 'open' | 'investigating' | 'resolved' | 'ignored'
  admin_note: string | null
  created_at: string
}

const STATUS_META: Record<ErrLog['status'], { label: string; color: string; icon: LucideIcon }> = {
  open: { label: '미처리', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: AlertCircle },
  investigating: { label: '조사 중', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock },
  resolved: { label: '해결', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle2 },
  ignored: { label: '무시', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: EyeOff },
}

const PAGE_SIZE = 50

export default function AdminErrorsPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()
  const toast = useToast()

  const [items, setItems] = useState<ErrLog[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ErrLog | null>(null)
  const [counts, setCounts] = useState({ open: 0, today: 0 })

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  const loadCounts = useCallback(async () => {
    const sinceToday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const [{ count: open }, { count: today }] = await Promise.all([
      supabase.from('error_logs').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      supabase.from('error_logs').select('*', { count: 'exact', head: true }).gte('created_at', sinceToday),
    ])
    setCounts({ open: open ?? 0, today: today ?? 0 })
  }, [supabase])

  const load = useCallback(async (reset = false) => {
    const targetPage = reset ? 0 : page
    if (reset) setLoading(true)

    let q = supabase
      .from('error_logs')
      .select('*')
      .order('created_at', { ascending: false })

    if (status !== 'all') q = q.eq('status', status)
    if (search.trim()) {
      const s = search.trim()
      q = q.or(`message.ilike.%${s}%,url.ilike.%${s}%`)
    }

    q = q.range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)

    const { data } = await q
    const rows = (data ?? []) as ErrLog[]
    setItems(prev => reset ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setPage(targetPage + 1)
    if (reset) setLoading(false)
  }, [supabase, page, status, search])

  useEffect(() => {
    if (auth.profile?.role === 'admin') {
      setPage(0); setHasMore(true)
      load(true)
      loadCounts()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.profile?.role, status])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0); setHasMore(true)
    load(true)
  }

  const updateStatus = async (id: string, newStatus: ErrLog['status']) => {
    const prev = items.find(e => e.id === id)?.status
    const { error } = await supabase.from('error_logs').update({ status: newStatus }).eq('id', id)
    if (error) { toast.error('변경 실패: ' + error.message); return }
    setItems(prev => prev.map(e => e.id === id ? { ...e, status: newStatus } : e))
    if (selected?.id === id) setSelected({ ...selected, status: newStatus })
    if (auth.user) {
      void logAdminAction(supabase, auth.user.id, {
        action: 'error.status_change',
        targetType: 'error',
        targetId: id,
        metadata: { prev, next: newStatus },
      })
    }
    loadCounts()
  }

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link href="/admin" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/20">
            <AlertOctagon className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">에러 로그</h1>
            <p className="text-xs text-gray-400">
              미처리 <span className="font-bold text-red-400">{counts.open}</span>건 · 24h <span className="font-bold text-yellow-400">{counts.today}</span>건
            </p>
          </div>
          <button onClick={() => { setPage(0); load(true); loadCounts() }}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700"
            title="새로고침">
            <RefreshCw className="h-4 w-4 text-gray-300" />
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-5">
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-[280px] flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="메시지·URL 검색"
                className="w-full rounded-xl border border-gray-700 bg-gray-900 pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
            </div>
            <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">검색</button>
          </form>

          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1">
            {([
              { key: 'open', label: '미처리' },
              { key: 'investigating', label: '조사' },
              { key: 'resolved', label: '해결' },
              { key: 'ignored', label: '무시' },
              { key: 'all', label: '전체' },
            ] as const).map(t => (
              <button key={t.key} onClick={() => setStatus(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  status === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 py-20 text-center">
            <AlertOctagon className="mx-auto mb-3 h-12 w-12 text-gray-700 dark:text-gray-300" />
            <p className="font-semibold text-gray-400">조건에 맞는 에러가 없어요</p>
          </div>
        ) : (
          <>
            <ul className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden divide-y divide-gray-800">
              {items.map(e => {
                const meta = STATUS_META[e.status]
                const Icon = meta.icon
                return (
                  <li key={e.id}>
                    <button onClick={() => setSelected(e)}
                      className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-800/60 transition-colors">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-400">
                        <AlertOctagon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
                            <Icon className="h-3 w-3" /> {meta.label}
                          </span>
                          {e.source && <span className="rounded-md bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">{e.source}</span>}
                          <span className="text-xs text-gray-500">{formatDate(e.created_at)}</span>
                        </div>
                        <p className="text-sm font-semibold text-white truncate">{e.message}</p>
                        {e.url && <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-gray-500 truncate"><Globe className="h-3 w-3" />{e.url}</p>}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>

            {hasMore && (
              <div className="flex justify-center">
                <button onClick={() => load(false)}
                  className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800">
                  더 보기
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <ErrorDetailModal
          err={selected}
          onClose={() => setSelected(null)}
          onChangeStatus={s => updateStatus(selected.id, s)}
        />
      )}
    </div>
  )
}

function ErrorDetailModal({ err, onClose, onChangeStatus }: {
  err: ErrLog
  onClose: () => void
  onChangeStatus: (s: ErrLog['status']) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const handleChange = async (s: ErrLog['status']) => {
    setBusy(true); await onChangeStatus(s); setBusy(false)
  }

  const meta = STATUS_META[err.status]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white">에러 상세</h3>
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
              <meta.icon className="h-3 w-3" /> {meta.label}
            </span>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-gray-400">메시지</p>
            <p className="text-sm text-white break-words font-mono bg-gray-800/50 rounded-xl px-3 py-2.5">{err.message}</p>
          </div>

          {err.stack && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-400">스택</p>
              <pre className="overflow-x-auto rounded-xl bg-gray-950 px-3 py-2.5 text-[11px] text-gray-300 font-mono whitespace-pre-wrap">
{err.stack}
              </pre>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-xs">
            {err.source && <KV label="Source" value={err.source} />}
            {err.url && <KV label="URL" value={err.url} />}
            {err.user_id && <KV label="User" value={err.user_id.slice(0, 8) + '...'} />}
            {err.user_agent && <KV label="UA" value={err.user_agent.slice(0, 60) + '...'} full />}
            <KV label="발생일" value={formatDate(err.created_at)} />
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-3 text-xs font-semibold text-gray-400">처리 상태</p>
            <div className="grid grid-cols-4 gap-2">
              {(['open', 'investigating', 'resolved', 'ignored'] as const).map(s => {
                const m = STATUS_META[s]
                const active = err.status === s
                return (
                  <button key={s} onClick={() => handleChange(s)} disabled={busy || active}
                    className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all ${
                      active ? `${m.color} border-current` : 'border-gray-700 bg-transparent text-gray-400 hover:bg-gray-700'
                    } disabled:opacity-50`}>
                    <m.icon className="h-3 w-3" />
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function KV({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`rounded-lg bg-gray-800/40 px-3 py-2 ${full ? 'col-span-2' : ''}`}>
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className="text-xs text-gray-200 break-all">{value}</p>
    </div>
  )
}
