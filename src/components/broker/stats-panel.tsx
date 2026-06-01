'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import {
  BarChart3, TrendingUp, MapPin, Calendar,
  Target, Clock, Star, Calculator, FileText, ThumbsUp, Wallet,
  ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react'
import { calcSettlement, fmtComma } from '@/lib/settlement'

type Range = 30 | 90 | 365

interface Bucket { date: string; count: number }
interface Row { key: string; count: number }
interface MonthBucket { month: string; total: number; assignee: number; takeHome: number }

export function BrokerStatsPanel() {
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [range, setRange] = useState<Range>(90)
  const [loading, setLoading] = useState(true)
  const [proposalSeries, setProposalSeries] = useState<{ all: Bucket[]; accepted: Bucket[] }>({ all: [], accepted: [] })
  const [byDealType, setByDealType] = useState<Row[]>([])
  const [byRegion, setByRegion] = useState<Row[]>([])
  const [totals, setTotals] = useState({
    proposals: 0, accepted: 0, rejected: 0, pending: 0,
    acceptanceRate: 0, avgResponseHours: 0, deals: 0, rating: 0, reviewCount: 0,
  })
  const [settlementTotals, setSettlementTotals] = useState({
    count: 0, totalFee: 0, assigneeSum: 0, takeHomeSum: 0,
  })
  const [settlementSeries, setSettlementSeries] = useState<MonthBucket[]>([])
  const [isOwnerView, setIsOwnerView] = useState(false)

  const load = useCallback(async () => {
    if (!auth.user) return
    setLoading(true)

    const { data: broker } = await supabase
      .from('broker_profiles')
      .select('id, deal_count, rating, review_count, is_owner, parent_broker_id')
      .eq('user_id', auth.user.id)
      .single()
    if (!broker) { setLoading(false); return }

    const isOwner = !!broker.is_owner
    const officeId = isOwner ? broker.id : broker.parent_broker_id
    setIsOwnerView(isOwner)

    supabase.rpc('refresh_broker_metrics', { p_broker_id: broker.id }).then(() => {}, () => {})

    const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString()

    const [pAllRes, pRecentRes] = await Promise.all([
      supabase
        .from('proposals')
        .select('id, status, created_at, request_id, request_posts(city, district, deal_type)')
        .eq('broker_id', broker.id),
      supabase
        .from('proposals')
        .select('id, status, created_at, request_id, request_posts(city, district, deal_type)')
        .eq('broker_id', broker.id)
        .gte('created_at', since),
    ])

    const allProps = (pAllRes.data ?? []) as any[]
    const recent = (pRecentRes.data ?? []) as any[]

    const accepted = allProps.filter(p => p.status === 'accepted').length
    const rejected = allProps.filter(p => p.status === 'rejected').length
    const pending = allProps.filter(p => p.status === 'pending').length
    const acceptanceRate = allProps.length > 0 ? Math.round((accepted / allProps.length) * 100) : 0

    const proposalIds = recent.map(p => p.id)
    let avgResponseHours = 0
    if (proposalIds.length > 0) {
      const { data: rooms } = await supabase
        .from('chat_rooms')
        .select('id, proposal_id, broker_id')
        .in('proposal_id', proposalIds)
      const roomIds = (rooms ?? []).map(r => r.id)
      const brokerUserId = auth.user.id
      if (roomIds.length > 0) {
        const { data: msgs } = await supabase
          .from('chat_messages')
          .select('room_id, sender_id, created_at')
          .in('room_id', roomIds)
          .eq('sender_id', brokerUserId)
          .order('created_at', { ascending: true })

        const firstMsgByRoom = new Map<string, string>()
        ;(msgs ?? []).forEach(m => {
          if (!firstMsgByRoom.has(m.room_id)) firstMsgByRoom.set(m.room_id, m.created_at)
        })
        const roomToProposal = new Map<string, string>()
        ;(rooms ?? []).forEach(r => { if (r.proposal_id) roomToProposal.set(r.id, r.proposal_id) })
        const proposalCreated = new Map(recent.map(p => [p.id, p.created_at]))

        const diffs: number[] = []
        firstMsgByRoom.forEach((msgAt, roomId) => {
          const propId = roomToProposal.get(roomId)
          if (!propId) return
          const propAt = proposalCreated.get(propId)
          if (!propAt) return
          const h = (new Date(msgAt).getTime() - new Date(propAt).getTime()) / (60 * 60 * 1000)
          if (h >= 0) diffs.push(h)
        })
        if (diffs.length > 0) {
          avgResponseHours = diffs.reduce((a, b) => a + b, 0) / diffs.length
        }
      }
    }

    setTotals({
      proposals: allProps.length,
      accepted, rejected, pending,
      acceptanceRate,
      avgResponseHours,
      deals: broker.deal_count ?? 0,
      rating: Number(broker.rating ?? 0),
      reviewCount: broker.review_count ?? 0,
    })

    const allMap = new Map<string, number>()
    const accMap = new Map<string, number>()
    recent.forEach(p => {
      const d = p.created_at.slice(0, 10)
      allMap.set(d, (allMap.get(d) ?? 0) + 1)
      if (p.status === 'accepted') accMap.set(d, (accMap.get(d) ?? 0) + 1)
    })
    setProposalSeries({
      all: fillSeries(allMap, range),
      accepted: fillSeries(accMap, range),
    })

    const dtMap = new Map<string, number>()
    recent.forEach(p => {
      const dt = p.request_posts?.deal_type?.split(',')?.[0]?.trim() || '기타'
      dtMap.set(dt, (dtMap.get(dt) ?? 0) + 1)
    })
    setByDealType(Array.from(dtMap.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count))

    const regMap = new Map<string, number>()
    recent.forEach(p => {
      const region = [p.request_posts?.city, p.request_posts?.district].filter(Boolean).join(' ') || '미지정'
      regMap.set(region, (regMap.get(region) ?? 0) + 1)
    })
    setByRegion(Array.from(regMap.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 10))

    // ── 정산 데이터 ─────────────────────────────────────────
    // 카드 합계 기간: 30일=1개월, 90일=3개월, 365일=12개월
    // 차트 추이: 365일이면 12개월, 그 외엔 항상 6개월 (상승·하락 비교 위해 단발성 1개월은 무의미)
    const totalMonths = range === 30 ? 1 : range === 90 ? 3 : 12
    const chartMonths = range === 365 ? 12 : 6
    const now = new Date()
    const months: string[] = []
    for (let i = chartMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    // 카드 집계 대상 (차트 기간의 마지막 N개월)
    const totalMonthSet = new Set(months.slice(-totalMonths))

    if (officeId) {
      let sq = supabase
        .from('settlements')
        .select('id, settlement_rate, seller_fee, buyer_fee, withhold_exempt, vat_override, record_month, assignee_broker_id')
        .in('record_month', months)
      sq = isOwner
        ? sq.eq('office_broker_id', officeId)
        : sq.eq('assignee_broker_id', broker.id)

      const { data: sRows } = await sq
      const settlements = (sRows ?? []) as any[]

      let count = 0, totalFee = 0, assigneeSum = 0, takeHomeSum = 0
      const monthMap = new Map<string, { total: number; assignee: number; takeHome: number }>()
      for (const m of months) monthMap.set(m, { total: 0, assignee: 0, takeHome: 0 })

      for (const s of settlements) {
        const c = calcSettlement(s)
        const m = monthMap.get(s.record_month)
        if (m) {
          m.total += c.total
          m.assignee += c.assignee
          m.takeHome += c.takeHome
        }
        // 카드 합계는 사용자가 선택한 range 기간만
        if (totalMonthSet.has(s.record_month)) {
          count += 1
          totalFee += c.total
          assigneeSum += c.assignee
          takeHomeSum += c.takeHome
        }
      }
      setSettlementTotals({ count, totalFee, assigneeSum, takeHomeSum })
      setSettlementSeries(months.map(m => ({ month: m, ...(monthMap.get(m)!) })))
    } else {
      setSettlementTotals({ count: 0, totalFee: 0, assigneeSum: 0, takeHomeSum: 0 })
      setSettlementSeries(months.map(m => ({ month: m, total: 0, assignee: 0, takeHome: 0 })))
    }

    setLoading(false)
  }, [auth.user, range, supabase])

  useEffect(() => {
    if (auth.profile?.role === 'broker') load()
  }, [auth.profile?.role, load])

  if (auth.loading || auth.profile?.role !== 'broker') return null

  const formatHours = (h: number) => {
    if (h < 1) return `${Math.round(h * 60)}분`
    if (h < 24) return `${h.toFixed(1)}시간`
    return `${(h / 24).toFixed(1)}일`
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-blue-600" />
          <h2 className="font-bold text-gray-900 dark:text-white">실적 분석</h2>
          <span className="text-xs text-gray-500">· 제안·수락·응답 시간을 한눈에</span>
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-1">
          {([30, 90, 365] as const).map(d => (
            <button key={d} onClick={() => setRange(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                range === d ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}>
              {d === 365 ? '1년' : `${d}일`}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <Summary icon={Target} label="수락률" value={`${totals.acceptanceRate}%`} sub={`전체 ${totals.proposals}건`} color="bg-blue-50 text-blue-500" />
            <Summary icon={Clock} label="평균 응답" value={totals.avgResponseHours > 0 ? formatHours(totals.avgResponseHours) : '—'} sub={`${range}일 기준`} color="bg-emerald-50 text-emerald-500" />
            <Summary icon={Star} label="평점" value={totals.rating > 0 ? totals.rating.toFixed(1) : '신규'} sub={`리뷰 ${totals.reviewCount}개`} color="bg-amber-50 text-amber-500" />
            <Summary icon={TrendingUp} label="총 거래" value={`${totals.deals}건`} sub="누적" color="bg-purple-50 text-purple-500" />
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <MiniStat label="대기 중" value={totals.pending} color="text-yellow-600 bg-yellow-50" />
            <MiniStat label="수락됨" value={totals.accepted} color="text-green-600 bg-green-50" />
            <MiniStat label="거절됨" value={totals.rejected} color="text-red-600 bg-red-50" />
          </div>

          <ChartCard title="제안 추이" icon={TrendingUp} subtitle={`최근 ${range}일`}>
            <DualBars
              primary={proposalSeries.all} primaryLabel="전체" primaryColor="bg-blue-500"
              secondary={proposalSeries.accepted} secondaryLabel="수락됨" secondaryColor="bg-green-500"
            />
          </ChartCard>

          {/* ── 정산 요약 ─────────────────────────────────── */}
          <div className="mt-6 mb-3 flex items-center gap-2">
            <Calculator className="h-5 w-5 text-teal-600" />
            <h3 className="font-bold text-gray-900 dark:text-white">정산 요약</h3>
            <span className="text-xs text-gray-500">
              · {isOwnerView ? '사무소 전체' : '내 담당'} · 최근 {range === 30 ? '1개월' : range === 90 ? '3개월' : '12개월'} 기록월 기준
            </span>
          </div>
          {(() => {
            // 마지막 2개월 비교 → 전월 대비 증감 화살표
            const last = settlementSeries[settlementSeries.length - 1]
            const prev = settlementSeries[settlementSeries.length - 2]
            const totalDelta = last && prev ? deltaPct(last.total, prev.total) : null
            const assigneeDelta = last && prev ? deltaPct(last.assignee, prev.assignee) : null
            const takeHomeDelta = last && prev ? deltaPct(last.takeHome, prev.takeHome) : null
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <SettlementCard icon={FileText} label="계약 건수" value={`${settlementTotals.count}건`} sub="정산 등록 기준" color="bg-gray-50 text-gray-500" />
                <SettlementCard icon={Calculator} label="총수수료" value={`${fmtComma(settlementTotals.totalFee)}원`} sub="매도+매수 합" color="bg-teal-50 text-teal-500" delta={totalDelta} />
                <SettlementCard icon={ThumbsUp} label={isOwnerView ? '담당자 몫' : '내 수수료'} value={`${fmtComma(settlementTotals.assigneeSum)}원`} sub="원천 전" color="bg-blue-50 text-blue-500" delta={assigneeDelta} />
                <SettlementCard icon={Wallet} label="실수령" value={`${fmtComma(settlementTotals.takeHomeSum)}원`} sub="원천 후" color="bg-indigo-50 text-indigo-500" delta={takeHomeDelta} />
              </div>
            )
          })()}

          <ChartCard title="월별 수수료 추이" icon={TrendingUp} subtitle={`최근 ${settlementSeries.length}개월 · 상승·하락 한눈에`}>
            <SettlementLineChart series={settlementSeries} isOwnerView={isOwnerView} />
          </ChartCard>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <ChartCard title="거래 유형별" icon={Calendar}>
              <RankBars rows={byDealType} barColor="bg-blue-400" />
            </ChartCard>
            <ChartCard title="지역별 활동" icon={MapPin}>
              <RankBars rows={byRegion} barColor="bg-purple-400" />
            </ChartCard>
          </div>
        </>
      )}
    </div>
  )
}

function fillSeries(map: Map<string, number>, days: number): Bucket[] {
  const out: Bucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    out.push({ date: d, count: map.get(d) ?? 0 })
  }
  return out
}

function Summary({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className={`mb-2 inline-flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-black text-gray-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">{sub}</p>
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-xl ${color} px-4 py-3 text-center`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-[11px] font-medium">{label}</p>
    </div>
  )
}

function ChartCard({ title, icon: Icon, subtitle, children }: { title: string; icon: any; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-gray-500" />
        <h3 className="font-bold text-gray-900 dark:text-white">{title}</h3>
        {subtitle && <span className="text-xs text-gray-500">· {subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function DualBars({ primary, primaryLabel, primaryColor, secondary, secondaryLabel, secondaryColor }: {
  primary: Bucket[]; primaryLabel: string; primaryColor: string
  secondary: Bucket[]; secondaryLabel: string; secondaryColor: string
}) {
  const max = Math.max(1, ...primary.map(p => p.count), ...secondary.map(s => s.count))
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className={`h-2 w-3 rounded-sm ${primaryColor}`} />{primaryLabel}</span>
        <span className="flex items-center gap-1.5"><span className={`h-2 w-3 rounded-sm ${secondaryColor}`} />{secondaryLabel}</span>
      </div>
      <div className="flex items-end gap-0.5 h-32">
        {primary.map((b, i) => {
          const s = secondary[i]
          return (
            <div key={i} className="flex-1 flex items-end gap-px h-full justify-center">
              <div className={`${primaryColor} rounded-t-sm flex-1`} style={{ height: `${(b.count / max) * 100}%` }} />
              <div className={`${secondaryColor} rounded-t-sm flex-1`} style={{ height: `${((s?.count ?? 0) / max) * 100}%` }} />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-gray-500">
        <span>{primary[0]?.date.slice(5)}</span>
        <span>{primary[primary.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  )
}

function deltaPct(curr: number, prev: number): number | null {
  if (prev === 0) return curr === 0 ? 0 : null  // 전월 0이면 % 무의미
  return Math.round(((curr - prev) / prev) * 100)
}

function SettlementCard({ icon: Icon, label, value, sub, color, delta }: {
  icon: any; label: string; value: string; sub: string; color: string; delta?: number | null
}) {
  const showDelta = delta != null
  const isUp = (delta ?? 0) > 0
  const isDown = (delta ?? 0) < 0
  const DeltaIcon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus
  const deltaCls = isUp ? 'text-emerald-600 bg-emerald-50'
    : isDown ? 'text-red-600 bg-red-50'
    : 'text-gray-500 bg-gray-100'
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
          <Icon className="h-4 w-4" />
        </div>
        {showDelta && (
          <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${deltaCls}`} title="전월 대비">
            <DeltaIcon className="h-3 w-3" />
            {Math.abs(delta!)}%
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-black text-gray-900 dark:text-white">{value}</p>
      <p className="mt-0.5 text-[11px] text-gray-500">{sub}</p>
    </div>
  )
}

// 월별 수수료 추이 — SVG 라인 차트 (상승·하락 한눈에)
function SettlementLineChart({ series, isOwnerView }: { series: MonthBucket[]; isOwnerView: boolean }) {
  if (series.every(s => s.total === 0)) {
    return <p className="py-8 text-center text-sm text-gray-500">해당 기간 정산 데이터가 없어요</p>
  }
  const W = 600, H = 200, P = 32  // viewBox / padding
  const max = Math.max(1, ...series.map(s => Math.max(s.total, s.assignee)))
  const xStep = (W - P * 2) / Math.max(1, series.length - 1)
  const yOf = (v: number) => H - P - (v / max) * (H - P * 2)
  const xOf = (i: number) => P + i * xStep

  const pathOf = (key: 'total' | 'assignee') =>
    series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(s[key])}`).join(' ')

  const areaOf = (key: 'total' | 'assignee') => {
    const top = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i)} ${yOf(s[key])}`).join(' ')
    return `${top} L ${xOf(series.length - 1)} ${H - P} L ${xOf(0)} ${H - P} Z`
  }

  // y축 눈금 (3단계)
  const yTicks = [0, max / 2, max]
  const assigneeLabel = isOwnerView ? '담당자 몫' : '내 수수료'

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-teal-500" />총수수료</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-blue-500" />{assigneeLabel}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48" preserveAspectRatio="none">
        <defs>
          <linearGradient id="grad-total" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="grad-assignee" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* y축 가이드라인 */}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={P} y1={yOf(t)} x2={W - P} y2={yOf(t)} stroke="#e5e7eb" strokeDasharray="3 3" />
            <text x={P - 6} y={yOf(t) + 3} textAnchor="end" fontSize="9" fill="#9ca3af">
              {t === 0 ? '0' : t >= 10000000 ? `${Math.round(t / 10000000)}천만` : t >= 10000 ? `${Math.round(t / 10000)}만` : Math.round(t)}
            </text>
          </g>
        ))}

        {/* 면적 (총수수료) */}
        <path d={areaOf('total')} fill="url(#grad-total)" />
        {/* 라인 (총수수료) */}
        <path d={pathOf('total')} fill="none" stroke="#14b8a6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {/* 면적 (담당자) */}
        <path d={areaOf('assignee')} fill="url(#grad-assignee)" />
        {/* 라인 (담당자) */}
        <path d={pathOf('assignee')} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* 데이터 포인트 + 값 */}
        {series.map((s, i) => {
          const isLast = i === series.length - 1
          return (
            <g key={s.month}>
              <circle cx={xOf(i)} cy={yOf(s.total)} r={isLast ? 4 : 3} fill="#14b8a6" stroke="white" strokeWidth="1.5" />
              <circle cx={xOf(i)} cy={yOf(s.assignee)} r={isLast ? 4 : 3} fill="#3b82f6" stroke="white" strokeWidth="1.5" />
              {/* x축 라벨 */}
              <text x={xOf(i)} y={H - P + 14} textAnchor="middle" fontSize="10" fill="#6b7280">
                {Number(s.month.slice(5))}월
              </text>
              {/* 마지막 점 값 강조 */}
              {isLast && s.total > 0 && (
                <text x={xOf(i)} y={yOf(s.total) - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill="#0f766e">
                  {fmtComma(s.total)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function RankBars({ rows, barColor }: { rows: Row[]; barColor: string }) {
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-gray-500">데이터가 없어요</p>
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.key}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-700 dark:text-gray-300"><span className="text-gray-500 mr-1.5">{i + 1}.</span>{r.key}</span>
            <span className="font-bold text-gray-900 dark:text-white">{r.count}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div className={`h-full ${barColor} rounded-full`} style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
