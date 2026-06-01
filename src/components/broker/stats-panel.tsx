'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import {
  BarChart3, TrendingUp, MapPin, Calendar,
  Target, Clock, Star, Calculator,
} from 'lucide-react'
import { calcSettlement, fmtComma } from '@/lib/settlement'

type Range = 30 | 90 | 365

interface Bucket { date: string; count: number }
interface Row { key: string; count: number }
interface MonthBucket { month: string; total: number; supply: number; assignee: number; takeHome: number; count: number }
interface Member { id: string; name: string }

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
  const [settlementSeries, setSettlementSeries] = useState<MonthBucket[]>([])
  const [isOwnerView, setIsOwnerView] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  // 정산 직원 필터 — '' = 사무소 전체, <broker_id> = 그 직원만
  const [settlementAssigneeId, setSettlementAssigneeId] = useState<string>('')

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

    // 대표일 때만 사무소 멤버 목록 로드 (직원 필터용)
    if (isOwner && officeId) {
      const { data: mems } = await supabase
        .from('broker_profiles')
        .select('id, is_owner, is_approved, profiles:user_id(name)')
        .or(`id.eq.${officeId},parent_broker_id.eq.${officeId}`)
      const list: Member[] = ((mems ?? []) as any[])
        .filter(m => m.is_owner || m.is_approved)
        .map(m => ({ id: m.id, name: m.profiles?.name ?? '이름 없음' }))
      setMembers(list)
    }

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
    // 카드 = '이번 달(가장 최근 기록월)' 단일 — 정산 페이지와 동일 사고방식
    // 차트 추이: 365일이면 12개월, 그 외엔 6개월 (월별 상승·하락 비교)
    const chartMonths = range === 365 ? 12 : 6
    const now = new Date()
    const months: string[] = []
    for (let i = chartMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    if (officeId) {
      let sq = supabase
        .from('settlements')
        .select('id, settlement_rate, seller_fee, buyer_fee, withhold_exempt, vat_override, record_month, assignee_broker_id')
        .in('record_month', months)
      if (isOwner) {
        sq = sq.eq('office_broker_id', officeId)
        // 대표가 특정 직원 필터를 걸었으면 그 직원 정산만
        if (settlementAssigneeId) sq = sq.eq('assignee_broker_id', settlementAssigneeId)
      } else {
        sq = sq.eq('assignee_broker_id', broker.id)
      }

      const { data: sRows } = await sq
      const settlements = (sRows ?? []) as any[]

      const monthMap = new Map<string, { total: number; supply: number; assignee: number; takeHome: number; count: number }>()
      for (const m of months) monthMap.set(m, { total: 0, supply: 0, assignee: 0, takeHome: 0, count: 0 })

      for (const s of settlements) {
        const c = calcSettlement(s)
        const m = monthMap.get(s.record_month)
        if (m) {
          m.total += c.total
          m.supply += c.supply
          m.assignee += c.assignee
          m.takeHome += c.takeHome
          m.count += 1
        }
      }
      setSettlementSeries(months.map(m => ({ month: m, ...(monthMap.get(m)!) })))
    } else {
      setSettlementSeries(months.map(m => ({ month: m, total: 0, supply: 0, assignee: 0, takeHome: 0, count: 0 })))
    }

    setLoading(false)
  }, [auth.user, range, supabase, settlementAssigneeId])

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

          {/* ── 정산 요약 ─ 정산 페이지와 동일한 3카드 구조 ─── */}
          {(() => {
            const last = settlementSeries[settlementSeries.length - 1] ?? { total: 0, supply: 0, assignee: 0, takeHome: 0, count: 0, month: '' }
            const prev = settlementSeries[settlementSeries.length - 2] ?? null
            const officeShare = Math.max(0, last.supply - last.assignee)
            const labelMonth = last.month ? `${Number(last.month.slice(5))}월` : '이번 달'
            return (
              <>
                <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-5 w-5 text-teal-600" />
                    <h3 className="font-bold text-gray-900 dark:text-white">정산 요약</h3>
                    <span className="text-xs text-gray-500">
                      · {isOwnerView
                        ? (settlementAssigneeId
                            ? `${members.find(m => m.id === settlementAssigneeId)?.name ?? '직원'} 담당`
                            : '사무소 전체')
                        : '내 담당'} · {labelMonth} 기록월 기준
                    </span>
                  </div>
                  {/* 대표 전용: 직원 필터 셀렉트 */}
                  {isOwnerView && members.length > 0 && (
                    <select
                      value={settlementAssigneeId}
                      onChange={e => setSettlementAssigneeId(e.target.value)}
                      aria-label="정산 직원 필터"
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${
                        settlementAssigneeId
                          ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300'
                          : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
                      }`}
                    >
                      <option value="">전체 직원</option>
                      {members.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* 정산 페이지와 동일한 3카드 구조 */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3 mb-4">
                  {/* 카드 1: 전체 (총수수료 = 공급가 + VAT) */}
                  <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[11px] font-medium text-gray-500">전체</p>
                      <p className="text-[11px] font-semibold text-gray-500">총 {last.count}건</p>
                    </div>
                    <p className="mt-1 text-xl font-black text-gray-900 dark:text-white">
                      {fmtComma(last.total)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      = 공급가 {fmtComma(last.supply)} + VAT {fmtComma(last.total - last.supply)}
                    </p>
                  </div>

                  {/* 카드 2: 담당자 */}
                  <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                    <p className="text-[11px] font-medium text-gray-500">담당자</p>
                    <p className="mt-1 text-xl font-black text-blue-700 dark:text-blue-300">
                      {fmtComma(last.assignee)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      = 실수령 {fmtComma(last.takeHome)} + 원천 {fmtComma(last.assignee - last.takeHome)}
                    </p>
                  </div>

                  {/* 카드 3: 대표=사무실 수익 + 전월 대비% / 직원=전월 대비 */}
                  {isOwnerView ? (
                    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                      <div className="flex items-baseline justify-between">
                        <p className="text-[11px] font-medium text-gray-500">사무실</p>
                        {(() => {
                          const prevShare = prev ? Math.max(0, prev.supply - prev.assignee) : 0
                          if (!prev || prevShare === 0) {
                            return officeShare > 0
                              ? <span className="text-[10px] font-bold text-gray-500">신규</span>
                              : null
                          }
                          const pct = Math.round(((officeShare - prevShare) / prevShare) * 100)
                          const cls = pct >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'
                          return (
                            <span className={`text-[10px] font-bold ${cls}`} title={`전월 ${fmtComma(prevShare)}원`}>
                              전월比 {pct >= 0 ? '+' : ''}{pct}%
                            </span>
                          )
                        })()}
                      </div>
                      <p className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-300">
                        {fmtComma(officeShare)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span>
                      </p>
                      <p className="mt-0.5 text-[10px] text-gray-500">
                        = 공급가 {fmtComma(last.supply)} − 담당자 {fmtComma(last.assignee)}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
                      <p className="text-[11px] font-medium text-gray-500">전월 대비</p>
                      {(() => {
                        if (!prev || prev.takeHome === 0) {
                          if (last.takeHome === 0) return <p className="mt-1 text-xl font-black text-gray-500">—</p>
                          return (<>
                            <p className="mt-1 text-xl font-black text-gray-500">신규</p>
                            <p className="mt-0.5 text-[10px] text-gray-500">전월 데이터 없음</p>
                          </>)
                        }
                        const pct = Math.round(((last.takeHome - prev.takeHome) / prev.takeHome) * 100)
                        const cls = pct >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'
                        return (<>
                          <p className={`mt-1 text-xl font-black ${cls}`}>{pct >= 0 ? '+' : ''}{pct}<span className="ml-0.5 text-xs font-medium text-gray-500">%</span></p>
                          <p className="mt-0.5 text-[10px] text-gray-500">전월 실수령 {fmtComma(prev.takeHome)}원</p>
                        </>)
                      })()}
                    </div>
                  )}
                </div>
              </>
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
