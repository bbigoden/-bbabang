import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import {
  CheckCircle, Clock, Calculator, ThumbsUp, FileText,
  Building2, Users, NotebookPen, LayoutDashboard,
} from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { PushPrompt } from '@/components/push-prompt'
import { OnboardingChecklist, type OnboardingItems } from '@/components/broker/onboarding-checklist'
import { calcSettlement, fmtComma, isDistributionRow } from '@/lib/settlement'
import { todayKST } from '@/lib/date-kst'
import { verificationState, verificationCopy } from '@/lib/broker-office'

export default async function BrokerDashboardPage() {
  const supabase = await createClient()

  // getUser는 매번 Auth 서버까지 다녀온다. 프록시가 방금 세션을 갱신했으니 여기선 JWT 서명만 확인한다.
  let user: { id: string; email?: string } | null = null
  try {
    const { data } = await supabase.auth.getClaims()
    if (data?.claims?.sub) user = { id: data.claims.sub, email: data.claims.email }
  } catch {
    redirect('/auth/login?redirect=/dashboard/broker')
  }
  if (!user) redirect('/auth/login?redirect=/dashboard/broker')

  // ── 역할 확인 (redirect는 try/catch 밖에서 호출) ───────────
  // 두 조회는 서로 기다릴 이유가 없어 같이 보낸다. redirect 순서(역할 → 사무소)는 그대로.
  const [{ data: profileData }, { data: brokerData }] = await Promise.all([
    supabase.from('profiles').select('name, role').eq('id', user.id).single(),
    supabase
      .from('broker_profiles')
      .select('id, district, is_verified, verification_info, office_name, is_owner, is_approved, parent_broker_id, onboarding_dismissed_at')
      .eq('user_id', user.id)
      .single(),
  ])
  if (!profileData || profileData.role !== 'broker') redirect('/dashboard/user')
  if (!brokerData) redirect('/broker/register')

  const profile = profileData
  const broker = brokerData

  const brokerDistricts: string[] = broker.district
    ? broker.district.split(',').map((s: string) => s.trim()).filter(Boolean)
    : []

  // 대표의 인증이 아직이면(처음 등록·반려·취소) 위쪽에 상태를 띄운다. 인증됐으면 이름 옆 체크로 충분하다.
  const verifyState = broker.is_owner !== false ? verificationState(broker) : null
  const ownerVerify = verifyState && verifyState.kind !== 'verified' ? verificationCopy(verifyState) : null

  // ── 부가 데이터 조회 (실패해도 빈 상태로 처리) ────────────
  let settlements: any[] = []

  // 서버는 UTC 로 돈다 — getMonth() 로 세면 매달 1일 아침 9시 전까지 지난달이 나온다 (AGENTS.md)
  const thisMonth = todayKST().slice(0, 7)
  const thisMonthNo = Number(thisMonth.slice(5, 7))

  // ── 신규 사무소 시작 가이드 (대표 전용, 3항목 완료 또는 숨김 시 미표시) ──
  // 부가 데이터를 다 받은 뒤 따로 물으면 한 번 더 기다리게 되므로 같은 묶음에 실어 보낸다.
  let onboarding: OnboardingItems | null = null
  const wantsOnboarding = broker.is_owner !== false && !broker.onboarding_dismissed_at

  try {
    const [{ data: st }, onboardingRes] = await Promise.all([
      supabase
        .from('settlements')
        .select('id, settlement_rate, seller_fee, buyer_fee, withhold_exempt, vat_override, contract_address')
        .eq('assignee_broker_id', broker.id)
        .eq('record_month', thisMonth),
      wantsOnboarding
        ? Promise.all([
            supabase.from('broker_properties').select('id', { count: 'exact', head: true }).eq('office_broker_id', broker.id),
            supabase.from('broker_profiles').select('id', { count: 'exact', head: true }).eq('parent_broker_id', broker.id),
            // 정산 기준 설정 화면은 없앴다 — 첫 정산 기록이 있으면 끝난 것으로 본다
            supabase.from('settlements').select('id', { count: 'exact', head: true }).eq('office_broker_id', broker.id),
          ])
        : null,
    ])
    settlements = st ?? []

    if (onboardingRes) {
      const [{ count: propCount }, { count: empCount }, { count: settleCount }] = onboardingRes
      const items = { property: (propCount ?? 0) > 0, employee: (empCount ?? 0) > 0, settlement: (settleCount ?? 0) > 0 }
      if (!(items.property && items.employee && items.settlement)) onboarding = items
    }
  } catch {
    // 부가 데이터 로드 실패 시 빈 상태로 렌더링
  }

  // ── 이번 달 정산 요약 ─────────────────────────────────
  const settlementSummary = settlements.reduce((acc, s) => {
    if (isDistributionRow(s)) return acc // 분배 행은 실적이 아니므로 모든 정산 집계에서 제외
    const c = calcSettlement(s)
    acc.total += c.total
    acc.assignee += c.assignee
    acc.count += 1
    return acc
  }, { total: 0, assignee: 0, count: 0 })

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header user={user} role="broker" />

      <div className="mx-auto max-w-5xl px-4 py-8">
        {/* 중개사 프로필 */}
        <Card className="mb-8">
          <CardBody>
            <div className="flex items-center gap-5">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-blue-700 text-2xl font-black dark:bg-blue-500/20 dark:text-blue-400">
                {profile?.name?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">{profile?.name}</h1>
                  {broker.is_verified && (
                    <CheckCircle className="h-5 w-5 text-blue-500 flex-shrink-0" />
                  )}
                </div>
                {/* 등록 때 district 를 '' 로 넣어, 지역이 없으면 상호 뒤에 가운뎃점만 남았다 → 있는 것만 잇는다 */}
                <p className="text-gray-500 dark:text-gray-500 truncate">{[broker.office_name, ...brokerDistricts].filter(Boolean).join(' · ')}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* 사무소 인증 상태 — 대표 전용. 예전엔 설정 > 사무소까지 들어가야 승인 대기인지 알 수 있었다 */}
        {ownerVerify && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl bg-yellow-50 border border-yellow-200 px-5 py-4">
            <Clock className="h-5 w-5 text-yellow-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-yellow-800">{ownerVerify.title}</p>
              <p className="text-xs text-yellow-700 mt-0.5">{ownerVerify.body}</p>
            </div>
            <Link href="/settings/office" className="flex-shrink-0 text-xs font-semibold text-yellow-800 hover:underline">
              사무소 정보 →
            </Link>
          </div>
        )}

        {/* 신규 사무소 시작 가이드 — 대표 전용, 완료·숨김 시 서버에서 미렌더 */}
        {onboarding && <OnboardingChecklist brokerId={broker.id} items={onboarding} />}

        {/* 바로 하기 — 홈이 정산·통계만이라 처음 온 중개사가 다음에 무엇을 할지 몰랐다(2026-10-25 점검).
            사무소 소속이 정해진 사람에게만 — 승인 전 직원은 이 화면들이 잠겨 있다. */}
        {(broker.is_owner !== false || broker.is_approved === true) && (
          <div className="mb-8">
            <h2 className="mb-3 font-bold text-gray-900 dark:text-white">바로 하기</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { href: '/broker/properties?new=1', icon: Building2, title: '매물 등록', sub: '소재지만 적으면 끝' },
                { href: '/broker/customers?new=1', icon: Users, title: '고객 등록', sub: '찾는 조건을 적어 두기' },
                { href: '/broker/diary', icon: NotebookPen, title: '업무일지', sub: '오늘 한 일·상담' },
                { href: '/broker/office', icon: LayoutDashboard, title: '사무실', sub: '직원·일꾼 한눈에' },
              ].map(a => (
                <Link key={a.href} href={a.href}
                  className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white p-4 transition-all hover:border-blue-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-900">
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                    <a.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-gray-900 dark:text-white">{a.title}</span>
                    <span className="block truncate text-xs text-gray-500">{a.sub}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* 승인 대기 중 배너 — 미승인 직원에게만 표시 */}
        {broker.is_owner === false && broker.is_approved === false && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl bg-yellow-50 border border-yellow-200 px-5 py-4">
            <Clock className="h-5 w-5 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-bold text-yellow-800">승인 대기 중</p>
              <p className="text-xs text-yellow-700 mt-0.5">대표가 아직 등록 신청을 승인하지 않았어요. 대표에게 문의해주세요.</p>
            </div>
          </div>
        )}

        {/* 소속 사무소 표시 — 승인된 직원에게만 (탈퇴는 설정 > 내 계정으로 이동) */}
        {broker.is_owner === false && broker.is_approved === true && broker.parent_broker_id && (
          <div className="mb-6 rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 px-5 py-4">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{broker.office_name}</p>
            <p className="text-xs text-gray-500 mt-0.5">소속 사무소</p>
          </div>
        )}

        {/* ── 이번 달 정산 요약 ─────────────────────────────── */}
        <div className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Calculator className="h-5 w-5 text-teal-600" />
              <h2 className="font-bold text-gray-900 dark:text-white">{thisMonthNo}월 정산</h2>
              <span className="text-xs text-gray-500">· 내 담당 기준</span>
            </div>
            <Link href="/broker/settlement" className="text-xs text-blue-600 hover:underline">정산 전체 보기 →</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <FileText className="h-4 w-4 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">계약 건수</span>
                </div>
                <div className="text-3xl font-black text-gray-900 dark:text-white">
                  {settlementSummary.count}
                  <span className="text-lg font-medium text-gray-500">건</span>
                </div>
                <div className="mt-2 text-xs text-gray-500">정산월 {thisMonth} 기준</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <Calculator className="h-4 w-4 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">총수수료</span>
                </div>
                <div className="text-3xl font-black text-teal-600">
                  {fmtComma(settlementSummary.total)}
                  <span className="text-lg font-medium text-gray-500">원</span>
                </div>
                <div className="mt-2 text-xs text-gray-500">매도+매수 합계</div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="flex items-center gap-2 mb-2">
                  <ThumbsUp className="h-4 w-4 text-gray-500" />
                  <span className="text-xs font-medium text-gray-500">내 수수료</span>
                </div>
                <div className="text-3xl font-black text-blue-600">
                  {fmtComma(settlementSummary.assignee)}
                  <span className="text-lg font-medium text-gray-500">원</span>
                </div>
                <div className="mt-2 text-xs text-gray-500">담당자 몫 (원천 전)</div>
              </CardBody>
            </Card>
          </div>
        </div>

      </div>
      <PushPrompt message="업무일지·신규 고객·정산 알림을 받아보세요" />
    </div>
  )
}
