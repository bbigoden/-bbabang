'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import { Card, CardBody } from '@/components/ui/card'
import {
  ArrowLeft, Plus, Settings, Search, Copy, Trash2, FileText, Send,
  TrendingUp, Trophy, Clock, CalendarClock,
} from 'lucide-react'
import {
  calcStats, fmtComma, isExpired, STATUS_LABEL,
  type Estimate, type EstimateStatus,
} from '@/lib/estimate'

type Period = 'month' | 'year' | 'all'

const PERIOD_LABEL: Record<Period, string> = { month: '이번 달', year: '올해', all: '전체' }

/** 기간 시작일(YYYY-MM-DD). all이면 null */
function periodStart(p: Period, today = new Date()): string | null {
  if (p === 'all') return null
  const y = today.getFullYear()
  if (p === 'year') return `${y}-01-01`
  return `${y}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
}

const STATUS_STYLE: Record<EstimateStatus, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  sent:  'bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  won:   'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
  lost:  'bg-red-50 text-red-600 dark:bg-red-500/20 dark:text-red-300',
}

export default function EstimatesPage() {
  const router = useRouter()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const { broker, loading: authLoading } = useAuth()

  const [rows, setRows] = useState<Estimate[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | EstimateStatus>('all')
  const [period, setPeriod] = useState<Period>('month')

  const brokerId = broker?.id ?? null

  const load = useCallback(async () => {
    if (!brokerId) return
    setLoading(true)
    // PostgREST는 1000행에서 조용히 잘린다 — 하루 1~2건이라도 2년이면 닿는다
    try {
      const data = await fetchAllPaged<Estimate>((from, to) =>
        supabase
          .from('estimates')
          .select('*')
          .eq('owner_broker_id', brokerId)
          .order('issue_date', { ascending: false })
          .order('created_at', { ascending: false })
          .range(from, to)
      )
      setRows(data)
    } catch {
      toast.error('견적서를 불러오지 못했습니다')
    }
    setLoading(false)
    // toast는 매 렌더 새 객체라 의존성에서 제외 (다른 페이지들과 동일 패턴)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokerId, supabase])

  useEffect(() => { if (brokerId) load() }, [brokerId, load])

  // 새 견적: draft 행을 먼저 만들고 상세로 이동 (별도 new 라우트 불필요)
  const createNew = async () => {
    if (!brokerId || creating) return
    setCreating(true)
    try {
      const { data: noData, error: noErr } = await supabase.rpc('next_estimate_no', { p_owner: brokerId })
      if (noErr) throw noErr

      // 기본 회사가 있으면 미리 물려둔다
      const { data: comp } = await supabase
        .from('estimate_companies')
        .select('*')
        .eq('owner_broker_id', brokerId)
        .order('is_default', { ascending: false })
        .order('sort_order')
        .limit(1)
        .maybeSingle()

      const { data, error } = await supabase
        .from('estimates')
        .insert({
          owner_broker_id: brokerId,
          estimate_no: noData as string,
          company_id: comp?.id ?? null,
          company_snapshot: comp ?? null,
          notes: comp?.default_notes ?? null,
        })
        .select('id')
        .single()
      if (error) throw error
      router.push(`/broker/estimates/${data.id}`)
    } catch {
      toast.error('견적서를 만들지 못했습니다')
      setCreating(false)
    }
  }

  const duplicate = async (src: Estimate) => {
    if (!brokerId) return
    try {
      const { data: noData } = await supabase.rpc('next_estimate_no', { p_owner: brokerId })
      const { id: _id, created_at: _c, sent_at: _s, ...rest } = src
      const { data, error } = await supabase
        .from('estimates')
        .insert({
          ...rest,
          owner_broker_id: brokerId,
          estimate_no: noData as string,
          issue_date: new Date().toISOString().slice(0, 10),
          status: 'draft',
          sent_at: null,
        })
        .select('id')
        .single()
      if (error) throw error

      const { data: items } = await supabase
        .from('estimate_items').select('*').eq('estimate_id', src.id).order('sort_order')
      if (items?.length) {
        await supabase.from('estimate_items').insert(
          items.map(({ id: _i, estimate_id: _e, ...it }) => ({ ...it, estimate_id: data.id }))
        )
      }
      toast.success('복사했습니다')
      router.push(`/broker/estimates/${data.id}`)
    } catch {
      toast.error('복사하지 못했습니다')
    }
  }

  const remove = async (row: Estimate) => {
    if (!confirm(`${row.estimate_no} 견적서를 삭제할까요?\n삭제하면 되돌릴 수 없습니다.`)) return
    const { error } = await supabase.from('estimates').delete().eq('id', row.id)
    if (error) { toast.error('삭제하지 못했습니다'); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
    toast.success('삭제했습니다')
  }

  // 요약은 기간만 반영한다 (검색어·상태 필터와 무관하게 그 기간의 전체 실적)
  const inPeriod = useMemo(() => {
    const from = periodStart(period)
    return from ? rows.filter(r => r.issue_date >= from) : rows
  }, [rows, period])

  const stats = useMemo(() => calcStats(inPeriod), [inPeriod])

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return inPeriod.filter(r => {
      if (status !== 'all' && r.status !== status) return false
      if (!kw) return true
      return [r.estimate_no, r.client_name, r.project_name, r.site_address]
        .some(v => (v ?? '').toLowerCase().includes(kw))
    })
  }, [inPeriod, q, status])

  const sumTotal = useMemo(() => filtered.reduce((s, r) => s + (r.total || 0), 0), [filtered])

  if (authLoading) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="px-4 py-8 text-center text-sm text-gray-500">불러오는 중…</div>
      </div>
    )
  }

  if (!broker) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          사무소 정보를 찾을 수 없습니다. <Link href="/broker/register" className="text-blue-600 underline">사무소 등록</Link>이 필요합니다.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950 overflow-x-hidden">
      <Header />

      <div className="px-4 py-6">
        <div className="mb-2 flex items-center gap-3">
          <button onClick={() => router.back()} aria-label="뒤로 가기" title="뒤로" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-black text-gray-900 dark:text-white">견적서</h1>
          <Link
            href="/broker/estimates/settings"
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
          >
            <Settings className="h-4 w-4" />설정
          </Link>
          <button
            onClick={createNew}
            disabled={creating}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />새 견적
          </button>
        </div>
        <p className="mb-4 ml-11 text-xs text-gray-500 dark:text-gray-500">
          공사·인테리어 견적서를 만들고 PDF로 메일 발송합니다. 임대 고객목록과는 별개로 관리됩니다.
        </p>

        {/* 기간별 실적 요약 */}
        <div className="mb-4">
          <div className="mb-2 flex items-center gap-1">
            {(Object.keys(PERIOD_LABEL) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
                  period === p
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                }`}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard icon={TrendingUp} label="견적" main={`${stats.count}건`}
              sub={`${fmtComma(stats.amount)}원`} />
            <StatCard icon={Trophy} label="수주" main={`${stats.wonCount}건`}
              sub={`${fmtComma(stats.wonAmount)}원`} tone="emerald" />
            <StatCard icon={Trophy} label="수주율"
              main={stats.winRate == null ? '—' : `${Math.round(stats.winRate * 100)}%`}
              sub={stats.winRate == null ? '결론난 건 없음' : `수주 ${stats.wonCount} / 실주 ${stats.lostCount}`} />
            <StatCard icon={Clock} label="진행중" main={`${stats.openCount}건`}
              sub="작성중 + 발송함" tone="blue" />
          </div>
        </div>

        {/* 검색 + 상태 필터 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="견적번호·거래처·공사명"
              aria-label="견적서 검색"
              className="w-60 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <div className="flex gap-1">
            {([['all', '전체'], ['draft', '작성중'], ['sent', '발송함'], ['won', '수주'], ['lost', '실주']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setStatus(v as 'all' | EstimateStatus)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  status === v
                    ? 'bg-blue-600 text-white'
                    : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-sm text-gray-500">
            {filtered.length}건 · 합계 <b className="text-gray-900 dark:text-white">{fmtComma(sumTotal)}</b>원
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardBody className="py-12 text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-700" />
              <p className="text-sm text-gray-500">
                {rows.length === 0 ? '아직 만든 견적서가 없습니다.' : '조건에 맞는 견적서가 없습니다.'}
              </p>
              {rows.length === 0 && (
                <button onClick={createNew} disabled={creating} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                  첫 견적서 만들기
                </button>
              )}
            </CardBody>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950/50">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold">견적번호</th>
                  <th className="px-3 py-2.5 text-left font-semibold">발행일</th>
                  <th className="px-3 py-2.5 text-left font-semibold">거래처</th>
                  <th className="px-3 py-2.5 text-left font-semibold">공사명</th>
                  <th className="px-3 py-2.5 text-right font-semibold">합계</th>
                  <th className="px-3 py-2.5 text-center font-semibold">상태</th>
                  <th className="px-3 py-2.5 text-center font-semibold">관리</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    onClick={() => router.push(`/broker/estimates/${r.id}`)}
                    className={`cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-800/40 ${
                      isExpired(r) ? 'opacity-60' : ''
                    }`}
                  >
                    <td className="px-3 py-3 font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">{r.estimate_no}</td>
                    <td className="px-3 py-3 text-gray-500">
                      <div className="flex items-center gap-1.5">
                        {r.issue_date}
                        {isExpired(r) && (
                          <span title="유효기간이 지났습니다"
                            className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                            <CalendarClock className="h-3 w-3" />만료
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 font-semibold text-gray-900 dark:text-white">{r.client_name || '—'}</td>
                    <td className="max-w-[16rem] truncate px-3 py-3 text-gray-600 dark:text-gray-400">{r.project_name || '—'}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900 dark:text-white">{fmtComma(r.total)}</td>
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_STYLE[r.status]}`}>
                        {r.status === 'sent' && <Send className="h-3 w-3" />}
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); duplicate(r) }}
                          title="복사해서 새 견적"
                          aria-label="복사해서 새 견적"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); remove(r) }}
                          title="삭제"
                          aria-label="삭제"
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, main, sub, tone }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  main: string
  sub: string
  tone?: 'emerald' | 'blue'
}) {
  const mainCls = tone === 'emerald'
    ? 'text-emerald-700 dark:text-emerald-300'
    : tone === 'blue'
    ? 'text-blue-700 dark:text-blue-300'
    : 'text-gray-900 dark:text-white'

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-3.5 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-400">
        <Icon className="h-3.5 w-3.5" />{label}
      </div>
      <p className={`text-xl font-black ${mainCls}`}>{main}</p>
      <p className="mt-0.5 truncate text-xs text-gray-500">{sub}</p>
    </div>
  )
}
