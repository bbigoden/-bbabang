'use client'

import { useEffect, useState, useRef, useCallback, useId } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import { AUDIT_ACTION_META, AUDIT_TARGET_LABEL, auditActionLabel } from '@/lib/audit'
import { EmptyState } from '@/components/empty-state'
import {
  ScrollText, ArrowLeft, X, Search, RefreshCw, ShieldCheck, User as UserIcon
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { SearchClear } from '@/components/ui/search-clear'

interface AuditRow {
  id: string
  admin_user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  metadata: Record<string, any> | null
  created_at: string
  admin?: { name: string | null; email: string | null } | null
}

const TONE_COLOR: Record<string, string> = {
  green: 'bg-green-500/20 text-green-400 border-green-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  blue: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  gray: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

const PAGE_SIZE = 50

// 액션 필터 그룹 (target_type 기준)
const TARGET_FILTERS = ['all', 'broker', 'user', 'property', 'report', 'announcement', 'error'] as const
type TargetFilter = typeof TARGET_FILTERS[number]

export default function AdminAuditPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [items, setItems] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AuditRow | null>(null)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  const load = useCallback(async (reset = false) => {
    const targetPage = reset ? 0 : page
    if (reset) setLoading(true)
    else setLoadingMore(true)

    // admin_action_logs.admin_user_id FK는 auth.users를 가리키므로 PostgREST 임베드 불가
    // → 로그 조회 후 admin 프로필을 별도 조회해 매핑
    let q = supabase
      .from('admin_action_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (targetFilter !== 'all') q = q.eq('target_type', targetFilter)
    if (search.trim()) {
      const s = search.trim()
      q = q.or(`action.ilike.%${s}%,target_id.ilike.%${s}%`)
    }

    q = q.range(targetPage * PAGE_SIZE, targetPage * PAGE_SIZE + PAGE_SIZE - 1)

    const { data, count } = await q
    let rows = (data ?? []) as any as AuditRow[]

    // 실행자(profiles) 매핑 — profiles.id == auth.users.id
    const adminIds = Array.from(new Set(rows.map(r => r.admin_user_id).filter(Boolean))) as string[]
    if (adminIds.length > 0) {
      const { data: admins } = await supabase
        .from('profiles_visible')
        .select('id, name, email')
        .in('id', adminIds)
      const map = new Map((admins ?? []).map((a: any) => [a.id, { name: a.name, email: a.email }]))
      rows = rows.map(r => ({ ...r, admin: r.admin_user_id ? map.get(r.admin_user_id) ?? null : null }))
    }

    setItems(prev => reset ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    setPage(targetPage + 1)
    if (count != null) setTotal(count)
    if (reset) setLoading(false); else setLoadingMore(false)
  }, [supabase, page, targetFilter, search])

  useEffect(() => {
    if (auth.profile?.role === 'admin') {
      setPage(0); setHasMore(true)
      load(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.profile?.role, targetFilter])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(0); setHasMore(true)
    load(true)
  }

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Link href="/admin" aria-label="관리자 대시보드" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
            <ArrowLeft className="h-4 w-4 text-gray-300" />
          </Link>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20">
            <ScrollText className="h-5 w-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">관리자 활동 로그</h1>
            <p className="text-xs text-gray-400">전체 <span className="font-bold text-indigo-400">{total}</span>건 · 누가 언제 무엇을 바꿨는지 기록</p>
          </div>
          <button onClick={() => { setPage(0); load(true) }} disabled={loading}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
            title="새로고침">
            <RefreshCw className={`h-4 w-4 text-gray-300 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-5">
        <div className="flex flex-wrap gap-3">
          <form onSubmit={handleSearch} className="flex-1 min-w-[260px] flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                aria-label="액션·대상 ID 검색"
                placeholder="액션·대상 ID 검색"
                className="w-full rounded-xl border border-gray-700 bg-gray-900 pl-9 pr-8 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
              {search && <SearchClear tone="dark" onClick={() => setSearch('')} />}
            </div>
            <button type="submit" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">검색</button>
          </form>

          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1 flex-wrap">
            {TARGET_FILTERS.map(t => (
              <button key={t} onClick={() => setTargetFilter(t)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  targetFilter === t ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}>
                {t === 'all' ? '전체' : AUDIT_TARGET_LABEL[t] ?? t}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="md" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState variant="full" icon={ScrollText} message="기록된 활동이 없어요" darkBg />
        ) : (
          <>
            <ul className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden divide-y divide-gray-800">
              {items.map(row => {
                const meta = AUDIT_ACTION_META[row.action]
                const tone = meta?.tone ?? 'gray'
                return (
                  <li key={row.id}>
                    <button onClick={() => setSelected(row)}
                      className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-800/60 transition-colors">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
                        <ShieldCheck className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${TONE_COLOR[tone]}`}>
                            {auditActionLabel(row.action)}
                          </span>
                          {row.target_type && (
                            <span className="rounded-md bg-gray-800 px-1.5 py-0.5 text-[10px] font-semibold text-gray-300">
                              {AUDIT_TARGET_LABEL[row.target_type] ?? row.target_type}
                            </span>
                          )}
                          <span className="text-xs text-gray-400">{formatDate(row.created_at)}</span>
                        </div>
                        <p className="flex items-center gap-1 text-sm text-gray-200">
                          <UserIcon className="h-3 w-3 text-gray-400" />
                          {row.admin?.name ?? row.admin?.email ?? '(알 수 없음)'}
                        </p>
                        {row.metadata && summarizeMeta(row.metadata) && (
                          <p className="mt-0.5 text-xs text-gray-400 truncate">{summarizeMeta(row.metadata)}</p>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>

            {hasMore && (
              <div className="flex justify-center">
                <button onClick={() => load(false)} disabled={loadingMore}
                  className="rounded-xl border border-gray-700 bg-gray-900 px-5 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50">
                  {loadingMore ? '불러오는 중...' : '더 보기'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {selected && (
        <AuditDetailModal row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

// metadata를 한 줄 요약
function summarizeMeta(m: Record<string, any>): string {
  const parts: string[] = []
  if (m.office_name) parts.push(String(m.office_name))
  if (m.address) parts.push(String(m.address))
  if (m.title) parts.push(`"${m.title}"`)
  if (m.reason) parts.push(`사유: ${m.reason}`)
  if (m.from && m.to) parts.push(`${m.from} → ${m.to}`)
  else if (m.prev && m.next) parts.push(`${m.prev} → ${m.next}`)
  if (m.bulk && m.count) parts.push(`일괄 ${m.count}건`)
  if (m.recipient_count != null) parts.push(`수신 ${m.recipient_count}명`)
  if (m.deleted_count != null) parts.push(`삭제 ${m.deleted_count}건`)
  return parts.join(' · ')
}

function AuditDetailModal({ row, onClose }: { row: AuditRow; onClose: () => void }) {
  const meta = AUDIT_ACTION_META[row.action]
  const tone = meta?.tone ?? 'gray'
  const titleId = useId()
  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
          <div className="flex items-center gap-2">
            <h3 id={titleId} className="font-bold text-white">활동 상세</h3>
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${TONE_COLOR[tone]}`}>
              {auditActionLabel(row.action)}
            </span>
          </div>
          <button onClick={onClose} aria-label="닫기" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-3 text-sm">
          <KV label="실행자" value={row.admin?.name ?? row.admin?.email ?? '(알 수 없음)'} />
          {row.admin?.email && row.admin?.name && <KV label="이메일" value={row.admin.email} />}
          <KV label="액션 코드" value={<span className="font-mono text-xs">{row.action}</span>} />
          {row.target_type && <KV label="대상 종류" value={AUDIT_TARGET_LABEL[row.target_type] ?? row.target_type} />}
          {row.target_id && <KV label="대상 ID" value={<span className="font-mono text-xs break-all">{row.target_id}</span>} />}
          <KV label="시각" value={formatDate(row.created_at)} />
          {row.metadata && Object.keys(row.metadata).length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-400">상세 데이터</p>
              <pre className="overflow-x-auto rounded-xl bg-gray-950 px-3 py-2.5 text-[11px] text-gray-300 font-mono whitespace-pre-wrap">
{JSON.stringify(row.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-800/60 pb-2.5 last:border-0">
      <span className="text-xs text-gray-400 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-200 text-right">{value}</span>
    </div>
  )
}
