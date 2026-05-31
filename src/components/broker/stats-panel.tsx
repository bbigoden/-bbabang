'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import {
  BarChart3, TrendingUp, MapPin, Calendar,
  Target, Clock, Star,
} from 'lucide-react'

type Range = 30 | 90 | 365

interface Bucket { date: string; count: number }
interface Row { key: string; count: number }

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

  const load = useCallback(async () => {
    if (!auth.user) return
    setLoading(true)

    const { data: broker } = await supabase
      .from('broker_profiles')
      .select('id, deal_count, rating, review_count')
      .eq('user_id', auth.user.id)
      .single()
    if (!broker) { setLoading(false); return }

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
