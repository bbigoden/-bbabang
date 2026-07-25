import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Calculator, FileText, Coins, Building2, Users, Crown, Trophy, TrendingUp } from 'lucide-react'
import { calcSettlement, fmtComma } from '@/lib/settlement'
import { PROPERTY_STATUS_META } from '@/lib/property-status'
import { fetchAllPaged } from '@/lib/fetch-all-paged'

// 사장(대표) 전용 경영 현황 대시보드 — 사무소 전체 매출·직원별 실적·매물/고객 현황
// 데이터 출처: settlements(office_broker_id), broker_properties/broker_customers(broker_id in 멤버)
// 집계 패턴은 settlement 페이지·stats-panel과 동일.

const yyyymm = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export default async function OfficeDashboardPage() {
  const supabase = await createClient()

  let user: User | null = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    redirect('/auth/login?redirect=/broker/office')
  }
  if (!user) redirect('/auth/login?redirect=/broker/office')

  const { data: profileData } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profileData || profileData.role !== 'broker') redirect('/dashboard/user')

  const { data: brokerData } = await supabase
    .from('broker_profiles')
    .select('id, is_owner, office_name')
    .eq('user_id', user.id)
    .single()
  if (!brokerData) redirect('/broker/register')
  // 경영 현황은 대표 전용 — 직원은 개인 대시보드로
  if (brokerData.is_owner === false) redirect('/dashboard/broker')

  const office = brokerData.id

  // ── 사무소 멤버 (대표 + 승인 직원) ──────────────────────
  const { data: memberRows } = await supabase
    .from('broker_profiles')
    .select('id, is_owner, is_approved, profiles:user_id(name)')
    .or(`id.eq.${office},parent_broker_id.eq.${office}`)
  const members = (memberRows ?? []).filter((m: any) => m.is_owner || m.is_approved)
  const memberIds = members.map((m: any) => m.id)
  const nameOf = (m: any) => (Array.isArray(m.profiles) ? m.profiles[0]?.name : m.profiles?.name) ?? '—'

  const now = new Date()
  const thisMonth = yyyymm(now)
  const months = Array.from({ length: 6 }, (_, i) =>
    yyyymm(new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)))
  const sixAgo = months[0]

  // ── 데이터 병렬 조회 (실패해도 빈 상태) ───────────────────
  let settlements: any[] = []
  let properties: any[] = []
  let customers: any[] = []
  try {
    // 매물·고객은 1000건을 넘으면 조용히 잘려 집계가 실제보다 적게 나온다 → 전건 페이지네이션
    const [st, pr, cu] = await Promise.all([
      supabase
        .from('settlements')
        .select('assignee_broker_id, assignee_name, seller_fee, buyer_fee, settlement_rate, vat_override, withhold_exempt, record_month, contract_address')
        .eq('office_broker_id', office)
        .gte('record_month', sixAgo),
      memberIds.length
        ? fetchAllPaged((from, to) => supabase.from('broker_properties').select('broker_id, status').in('broker_id', memberIds).range(from, to))
        : Promise.resolve([] as any[]),
      memberIds.length
        ? fetchAllPaged((from, to) => supabase.from('broker_customers').select('broker_id, status').in('broker_id', memberIds).range(from, to))
        : Promise.resolve([] as any[]),
    ])
    // 손익 분배 행은 수익을 나누는 행이지 매출이 아님 — 경영 지표 집계에서 제외
    settlements = (st.data ?? []).filter((s: any) => !s.contract_address?.endsWith('사무실 손익 분배'))
    properties = pr
    customers = cu
  } catch {
    // 빈 상태로 렌더
  }

  // ── 이번 달 사무소 매출 ─────────────────────────────────
  const thisMonthSt = settlements.filter(s => s.record_month === thisMonth)
  const monthAgg = thisMonthSt.reduce(
    (a, s) => {
      const c = calcSettlement(s)
      a.total += c.total
      a.supply += c.supply
      a.count += 1
      return a
    },
    { total: 0, supply: 0, count: 0 },
  )

  // ── 직원별 실적 (이번 달, 총수수료 내림차순) ──────────────
  const ACTIVE_OUT = new Set(['종료', '계약완료'])
  const memberStats = members
    .map((m: any) => {
      const rows = thisMonthSt.filter(s => s.assignee_broker_id === m.id)
      const agg = rows.reduce(
        (a, s) => {
          const c = calcSettlement(s)
          a.total += c.total
          a.assignee += c.assignee
          a.count += 1
          return a
        },
        { total: 0, assignee: 0, count: 0 },
      )
      const propCount = properties.filter(p => p.broker_id === m.id).length
      const custActive = customers.filter(c => c.broker_id === m.id && !ACTIVE_OUT.has(c.status)).length
      return { id: m.id, name: nameOf(m), isOwner: !!m.is_owner, ...agg, propCount, custActive }
    })
    .sort((a, b) => b.total - a.total || b.count - a.count)

  // ── 최근 6개월 매출 추이 ────────────────────────────────
  const trend = months.map(mo => {
    const rows = settlements.filter(s => s.record_month === mo)
    const total = rows.reduce((sum, r) => sum + calcSettlement(r).total, 0)
    return { month: mo, label: `${Number(mo.slice(5))}월`, total, count: rows.length }
  })
  const maxTrend = Math.max(...trend.map(t => t.total), 1)

  // ── 매물 현황 ───────────────────────────────────────────
  const propByStatus: Record<string, number> = { available: 0, contracted: 0, hidden: 0 }
  properties.forEach(p => {
    if (p.status in propByStatus) propByStatus[p.status] += 1
  })

  // ── 고객 현황 ───────────────────────────────────────────
  const custActive = customers.filter(c => !ACTIVE_OUT.has(c.status)).length
  const custDone = customers.filter(c => c.status === '계약완료').length

  return (
    <div className="bg-gray-50 dark:bg-gray-950 min-h-screen">
      <Header user={user} role="broker" />

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* 헤더 */}
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
            <TrendingUp className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">경영 현황</h1>
            <p className="text-sm text-gray-500">{brokerData.office_name} · 사무소 전체 · 대표 전용</p>
          </div>
        </div>

        {/* ── 이번 달 사무소 매출 ─────────────────────────── */}
        <div className="mb-8">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-teal-600" />
              <h2 className="font-bold text-gray-900 dark:text-white">{now.getMonth() + 1}월 사무소 매출</h2>
              <span className="text-xs text-gray-500">· 정산월 {thisMonth} 기준</span>
            </div>
            <Link href="/broker/settlement" className="text-xs text-blue-600 hover:underline">정산 전체 →</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardBody>
                <div className="mb-2 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">계약 건수</span>
                </div>
                <div className="text-3xl font-black text-gray-900 dark:text-white">
                  {monthAgg.count}<span className="text-lg font-medium text-gray-500">건</span>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="mb-2 flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">총수수료</span>
                </div>
                <div className="text-3xl font-black text-teal-600">
                  {fmtComma(monthAgg.total)}<span className="text-lg font-medium text-gray-500">원</span>
                </div>
                <div className="mt-2 text-xs text-gray-500">매도+매수 합계 (VAT 포함)</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="mb-2 flex items-center gap-2">
                  <Coins className="h-4 w-4 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">공급가</span>
                </div>
                <div className="text-3xl font-black text-blue-600">
                  {fmtComma(monthAgg.supply)}<span className="text-lg font-medium text-gray-500">원</span>
                </div>
                <div className="mt-2 text-xs text-gray-500">VAT 제외 (총수수료÷1.1)</div>
              </CardBody>
            </Card>
          </div>
        </div>

        {/* ── 직원별 실적 ─────────────────────────────────── */}
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <h2 className="font-bold text-gray-900 dark:text-white">직원별 실적</h2>
            <span className="text-xs text-gray-500">· 이번 달 정산 기준</span>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 text-xs text-gray-500">
                    <th className="px-4 py-3 text-left font-medium">담당자</th>
                    <th className="px-4 py-3 text-right font-medium">계약</th>
                    <th className="px-4 py-3 text-right font-medium">총수수료</th>
                    <th className="px-4 py-3 text-right font-medium">담당 몫</th>
                    <th className="px-4 py-3 text-right font-medium">진행 고객</th>
                    <th className="px-4 py-3 text-right font-medium">매물</th>
                  </tr>
                </thead>
                <tbody>
                  {memberStats.map((m, i) => (
                    <tr key={m.id} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 dark:bg-gray-800 text-xs font-bold text-gray-600 dark:text-gray-400">
                            {i + 1}
                          </span>
                          <span className="font-semibold text-gray-800 dark:text-gray-100">{m.name}</span>
                          {m.isOwner && <Crown className="h-3.5 w-3.5 text-amber-500" aria-label="대표" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{m.count}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-teal-700 dark:text-teal-400">{m.total ? fmtComma(m.total) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-blue-700 dark:text-blue-400">{m.assignee ? fmtComma(m.assignee) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{m.custActive}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{m.propCount}</td>
                    </tr>
                  ))}
                  {memberStats.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">직원이 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* ── 최근 6개월 매출 추이 ────────────────────────── */}
        <div className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-blue-600" />
            <h2 className="font-bold text-gray-900 dark:text-white">최근 6개월 매출 추이</h2>
          </div>
          <Card>
            <CardBody>
              <div className="flex items-end gap-3 h-36">
                {trend.map(t => (
                  <div key={t.month} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-[10px] font-bold text-gray-500 tabular-nums">{t.total > 0 ? fmtComma(Math.round(t.total / 10000)) : ''}</span>
                    <div className="relative w-full flex flex-col justify-end" style={{ height: '96px' }}>
                      <div
                        className="w-full rounded-t bg-blue-500 absolute bottom-0 transition-all"
                        style={{ height: `${Math.max(t.total > 0 ? 4 : 0, Math.round((t.total / maxTrend) * 96))}px` }}
                      />
                    </div>
                    <span className="text-[11px] text-gray-500">{t.label}</span>
                    <span className="text-[10px] text-gray-400">{t.count > 0 ? `${t.count}건` : ''}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-gray-400">막대 위 숫자는 총수수료(만원) · 정산월 기준</p>
            </CardBody>
          </Card>
        </div>

        {/* ── 매물 / 고객 현황 ────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-indigo-600" />
                <h2 className="font-bold text-gray-900 dark:text-white">매물 현황</h2>
              </div>
              <Link href="/broker/properties" className="text-xs text-blue-600 hover:underline">매물목록 →</Link>
            </div>
            <Card>
              <CardBody>
                <div className="mb-4 text-3xl font-black text-gray-900 dark:text-white">
                  {properties.length}<span className="text-lg font-medium text-gray-500">건</span>
                </div>
                <div className="space-y-2">
                  {(['available', 'contracted', 'hidden'] as const).map(s => (
                    <div key={s} className="flex items-center justify-between text-sm">
                      <span className="text-gray-600 dark:text-gray-400">{PROPERTY_STATUS_META[s].label}</span>
                      <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-200">{propByStatus[s]}건</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          <div>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-rose-600" />
                <h2 className="font-bold text-gray-900 dark:text-white">고객 현황</h2>
              </div>
              <Link href="/broker/customers" className="text-xs text-blue-600 hover:underline">고객목록 →</Link>
            </div>
            <Card>
              <CardBody>
                <div className="mb-4 text-3xl font-black text-gray-900 dark:text-white">
                  {customers.length}<span className="text-lg font-medium text-gray-500">명</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">진행 중</span>
                    <span className="font-semibold tabular-nums text-blue-700 dark:text-blue-400">{custActive}명</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">계약완료</span>
                    <span className="font-semibold tabular-nums text-green-700 dark:text-green-400">{custDone}명</span>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
