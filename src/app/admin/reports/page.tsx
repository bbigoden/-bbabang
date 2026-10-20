'use client'

import { useEffect, useState, useRef, useCallback, useId } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { formatDate } from '@/lib/utils'
import { logAdminAction } from '@/lib/audit'
import { EmptyState } from '@/components/empty-state'
import {
  Flag, MessageCircle, ArrowLeft, ExternalLink, Check, X,
  AlertCircle, Clock, CheckCircle2, XCircle, ChevronDown, Mail, Star
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'

interface Report {
  id: string
  reporter_id: string | null
  reporter_email: string | null
  kind: 'report' | 'inquiry'
  target_type: 'broker' | 'property' | 'request' | 'review' | null
  target_id: string | null
  subject: string | null
  content: string
  status: 'open' | 'in_progress' | 'resolved' | 'rejected'
  admin_note: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  reporter?: { name: string | null; email: string | null } | null
}

type StatusFilter = 'all' | 'open' | 'in_progress' | 'resolved' | 'rejected'
type KindFilter = 'all' | 'report' | 'inquiry'

const STATUS_META: Record<Report['status'], { label: string; color: string; icon: LucideIcon }> = {
  open: { label: '미처리', color: 'bg-red-500/20 text-red-400 border-red-500/30', icon: AlertCircle },
  in_progress: { label: '처리 중', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', icon: Clock },
  resolved: { label: '완료', color: 'bg-green-500/20 text-green-400 border-green-500/30', icon: CheckCircle2 },
  rejected: { label: '반려', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', icon: XCircle },
}

const TARGET_LABEL: Record<NonNullable<Report['target_type']>, string> = {
  broker: '중개사',
  property: '매물',
  request: '요청',
  review: '리뷰',
}

// 리뷰는 열 페이지가 없어 '#'(열기 버튼 숨김)으로 두고 모달 안에 내용을 바로 띄운다.
// /reviews 는 '내가 쓴 리뷰'만 보여 줘서, 관리자가 가면 자기 빈 목록만 나왔다.
const TARGET_LINK = (type: NonNullable<Report['target_type']>, id: string): string => {
  if (type === 'broker') return '/admin/brokers'  // 공개 프로필 페이지 제거됨 — 검수 화면으로
  if (type === 'request') return `/request/${id}`
  if (type === 'property') return `/property/${id}`
  return '#'
}

export default function AdminReportsPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [items, setItems] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<StatusFilter>('open')
  const [kind, setKind] = useState<KindFilter>('all')
  const [selected, setSelected] = useState<Report | null>(null)

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('reports')
      .select('*, reporter:profiles_visible!reporter_id(name, email)')
      .order('created_at', { ascending: false })
      .limit(200)

    if (status !== 'all') q = q.eq('status', status)
    if (kind !== 'all') q = q.eq('kind', kind)

    const { data } = await q
    setItems((data ?? []) as any)
    setLoading(false)
  }, [supabase, status, kind])

  useEffect(() => {
    if (auth.profile?.role === 'admin') load()
  }, [auth.profile?.role, load])

  if (auth.loading || auth.profile?.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <Spinner size="lg" />
      </div>
    )
  }

  const counts = {
    open: items.filter(r => r.status === 'open').length,
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" aria-label="관리자 대시보드" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
              <ArrowLeft className="h-4 w-4 text-gray-300" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-500/20">
              <Flag className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">신고·문의 관리</h1>
              <p className="text-xs text-gray-400">미처리 {counts.open}건 · 전체 {items.length}건</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-8 space-y-5">
        {/* 필터 */}
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1">
            {([
              { key: 'open', label: '미처리' },
              { key: 'in_progress', label: '처리 중' },
              { key: 'resolved', label: '완료' },
              { key: 'rejected', label: '반려' },
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
          <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1">
            {([
              { key: 'all' as KindFilter, label: '전체 종류', icon: null as LucideIcon | null },
              { key: 'report' as KindFilter, label: '신고', icon: Flag as LucideIcon | null },
              { key: 'inquiry' as KindFilter, label: '문의', icon: MessageCircle as LucideIcon | null },
            ]).map(t => (
              <button key={t.key} onClick={() => setKind(t.key)}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  kind === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                }`}>
                {t.icon && <t.icon className="h-3 w-3" />}
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 목록 */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Spinner size="md" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState variant="full" icon={Flag} message="조건에 맞는 항목이 없어요" darkBg />
        ) : (
          <ul className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden divide-y divide-gray-800">
            {items.map(r => {
              const meta = STATUS_META[r.status]
              const Icon = meta.icon
              return (
                <li key={r.id}>
                  <button onClick={() => setSelected(r)}
                    className="w-full flex items-start gap-3 px-5 py-4 text-left hover:bg-gray-800/60 transition-colors">
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${r.kind === 'report' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-300'}`}>
                      {r.kind === 'report' ? <Flag className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
                          <Icon className="h-3 w-3" /> {meta.label}
                        </span>
                        {r.target_type && (
                          <span className="rounded-md bg-gray-800 px-1.5 py-0.5 text-[10px] font-semibold text-gray-300">
                            {TARGET_LABEL[r.target_type]}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">{formatDate(r.created_at)}</span>
                      </div>
                      <p className="text-sm font-semibold text-white truncate">{r.subject ?? '(제목 없음)'}</p>
                      <p className="mt-0.5 text-xs text-gray-400 line-clamp-1">{r.content}</p>
                      <p className="mt-1 text-[11px] text-gray-400">
                        {r.reporter?.name ?? r.reporter_email ?? '익명'}
                        {r.reporter?.email && <span className="ml-1">({r.reporter.email})</span>}
                      </p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-gray-400 rotate-[-90deg] flex-shrink-0 mt-1" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {selected && (
        <ReportDetailModal
          report={selected}
          onClose={() => setSelected(null)}
          onUpdated={async () => { await load() }}
          supabase={supabase}
          adminId={auth.user!.id}
        />
      )}
    </div>
  )
}

function ReportDetailModal({ report, onClose, onUpdated, supabase, adminId }: {
  report: Report
  onClose: () => void
  onUpdated: () => void
  supabase: ReturnType<typeof createClient>
  adminId: string
}) {
  const [status, setStatus] = useState<Report['status']>(report.status)
  const [adminNote, setAdminNote] = useState(report.admin_note ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const titleId = useId()

  const save = async () => {
    setSaving(true); setErr(null)
    const updates: any = { status, admin_note: adminNote }
    if ((status === 'resolved' || status === 'rejected') && !report.resolved_at) {
      updates.resolved_at = new Date().toISOString()
      updates.resolved_by = adminId
    }
    if (status === 'open' || status === 'in_progress') {
      updates.resolved_at = null
      updates.resolved_by = null
    }
    const { error } = await supabase.from('reports').update(updates).eq('id', report.id)
    setSaving(false)
    if (error) { setErr('저장 실패'); return }
    if (status !== report.status || (adminNote ?? '') !== (report.admin_note ?? '')) {
      await logAdminAction(supabase, adminId, {
        action: 'report.status_change',
        targetType: 'report',
        targetId: report.id,
        metadata: {
          from: report.status,
          to: status,
          kind: report.kind,
          target_type: report.target_type,
          target_id: report.target_id,
          note_changed: (adminNote ?? '') !== (report.admin_note ?? ''),
        },
      })
    }
    await onUpdated()
    onClose()
  }

  const meta = STATUS_META[report.status]
  const targetHref = report.target_type && report.target_id ? TARGET_LINK(report.target_type, report.target_id) : null

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4"
      onClick={() => !saving && onClose()}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${report.kind === 'report' ? 'bg-red-500/10 text-red-400' : 'bg-blue-500/10 text-blue-300'}`}>
              {report.kind === 'report' ? <Flag className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
            </div>
            <h3 id={titleId} className="font-bold text-white">{report.kind === 'report' ? '신고 상세' : '문의 상세'}</h3>
            <span className={`ml-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${meta.color}`}>
              <meta.icon className="h-3 w-3" /> {meta.label}
            </span>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-5">
          {/* 신고자 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-2 text-xs font-semibold text-gray-400">신고자</p>
            <p className="text-sm text-white">{report.reporter?.name ?? '익명'}</p>
            {(report.reporter?.email || report.reporter_email) && (
              <a href={`mailto:${report.reporter?.email ?? report.reporter_email}`}
                className="mt-0.5 inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-300">
                <Mail className="h-3 w-3" /> {report.reporter?.email ?? report.reporter_email}
              </a>
            )}
            <p className="mt-1 text-xs text-gray-400">{formatDate(report.created_at)}</p>
          </div>

          {/* 대상 */}
          {report.target_type && report.target_id && (
            <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
              <p className="mb-2 text-xs font-semibold text-gray-400">신고 대상</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-white">
                  {TARGET_LABEL[report.target_type]} · <span className="font-mono text-xs text-gray-400">{report.target_id.slice(0, 8)}...</span>
                </span>
                {targetHref !== '#' && targetHref && (
                  <Link href={targetHref} target="_blank"
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-700 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-gray-700">
                    <ExternalLink className="h-3 w-3" />
                    열기
                  </Link>
                )}
              </div>
              {report.target_type === 'review' && <ReportedReview reviewId={report.target_id} supabase={supabase} />}
            </div>
          )}

          {/* 내용 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-2 text-xs font-semibold text-gray-400">제목 / 사유</p>
            <p className="text-sm font-semibold text-white">{report.subject ?? '(없음)'}</p>
            <p className="mt-3 mb-1.5 text-xs font-semibold text-gray-400">내용</p>
            <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-line">{report.content}</p>
          </div>

          {/* 처리 */}
          <div className="rounded-xl border border-gray-800 bg-gray-800/50 p-4">
            <p className="mb-2 text-xs font-semibold text-gray-400">상태 변경</p>
            <div className="grid grid-cols-4 gap-2">
              {(['open', 'in_progress', 'resolved', 'rejected'] as const).map(s => {
                const m = STATUS_META[s]
                const active = status === s
                return (
                  <button key={s} onClick={() => setStatus(s)}
                    className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all ${
                      active ? m.color : 'border-gray-700 bg-transparent text-gray-400 hover:bg-gray-800'
                    }`}>
                    <m.icon className="h-3 w-3" />
                    {m.label}
                  </button>
                )
              })}
            </div>

            <p className="mt-4 mb-1.5 text-xs font-semibold text-gray-400">관리자 메모 (내부용)</p>
            <textarea
              value={adminNote}
              onChange={e => setAdminNote(e.target.value)}
              rows={3}
              placeholder="처리 과정·결정 사유 등"
              className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />

            {report.resolved_at && (
              <p className="mt-2 text-xs text-gray-400">처리 완료: {formatDate(report.resolved_at)}</p>
            )}
          </div>

          {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{err}</p>}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-gray-800 bg-gray-900 px-6 py-4">
          <button onClick={onClose} disabled={saving}
            className="flex-1 rounded-xl border border-gray-700 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-800 disabled:opacity-50">
            닫기
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
            <Check className="h-4 w-4" />
            {saving ? '저장 중...' : '변경사항 저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ReportedReviewRow {
  rating: number
  content: string | null
  created_at: string
  profiles: { name: string | null } | null
  broker_profiles: { office_name: string | null } | null
}

// 신고된 리뷰 본문. 카드 모양은 관리자 대시보드의 중개사 모달 '고객 리뷰'와 같다.
// undefined = 불러오는 중, null = 없음(작성자가 지웠거나 id 가 틀림)
function ReportedReview({ reviewId, supabase }: {
  reviewId: string
  supabase: ReturnType<typeof createClient>
}) {
  const [review, setReview] = useState<ReportedReviewRow | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('reviews')
      .select('rating, content, created_at, profiles(name), broker_profiles(office_name)')
      .eq('id', reviewId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        // 오류를 '없음'으로 보이면 멀쩡한 리뷰를 지워진 것으로 오판한다
        if (error) { setFailed(true); return }
        setReview((data ?? null) as ReportedReviewRow | null)
      })
    return () => { cancelled = true }
  }, [supabase, reviewId])

  if (failed) return <p className="mt-3 text-xs text-red-400">리뷰를 불러오지 못했어요</p>
  if (review === undefined) {
    return (
      <div className="mt-3 flex items-center justify-center py-2">
        <Spinner size="sm" />
      </div>
    )
  }
  if (!review) return <p className="mt-3 text-xs text-gray-400">리뷰가 없어요 (이미 삭제됐을 수 있어요)</p>

  return (
    <div className="mt-3 rounded-xl border border-gray-700 bg-gray-800/40 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm font-semibold text-white">{review.profiles?.name ?? '(알 수 없음)'}</span>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {[1,2,3,4,5].map(i => (
            <Star key={i} className={`h-3 w-3 ${i <= review.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-400'}`} />
          ))}
        </div>
      </div>
      {review.content && <p className="text-xs text-gray-400 leading-relaxed whitespace-pre-line">{review.content}</p>}
      <p className="mt-1 text-[10px] text-gray-400">
        {review.broker_profiles?.office_name && <>{review.broker_profiles.office_name} · </>}
        {formatDate(review.created_at)}
      </p>
    </div>
  )
}
