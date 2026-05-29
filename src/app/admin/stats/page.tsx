'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { propertyStatusLabel } from '@/lib/property-status'
import {
  BarChart3, ArrowLeft, Users, FileText, Home, TrendingUp,
  MapPin, Calendar, Building2, Download
} from 'lucide-react'

type Range = 7 | 30 | 90

interface TimeBucket { date: string; count: number }
interface RegionRow { region: string; count: number }
interface FunnelStage { key: string; label: string; count: number; color: string }

export default function AdminStatsPage() {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [range, setRange] = useState<Range>(30)
  const [loading, setLoading] = useState(true)
  const [signupSeries, setSignupSeries] = useState<{ user: TimeBucket[]; broker: TimeBucket[] }>({ user: [], broker: [] })
  const [requestSeries, setRequestSeries] = useState<TimeBucket[]>([])
  const [regionRequests, setRegionRequests] = useState<RegionRow[]>([])
  const [regionProperties, setRegionProperties] = useState<RegionRow[]>([])
  const [dealTypes, setDealTypes] = useState<RegionRow[]>([])
  const [propStatus, setPropStatus] = useState<RegionRow[]>([])
  const [totals, setTotals] = useState({ newUsers: 0, newBrokers: 0, newRequests: 0, newProperties: 0 })
  const [funnel, setFunnel] = useState<FunnelStage[]>([])

  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'admin') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  const load = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - range * 24 * 60 * 60 * 1000).toISOString()

    const [
      { data: profs },
      { data: reqs },
      { data: regionReqs },
      { data: props },
      { data: dts },
      { data: pst },
      { count: newPropertiesCount },
    ] = await Promise.all([
      supabase.from('profiles').select('created_at, role').gte('created_at', since),
      supabase.from('request_posts').select('created_at').gte('created_at', since),
      supabase.from('request_posts').select('city'),
      supabase.from('broker_profiles').select('district'),
      supabase.from('request_posts').select('deal_type'),
      supabase.from('broker_properties').select('status'),
      supabase.from('broker_properties').select('*', { count: 'exact', head: true }).gte('created_at', since),
    ])

    // 일별 가입 추이 (user vs broker)
    const userMap = new Map<string, number>()
    const brokerMap = new Map<string, number>()
    ;(profs ?? []).forEach(p => {
      if (!p.created_at) return
      const d = p.created_at.slice(0, 10)
      if (p.role === 'broker') brokerMap.set(d, (brokerMap.get(d) ?? 0) + 1)
      else userMap.set(d, (userMap.get(d) ?? 0) + 1)
    })
    setSignupSeries({
      user: fillSeries(userMap, range),
      broker: fillSeries(brokerMap, range),
    })

    // 일별 요청 추이
    const reqMap = new Map<string, number>()
    ;(reqs ?? []).forEach(r => {
      if (!r.created_at) return
      const d = r.created_at.slice(0, 10)
      reqMap.set(d, (reqMap.get(d) ?? 0) + 1)
    })
    setRequestSeries(fillSeries(reqMap, range))

    // 지역별 요청 (시·도 기준)
    const regionMap = new Map<string, number>()
    ;(regionReqs ?? []).forEach(r => {
      const k = r.city?.trim() || '미지정'
      regionMap.set(k, (regionMap.get(k) ?? 0) + 1)
    })
    setRegionRequests(Array.from(regionMap.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10))

    // 중개사 담당 지역 분포 (district는 콤마 구분, 첫 부분만 사용 — sido 추정)
    const propsRegionMap = new Map<string, number>()
    ;(props ?? []).forEach(p => {
      const first = p.district?.split(',')?.[0]?.trim().split(' ')?.[0]
      const k = first || '미지정'
      propsRegionMap.set(k, (propsRegionMap.get(k) ?? 0) + 1)
    })
    setRegionProperties(Array.from(propsRegionMap.entries())
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10))

    // 거래 유형 분포
    const dtMap = new Map<string, number>()
    ;(dts ?? []).forEach(d => {
      const first = d.deal_type?.split(',')?.[0]?.trim() || '기타'
      dtMap.set(first, (dtMap.get(first) ?? 0) + 1)
    })
    setDealTypes(Array.from(dtMap.entries()).map(([region, count]) => ({ region, count })).sort((a, b) => b.count - a.count))

    // 매물 상태
    const psMap = new Map<string, number>()
    ;(pst ?? []).forEach(p => {
      psMap.set(p.status, (psMap.get(p.status) ?? 0) + 1)
    })
    setPropStatus(Array.from(psMap.entries()).map(([region, count]) => ({ region, count })))

    setTotals({
      newUsers: (profs ?? []).filter(p => p.role !== 'broker' && p.role !== 'admin').length,
      newBrokers: (profs ?? []).filter(p => p.role === 'broker').length,
      newRequests: (reqs ?? []).length,
      newProperties: newPropertiesCount ?? 0,
    })

    // ── 역경매 전환 깔때기 (기간 내 생성된 의뢰 기준) ──
    const [
      { count: reqTotal },
      { count: reqWithProposal },
      { count: proposalAccepted },
      { count: dealCompleted },
      { count: reviewWritten },
    ] = await Promise.all([
      supabase.from('request_posts').select('*', { count: 'exact', head: true }).gte('created_at', since),
      supabase.from('request_posts').select('*', { count: 'exact', head: true }).gte('created_at', since).gt('proposal_count', 0),
      supabase.from('proposals').select('*', { count: 'exact', head: true }).gte('created_at', since).eq('status', 'accepted'),
      supabase.from('proposals').select('*', { count: 'exact', head: true }).gte('created_at', since).eq('stage', 'completed'),
      supabase.from('reviews').select('*', { count: 'exact', head: true }).gte('created_at', since),
    ])
    setFunnel([
      { key: 'request',  label: '의뢰 등록',   count: reqTotal ?? 0,        color: 'bg-blue-500' },
      { key: 'proposal', label: '제안 받음',   count: reqWithProposal ?? 0, color: 'bg-cyan-500' },
      { key: 'accepted', label: '제안 수락',   count: proposalAccepted ?? 0, color: 'bg-purple-500' },
      { key: 'completed',label: '거래 완료',   count: dealCompleted ?? 0,   color: 'bg-green-500' },
      { key: 'review',   label: '리뷰 작성',   count: reviewWritten ?? 0,   color: 'bg-amber-500' },
    ])

    setLoading(false)
  }, [supabase, range])

  // CSV 다운로드
  const downloadCSV = () => {
    const rows: string[][] = []
    rows.push([`# 빠방 통계 (${range}일)`, `생성: ${new Date().toISOString()}`])
    rows.push([])
    rows.push(['요약'])
    rows.push(['항목', '값'])
    rows.push(['신규 회원', String(totals.newUsers)])
    rows.push(['신규 중개사', String(totals.newBrokers)])
    rows.push(['신규 요청', String(totals.newRequests)])
    rows.push(['신규 매물', String(totals.newProperties)])
    rows.push([])
    rows.push(['전환 깔때기'])
    rows.push(['단계', '건수', '직전 단계 대비'])
    funnel.forEach((f, i) => {
      const prev = i > 0 ? funnel[i - 1].count : 0
      const rate = i > 0 && prev > 0 ? `${Math.round((f.count / prev) * 100)}%` : '-'
      rows.push([f.label, String(f.count), rate])
    })
    rows.push([])
    rows.push(['일별 가입'])
    rows.push(['날짜', '고객', '중개사'])
    signupSeries.user.forEach((u, i) => {
      const b = signupSeries.broker[i]
      rows.push([u.date, String(u.count), String(b?.count ?? 0)])
    })
    rows.push([])
    rows.push(['일별 요청'])
    rows.push(['날짜', '요청 수'])
    requestSeries.forEach(r => rows.push([r.date, String(r.count)]))
    rows.push([])
    rows.push(['요청 많은 지역 TOP10'])
    rows.push(['지역', '건수'])
    regionRequests.forEach(r => rows.push([r.region, String(r.count)]))
    rows.push([])
    rows.push(['중개사 분포 TOP10'])
    rows.push(['지역', '명'])
    regionProperties.forEach(r => rows.push([r.region, String(r.count)]))
    rows.push([])
    rows.push(['거래 유형'])
    rows.push(['유형', '건수'])
    dealTypes.forEach(r => rows.push([r.region, String(r.count)]))
    rows.push([])
    rows.push(['매물 상태'])
    rows.push(['상태', '건수'])
    propStatus.forEach(r => rows.push([propertyStatusLabel(r.region), String(r.count)]))

    const csv = rows.map(row => row.map(cell => {
      const s = String(cell ?? '')
      // 엑셀 호환: 콤마·따옴표·개행 포함 시 따옴표로 감싸기
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }).join(',')).join('\r\n')
    // Excel 한글 인코딩: UTF-8 BOM
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const today = new Date().toISOString().slice(0, 10)
    a.download = `bbabang-stats-${range}d-${today}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (auth.profile?.role === 'admin') load()
  }, [auth.profile?.role, load])

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
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700 transition-colors">
              <ArrowLeft className="h-4 w-4 text-gray-300" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-500/20">
              <BarChart3 className="h-5 w-5 text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">통계·분석</h1>
              <p className="text-xs text-gray-400">시계열 추이 및 지역별 분포</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-gray-800 bg-gray-900 p-1">
              {([7, 30, 90] as const).map(d => (
                <button key={d} onClick={() => setRange(d)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    range === d ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}>
                  {d}일
                </button>
              ))}
            </div>
            <button
              onClick={downloadCSV}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              aria-label="CSV 다운로드"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-8 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          </div>
        ) : (
          <>
            {/* 요약 통계 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard label={`신규 회원 (${range}일)`} value={totals.newUsers} icon={Users} color="text-blue-400 bg-blue-500/10" />
              <SummaryCard label={`신규 중개사 (${range}일)`} value={totals.newBrokers} icon={Building2} color="text-purple-400 bg-purple-500/10" />
              <SummaryCard label={`신규 요청 (${range}일)`} value={totals.newRequests} icon={FileText} color="text-green-400 bg-green-500/10" />
              <SummaryCard label={`신규 매물 (${range}일)`} value={totals.newProperties} icon={Home} color="text-amber-400 bg-amber-500/10" />
            </div>

            {/* 역경매 전환 깔때기 */}
            <ChartCard title={`역경매 전환 깔때기 (${range}일)`} icon={TrendingUp}>
              <FunnelChart stages={funnel} />
            </ChartCard>

            {/* 시계열 차트들 */}
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title="가입 추이" icon={TrendingUp}>
                <DualLineBars
                  primary={signupSeries.user}
                  primaryLabel="고객"
                  primaryColor="bg-blue-500"
                  secondary={signupSeries.broker}
                  secondaryLabel="중개사"
                  secondaryColor="bg-purple-500"
                />
              </ChartCard>

              <ChartCard title="요청 등록 추이" icon={FileText}>
                <DualLineBars
                  primary={requestSeries}
                  primaryLabel="요청"
                  primaryColor="bg-green-500"
                />
              </ChartCard>
            </div>

            {/* 지역 분포 */}
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title="요청이 많은 지역 (시·도)" icon={MapPin}>
                <RankBars rows={regionRequests} barColor="bg-green-500/70" />
              </ChartCard>

              <ChartCard title="중개사 분포 (시·도)" icon={Building2}>
                <RankBars rows={regionProperties} barColor="bg-purple-500/70" />
              </ChartCard>
            </div>

            {/* 카테고리 분포 */}
            <div className="grid gap-6 md:grid-cols-2">
              <ChartCard title="인기 거래 유형" icon={Calendar}>
                <RankBars rows={dealTypes} barColor="bg-blue-500/70" />
              </ChartCard>

              <ChartCard title="매물 상태 분포" icon={Home}>
                <RankBars
                  rows={propStatus.map(p => ({
                    region: propertyStatusLabel(p.region),
                    count: p.count,
                  }))}
                  barColor="bg-amber-500/70"
                />
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function fillSeries(map: Map<string, number>, days: number): TimeBucket[] {
  const out: TimeBucket[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    out.push({ date: d, count: map.get(d) ?? 0 })
  }
  return out
}

function SummaryCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl ${color}`}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-2xl font-black text-white">{value}</p>
      <p className="mt-0.5 text-xs text-gray-400">{label}</p>
    </div>
  )
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-gray-400" />
        <h2 className="font-bold text-white">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function DualLineBars({ primary, primaryLabel, primaryColor, secondary, secondaryLabel, secondaryColor }: {
  primary: TimeBucket[]
  primaryLabel: string
  primaryColor: string
  secondary?: TimeBucket[]
  secondaryLabel?: string
  secondaryColor?: string
}) {
  const allMax = Math.max(
    1,
    ...primary.map(p => p.count),
    ...(secondary ?? []).map(s => s.count),
  )
  const showSecondary = !!secondary && !!secondaryLabel && !!secondaryColor

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5"><span className={`h-2 w-3 rounded-sm ${primaryColor}`} />{primaryLabel}</span>
        {showSecondary && <span className="flex items-center gap-1.5"><span className={`h-2 w-3 rounded-sm ${secondaryColor}`} />{secondaryLabel}</span>}
      </div>
      <div className="flex items-end gap-0.5 h-32">
        {primary.map((b, i) => {
          const s = secondary?.[i]
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-px h-full justify-end group relative">
              <div className="flex items-end gap-px h-full w-full">
                <div className={`${primaryColor} rounded-t-sm flex-1`} style={{ height: `${(b.count / allMax) * 100}%` }} />
                {showSecondary && s && (
                  <div className={`${secondaryColor} rounded-t-sm flex-1`} style={{ height: `${(s.count / allMax) * 100}%` }} />
                )}
              </div>
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center pointer-events-none z-10">
                <div className="rounded-md bg-gray-800 border border-gray-700 px-2 py-1 text-[10px] text-white whitespace-nowrap">
                  {b.date.slice(5)} · {primaryLabel} {b.count}{showSecondary && s ? ` · ${secondaryLabel} ${s.count}` : ''}
                </div>
              </div>
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

function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const top = stages[0]?.count ?? 0
  if (stages.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">데이터가 없어요</p>
  }
  if (top === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">아직 의뢰가 없어 전환을 계산할 수 없어요</p>
  }
  return (
    <ul className="space-y-2.5">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].count : null
        const stepRate = prev != null && prev > 0 ? Math.round((s.count / prev) * 100) : null
        const widthPct = Math.max(2, (s.count / top) * 100)
        const overallPct = Math.round((s.count / top) * 100)
        return (
          <li key={s.key}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 text-gray-300">
                <span className="text-gray-500">{i + 1}.</span> {s.label}
                {stepRate != null && (
                  <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    stepRate >= 50 ? 'bg-green-500/15 text-green-400' : stepRate >= 20 ? 'bg-yellow-500/15 text-yellow-400' : 'bg-red-500/15 text-red-400'
                  }`}>
                    직전 대비 {stepRate}%
                  </span>
                )}
              </span>
              <span className="font-bold text-white">{s.count}<span className="ml-1 text-[10px] font-medium text-gray-500">({overallPct}%)</span></span>
            </div>
            <div className="h-6 rounded-lg bg-gray-800 overflow-hidden">
              <div className={`h-full ${s.color} rounded-lg transition-all flex items-center justify-end pr-2`} style={{ width: `${widthPct}%` }}>
                {s.count > 0 && <span className="text-[10px] font-bold text-white/90">{s.count}</span>}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function RankBars({ rows, barColor }: { rows: RegionRow[]; barColor: string }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">데이터가 없어요</p>
  }
  return (
    <ul className="space-y-2">
      {rows.map((r, i) => (
        <li key={r.region}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-300">
              <span className="text-gray-500 mr-1.5">{i + 1}.</span> {r.region}
            </span>
            <span className="font-bold text-white">{r.count}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
            <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
