'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import { Card, CardBody } from '@/components/ui/card'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, Download, Trash2,
} from 'lucide-react'
import { TextCell } from '@/components/sheet/cells/text-cell'
import { SelectCell } from '@/components/sheet/cells/select-cell'
import { DateCell } from '@/components/sheet/cells/date-cell'
import { SheetActionHeader } from '@/components/sheet/action-cell'
import { calcSettlement, fmtComma } from '@/lib/settlement'
import { notifyOwnerOfBrokerAction } from '@/lib/notify-owner'
import { fetchAllPaged } from '@/lib/fetch-all-paged'

interface Settlement {
  id: string
  office_broker_id: string
  assignee_broker_id: string | null
  contract_date: string | null
  contract_address: string | null
  seller: string | null
  buyer: string | null
  assignee_name: string | null
  settlement_rate: number
  seller_fee: number
  buyer_fee: number
  vat_override: number | null
  seller_payment_date: string | null
  buyer_payment_date: string | null
  record_month: string | null
  withhold_exempt: boolean
  memo: string | null
  created_by: string | null
}

interface Member {
  id: string
  user_id: string
  is_owner: boolean | null
  parent_broker_id: string | null
  default_settlement_rate: number | null
  withhold_exempt: boolean | null
  profiles: { name: string | null } | null
}

const yyyymm = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

// 손익 분배 행 여부 — 사무실 수익 집계(분배 계산·사무실 카드)에서 제외해야 함
const isDistributionRow = (r: Settlement) => !!r.contract_address?.endsWith('사무실 손익 분배')

// ── 인라인 숫자 셀 (정산 전용 — 원 단위, 콤마 표시) ─────────
function MoneyCell({ value, onSave, readOnly, accent }: {
  value: number | null
  onSave?: (v: number) => void
  readOnly?: boolean
  accent?: 'blue' | 'emerald' | 'gray'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value != null ? String(value) : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    const num = draft.trim() === '' ? 0 : Number(draft)
    if (!isNaN(num) && num !== value) onSave?.(num)
  }

  const colorCls = value != null && value < 0 ? 'text-red-600 dark:text-red-400 font-semibold'
    : accent === 'blue' ? 'text-blue-700 dark:text-blue-300 font-semibold'
    : accent === 'emerald' ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
    : 'text-gray-800 dark:text-gray-200'

  if (readOnly) {
    return (
      <div className={`w-full px-1 py-0.5 text-xs text-right font-mono ${value ? colorCls : 'text-gray-500 dark:text-gray-400'} min-h-[22px]`}>
        {value != null ? value.toLocaleString() : '—'}
      </div>
    )
  }

  if (editing) {
    return (
      <input ref={inputRef} type="number" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value != null ? String(value) : ''); setEditing(false) } }}
        className="w-full rounded border border-blue-400 bg-white dark:bg-gray-900 px-1 py-0.5 text-xs text-right font-mono outline-none focus:ring-2 focus:ring-blue-300"
      />
    )
  }
  return (
    <div onClick={() => { setDraft(value != null ? String(value) : ''); setEditing(true) }}
      className={`w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right font-mono hover:bg-blue-50 dark:hover:bg-blue-500/10 min-h-[22px] ${value ? colorCls : 'text-gray-500 dark:text-gray-400'}`}>
      {value != null && value !== 0 ? value.toLocaleString() : '0'}
    </div>
  )
}

// ── 공급가 셀 — 자동(빈값)/수동(숫자) 토글
// 수동 입력 시 vat_override = total − 공급가 로 역산 저장.
// 빈 칸으로 만들면 자동(total/1.1)으로 복귀.
function SupplyCell({ supply, isManual, readOnly, onSave }: {
  supply: number
  isManual: boolean
  readOnly?: boolean
  onSave: (newSupply: number | null) => void   // null = 자동
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(supply))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    const t = draft.trim()
    if (t === '') { if (isManual) onSave(null); return }
    const num = Number(t)
    if (!isNaN(num) && num !== supply) onSave(Math.max(0, Math.round(num)))
  }

  if (readOnly) {
    return (
      <div className={`w-full px-1 py-0.5 text-xs text-right font-mono min-h-[22px] ${isManual ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}>
        {supply ? supply.toLocaleString() : '0'}
      </div>
    )
  }

  if (editing) {
    return (
      <input ref={inputRef} type="number" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(supply)); setEditing(false) } }}
        placeholder="빈 값 = 자동"
        className="w-full rounded border border-blue-400 bg-white dark:bg-gray-900 px-1 py-0.5 text-xs text-right font-mono outline-none focus:ring-2 focus:ring-blue-300"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft(String(supply)); setEditing(true) }}
      title={isManual ? '수동 입력 (현금/VAT 0). 빈 칸으로 만들면 자동(총수수료÷1.1) 복귀' : '자동 계산. 클릭해서 직접 입력 가능 (현금 케이스)'}
      className={`w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right font-mono hover:bg-blue-50 dark:hover:bg-blue-500/10 min-h-[22px] ${isManual ? 'text-blue-700 dark:text-blue-300 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}
    >
      {supply ? supply.toLocaleString() : '0'}
      {isManual && <span className="ml-0.5 text-[9px] text-blue-500">●</span>}
    </div>
  )
}

// ── 정산비 셀 (0.50 / 0.55 / 0.60 / 0.70 ...) ─────────────
// 대표는 전체, 직원은 본인 행만 수정 (금액 셀과 동일한 권한)
function RateCell({ value, onSave, readOnly }: { value: number; onSave: (v: number) => void; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    const num = Number(draft)
    if (isNaN(num)) return
    // 비율은 0~1 — 50을 입력해도 담당자수수료가 50배가 되지 않게 클램프
    const clamped = Math.min(1, Math.max(0, num))
    if (clamped !== value) onSave(clamped)
  }

  if (readOnly) {
    return (
      <div className="w-full px-1 py-0.5 text-xs text-right font-mono min-h-[22px] text-gray-800 dark:text-gray-200">
        {value.toFixed(2)}
      </div>
    )
  }

  if (editing) {
    return (
      <input ref={inputRef} type="number" step="0.01" min="0" max="1" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false) } }}
        className="w-full rounded border border-blue-400 bg-white dark:bg-gray-900 px-1 py-0.5 text-xs text-right font-mono outline-none focus:ring-2 focus:ring-blue-300"
      />
    )
  }
  return (
    <div onClick={() => { setDraft(String(value)); setEditing(true) }}
      className="w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right font-mono hover:bg-blue-50 dark:hover:bg-blue-500/10 min-h-[22px] text-gray-800 dark:text-gray-200">
      {value.toFixed(2)}
    </div>
  )
}

export default function SettlementPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()
  const toast = useToast()

  const [officeId, setOfficeId] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [meBroker, setMeBroker] = useState<Member | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  // 퇴사자 = settlements에 등장하지만 현재 사무소 멤버가 아닌 assignee (broker_id 또는 이름 기준)
  const [exAssignees, setExAssignees] = useState<Array<{ key: string; name: string }>>([])
  // 대표 전용: 월 기본경비·동업 분배 비율 (office_settlement_settings, 사무소당 1행)
  const [expenseSettings, setExpenseSettings] = useState<{ monthly_expense: number; partner_split: number } | null>(null)
  const [month, setMonth] = useState(() => yyyymm(new Date()))
  const [allMode, setAllMode] = useState(false)
  const [highlightSettlementId, setHighlightSettlementId] = useState<string | null>(null)

  // 알림에서 ?month=YYYY-MM&focus=ID 로 진입 시 처리 (한 번만)
  const notifNavRef = useRef(false)
  useEffect(() => {
    if (notifNavRef.current) return
    const monthParam = searchParams.get('month')
    const focusParam = searchParams.get('focus')
    if (!monthParam && !focusParam) return
    notifNavRef.current = true
    if (monthParam) { setAllMode(false); setMonth(monthParam) }
    if (focusParam) {
      setHighlightSettlementId(focusParam)
      // 행 렌더링 후 scroll
      setTimeout(() => {
        const row = document.querySelector(`tr[data-row-id="${focusParam}"]`) as HTMLElement | null
        row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 400)
      setTimeout(() => setHighlightSettlementId(null), 2500)
    }
  }, [searchParams])
  // 필터 값:
  //   ''             = 전체
  //   '<broker_id>'  = 재직 직원
  //   'ex:<key>'     = 퇴사자 (key = broker_id 또는 'name:<이름>' 가입 전 퇴사자)
  const [filterAssigneeId, setFilterAssigneeId] = useState<string>('')
  const [rows, setRows] = useState<Settlement[]>([])
  const [prevMonthTakeHome, setPrevMonthTakeHome] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // 권한 게이트
  useEffect(() => {
    if (auth.loading) return
    if (!auth.user) { router.push('/auth/login'); return }
    if (auth.profile?.role !== 'broker') { router.push('/'); return }
  }, [auth.loading, auth.user, auth.profile?.role, router])

  // 사무소·동료 정보 로드
  const loadMeta = useCallback(async () => {
    if (!auth.user) return
    const { data: me } = await supabase
      .from('broker_profiles')
      .select('id, user_id, is_owner, parent_broker_id, default_settlement_rate, withhold_exempt, profiles:user_id(name)')
      .eq('user_id', auth.user.id)
      .maybeSingle()
    if (!me) { setLoading(false); return }
    const office = me.is_owner ? me.id : me.parent_broker_id
    if (!office) { setLoading(false); return }

    setMeBroker(me as any)
    setIsOwner(!!me.is_owner)
    setOfficeId(office)

    const { data: mems } = await supabase
      .from('broker_profiles')
      .select('id, user_id, is_owner, parent_broker_id, default_settlement_rate, withhold_exempt, is_approved, profiles:user_id(name)')
      .or(`id.eq.${office},parent_broker_id.eq.${office}`)
    setMembers((mems ?? []).filter((m: any) => m.is_owner || m.is_approved) as any)

    // 대표일 때만 퇴사자 목록 distinct 로드
    // = settlements에 등장한 assignee 중 현재 사무소 멤버(재직 직원)가 아닌 사람
    // 박세련·송영욱처럼 broker_id NULL(가입 전 퇴사)도 자동 포함
    if (me.is_owner) {
      const { data: es } = await supabase
        .from('office_settlement_settings')
        .select('monthly_expense, partner_split')
        .eq('office_broker_id', office)
        .maybeSingle()
      setExpenseSettings({
        monthly_expense: Number(es?.monthly_expense ?? 4000000),
        partner_split: Number(es?.partner_split ?? 0.5),
      })

      const memberIds = new Set<string>((mems ?? []).map((m: any) => m.id))
      const memberNames = new Set<string>(
        (mems ?? []).map((m: any) => m.profiles?.name).filter(Boolean)
      )
      // 전건 조회 — 1000행 넘으면 조용히 잘리므로 페이지네이션 필수
      const dist = await fetchAllPaged<{ assignee_broker_id: string | null; assignee_name: string | null }>((from, to) =>
        supabase
          .from('settlements')
          .select('assignee_broker_id, assignee_name')
          .eq('office_broker_id', office)
          .order('id', { ascending: true })
          .range(from, to)
      ).catch(() => null)
      if (dist) {
        const seen = new Set<string>()
        const exList: Array<{ key: string; name: string }> = []
        for (const r of dist as any[]) {
          const aid: string | null = r.assignee_broker_id
          const aname: string | null = r.assignee_name
          // broker_id 있고 사무소 멤버면 skip
          if (aid && memberIds.has(aid)) continue
          // broker_id 없는데 이름이 사무소 멤버 이름과 일치하면 skip (혼합 케이스)
          if (!aid && aname && memberNames.has(aname)) continue
          const key = aid ? aid : (aname ? `name:${aname}` : '')
          if (!key || seen.has(key)) continue
          seen.add(key)
          exList.push({ key, name: aname ?? '퇴사자' })
        }
        setExAssignees(exList)
      }
    }
  }, [auth.user, supabase])

  // 월 필터 기준은 '기록월(record_month)' — 사용자가 수동 분류 (계약일·입금일 무관)
  const loadRows = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    // 전건 조회 — 특히 전체 보기는 1000행 넘으면 조용히 잘리므로 페이지네이션 필수.
    // id 최종 정렬로 페이지 경계 고정 (created_at 동률 대비)
    const data = await fetchAllPaged<Settlement>((from, to) => {
      let q = supabase
        .from('settlements')
        .select('*')
        .eq('office_broker_id', officeId)
      if (!allMode) {
        q = q.eq('record_month', month)
      }
      return q
        .order('contract_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)
    }).catch(() => [] as Settlement[])
    setRows(data)
    setLoading(false)
  }, [officeId, month, allMode, supabase])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadRows() }, [loadRows])

  // 직원 전용: 전월 실수령 합 fetch (전월 대비 증감율 카드용)
  useEffect(() => {
    if (isOwner || allMode || !officeId || !meBroker) { setPrevMonthTakeHome(null); return }
    const [y, m] = month.split('-').map(Number)
    const prev = yyyymm(new Date(y, m - 2, 1))
    supabase
      .from('settlements')
      .select('seller_fee, buyer_fee, settlement_rate, withhold_exempt, vat_override, contract_address')
      .eq('office_broker_id', officeId)
      .eq('assignee_broker_id', meBroker.id)
      .eq('record_month', prev)
      .then(({ data }) => {
        if (!data) { setPrevMonthTakeHome(0); return }
        const sum = data.reduce((s, r: any) =>
          isDistributionRow(r) ? s : s + calcSettlement(r).takeHome, 0)
        setPrevMonthTakeHome(sum)
      })
  }, [isOwner, allMode, officeId, meBroker, month, supabase])

  // 직원: 본인 행만. 대표: 전체 / 재직 직원 / 퇴사자 필터 적용
  const visibleRows = useMemo(() => {
    let base: Settlement[]
    if (isOwner) {
      if (!filterAssigneeId) {
        base = rows
      } else if (filterAssigneeId.startsWith('ex:')) {
        const key = filterAssigneeId.slice(3)
        if (key.startsWith('name:')) {
          // 가입 전 퇴사자 — assignee_broker_id NULL + 이름 매칭
          const targetName = key.slice(5)
          base = rows.filter(r => !r.assignee_broker_id && r.assignee_name === targetName)
        } else {
          // 가입 후 퇴사자 — assignee_broker_id 매칭
          base = rows.filter(r => r.assignee_broker_id === key)
        }
      } else {
        // 재직 직원
        base = rows.filter(r => r.assignee_broker_id === filterAssigneeId)
      }
    } else {
      if (!meBroker) return []
      base = rows.filter(r => r.assignee_broker_id === meBroker.id)
    }
    // 분배 행은 항상 맨 아래 유지 (이후 정산이 추가돼도 순서 고정)
    return [...base.filter(r => !isDistributionRow(r)), ...base.filter(isDistributionRow)]
  }, [rows, isOwner, meBroker, filterAssigneeId])

  // 공동중개(contract_no) 그룹화 폐기 — 1계약 1행 구조로 단순화

  // 멤버 이름 옵션 (SelectCell)
  const memberOptions = useMemo(() => members.map(m => m.profiles?.name ?? '').filter(Boolean), [members])
  const nameToBroker = useMemo(() => {
    const m = new Map<string, Member>()
    for (const x of members) if (x.profiles?.name) m.set(x.profiles.name, x)
    return m
  }, [members])

  // 월별 사무실 수익 (분배 행 제외 — 분배에 분배가 섞이는 순환 방지)
  // 직원 필터와 무관하게 로드된 전체 행 기준
  const officeProfitByMonth = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      if (isDistributionRow(r)) continue
      const c = calcSettlement(r)
      const key = r.record_month ?? ''
      m.set(key, (m.get(key) ?? 0) + (c.supply - c.assignee))
    }
    return m
  }, [rows])

  // 분배 행의 매도수수료(사무실 수익)는 저장값 대신 현재 합계를 실시간 반영
  // → 이후 정산을 추가·삭제·수정해도 분배 행이 자동으로 따라간다 (재등록 불필요)
  const withLiveProfit = useCallback((r: Settlement): Settlement =>
    isDistributionRow(r)
      ? { ...r, seller_fee: officeProfitByMonth.get(r.record_month ?? '') ?? 0 }
      : r
  , [officeProfitByMonth])

  // 요약 합계
  const summary = useMemo(() => {
    // 분배 행은 수익을 나누는 행(동업 지분 배당)이지 매출도 담당자 실적도 아님 —
    // 담당자가 직원으로 지정돼 있어도 모든 요약 카드에서 제외한다.
    let totalFee = 0, supplySum = 0, assigneeSum = 0, takeHomeSum = 0
    let count = 0
    for (const r of visibleRows) {
      if (isDistributionRow(r)) continue
      const c = calcSettlement(r)
      totalFee    += c.total
      supplySum   += c.supply
      assigneeSum += c.assignee
      takeHomeSum += c.takeHome
      count++
    }

    // 사무실 수익: 공급가 합 − 담당자 수수료 합 (1계약 1행 구조)
    const officeShare = isOwner ? (supplySum - assigneeSum) : 0

    return { totalFee, supplySum, assigneeSum, takeHomeSum, officeShare, count }
  }, [visibleRows, isOwner])

  const moveMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(yyyymm(d))
  }

  // 한 셀 업데이트 — 즉시 DB 반영 + 낙관적 UI
  const updateRow = async (id: string, patch: Partial<Settlement>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    const { error } = await supabase.from('settlements').update(patch).eq('id', id)
    if (error) { toast.error('저장 실패: ' + error.message); loadRows() }
  }

  // 새 빈 행 추가 — 보고 있는 월(전체면 오늘)로 record_month 자동
  // 대표가 특정 직원 필터를 걸어둔 상태면 그 직원 기준으로 행 생성 (필터된 화면에 즉시 보이도록)
  const addNewRow = async () => {
    if (!officeId || !meBroker) return
    const recordMonth = allMode ? yyyymm(new Date()) : month

    const target = (isOwner && filterAssigneeId && !filterAssigneeId.startsWith('ex:'))
      ? (members.find(m => m.id === filterAssigneeId) ?? meBroker)
      : meBroker

    const { data, error } = await supabase
      .from('settlements')
      .insert({
        office_broker_id: officeId,
        assignee_broker_id: target.id,
        assignee_name: target.profiles?.name ?? null,
        record_month: recordMonth,
        settlement_rate: Number(target.default_settlement_rate ?? 0.5),
        withhold_exempt: !!target.is_owner,
        seller_fee: 0,
        buyer_fee: 0,
        created_by: meBroker.id,
      })
      .select('*')
      .single()
    if (error) { toast.error('추가 실패: ' + error.message); return }
    setRows(prev => [...prev, data as Settlement])
    notifyOwnerOfBrokerAction(meBroker.id, 'settlement', `/broker/settlement?month=${recordMonth}&focus=${(data as Settlement).id}`)
  }

  // 대표 전용: 이 달 손익 분배를 정산 행 하나로 등록 (카드 없이 행이 계산기 역할)
  //   매도수수료 = 사무실 수익, 매수수수료 = −기본경비 → 총수수료·공급가 = 순손익 (VAT 0)
  //   정산비 = 동업자 비율 → 담당자수수료 = 동업자 몫, 실수령 = 3.3% 공제 후
  // 등록 후에도 매수수수료(경비)·정산비(비율)를 행에서 고치면 즉시 재계산된다.
  const addDistributionRow = async () => {
    if (!officeId || !meBroker || !expenseSettings || allMode) return
    const label = `${month} 사무실 손익 분배`
    const dup = rows.find(r => r.record_month === month && r.contract_address === label)
    if (dup) {
      toast.error('이미 이 달 분배 행이 있습니다. 경비·비율은 그 행에서 직접 수정할 수 있어요.')
      setHighlightSettlementId(dup.id)
      document.querySelector(`tr[data-row-id="${dup.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setTimeout(() => setHighlightSettlementId(null), 2500)
      return
    }
    const expense = expenseSettings.monthly_expense
    const partnerRate = 1 - expenseSettings.partner_split
    const { data, error } = await supabase
      .from('settlements')
      .insert({
        office_broker_id: officeId,
        assignee_broker_id: null,
        assignee_name: '동업자',
        contract_address: label,
        record_month: month,
        settlement_rate: partnerRate,
        withhold_exempt: false,
        seller_fee: officeProfitByMonth.get(month) ?? 0,
        buyer_fee: -expense,
        vat_override: 0,
        memo: '매도칸=사무실 수익 · 매수칸=−경비 · 정산비=동업자 비율',
        created_by: meBroker.id,
      })
      .select('*')
      .single()
    if (error) { toast.error('분배 등록 실패: ' + error.message); return }
    setRows(prev => [...prev, data as Settlement])
  }

  const deleteRow = async (r: Settlement) => {
    if (!confirm(`${r.contract_address ?? r.contract_date ?? '이 계약'} 삭제할까요?`)) return
    const { error } = await supabase.from('settlements').delete().eq('id', r.id)
    if (error) { toast.error('삭제 실패: ' + error.message); return }
    setRows(prev => prev.filter(x => x.id !== r.id))
  }

  // CSV 다운로드 (직원·사무소 두 양식)
  const downloadCsv = (mode: 'employee' | 'office') => {
    const head = ['계약일','계약주소','매도인(임대)','매수인(임차)','담당자','정산비','매도수수료','매수수수료','총수수료','VAT','공급가','담당자수수료','실수령(원천후)','매도입금일','매수입금일']

    const lines: string[] = [head.join(',')]
    for (const raw of visibleRows) {
      const r = withLiveProfit(raw)
      const c = calcSettlement(r)
      const csv = (s: string | number | null | undefined) => {
        const v = s == null ? '' : String(s)
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
      }
      const row: (string | number)[] = [
        r.contract_date ?? '',
        csv(r.contract_address ?? ''),
        csv(r.seller ?? ''),
        csv(r.buyer ?? ''),
        csv(r.assignee_name ?? ''),
        r.settlement_rate,
        r.seller_fee,
        r.buyer_fee,
        c.total,
        c.vat,
        c.supply,
        c.assignee,
        c.takeHome,
        r.seller_payment_date ?? '',
        r.buyer_payment_date ?? '',
      ]
      lines.push(row.join(','))
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${mode === 'employee' ? '직원정산' : '사무소정산'}_${allMode ? '전체' : month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (auth.loading || loading) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="px-4 py-8 text-center text-sm text-gray-500">불러오는 중…</div>
      </div>
    )
  }

  if (!officeId) {
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
        {/* 헤더 */}
        <div className="mb-2 flex items-center gap-3">
          <button onClick={() => router.back()} aria-label="뒤로 가기" title="뒤로" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-black text-gray-900 dark:text-white">정산</h1>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
            {isOwner ? '사무소 보기' : '직원 보기'}
          </span>
        </div>
        <p className="mb-4 ml-11 text-xs text-gray-500 dark:text-gray-500">
          셀을 클릭해 수정하면 자동 저장됩니다. 회계 데이터이니 신중히 입력하세요.
        </p>

        {/* 월 네비 + 액션 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setAllMode(false); moveMonth(-1) }} disabled={allMode} aria-label="이전 달"
              className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {allMode ? (
              <span className="min-w-[8rem] text-center text-base font-bold text-gray-500">전체 보기</span>
            ) : (
              <input
                type="month"
                value={month}
                onChange={e => { if (e.target.value) setMonth(e.target.value) }}
                aria-label="정산 기준 월 선택"
                className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-base font-bold text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white"
              />
            )}
            <button onClick={() => { setAllMode(false); moveMonth(1) }} disabled={allMode} aria-label="다음 달"
              className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={() => { setAllMode(false); setMonth(yyyymm(new Date())) }}
              className={`ml-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${!allMode && month === yyyymm(new Date())
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'}`}>
              이번 달
            </button>
            <button onClick={() => setAllMode(true)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${allMode
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'}`}>
              전체
            </button>
          </div>
          {/* 직원 select + CSV — 한 줄로 묶음 (모바일에선 월 네비 아래 줄에 배치) */}
          <div className="flex flex-wrap items-center gap-2">
            {isOwner && (
              <select
                value={filterAssigneeId}
                onChange={e => setFilterAssigneeId(e.target.value)}
                aria-label="정산 직원 필터"
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold cursor-pointer ${filterAssigneeId
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'}`}
              >
                <option value="">전체 직원</option>
                {members.length > 0 && (
                  <optgroup label="재직">
                    {members.map(m => (
                      <option key={m.id} value={m.id}>{m.profiles?.name ?? '이름 없음'}</option>
                    ))}
                  </optgroup>
                )}
                {exAssignees.length > 0 && (
                  <optgroup label="퇴사">
                    {exAssignees.map(e => (
                      <option key={e.key} value={`ex:${e.key}`}>{e.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            )}
            <button onClick={() => downloadCsv('employee')} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <Download className="h-3.5 w-3.5" /> 직원CSV
            </button>
            {isOwner && (
              <button onClick={() => downloadCsv('office')} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                <Download className="h-3.5 w-3.5" /> 사무소CSV
              </button>
            )}
          </div>
        </div>

        {/* 요약 카드 — 전체 / 담당자 / (대표: 사무실 / 직원: 전월 대비) */}
        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card>
              <CardBody className="p-4">
                <div className="flex items-baseline justify-between">
                  <p className="text-[11px] font-medium text-gray-500">전체</p>
                  <p className="text-[11px] font-semibold text-gray-500">총 {summary.count}건</p>
                </div>
                <p className="mt-1 text-xl font-black text-gray-900 dark:text-white">{fmtComma(summary.totalFee)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span></p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  = 공급가 {fmtComma(summary.supplySum)} + VAT {fmtComma(summary.totalFee - summary.supplySum)}
                </p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-4">
                <p className="text-[11px] font-medium text-gray-500">담당자 <span className="font-normal">(분배 행 제외)</span></p>
                <p className="mt-1 text-xl font-black text-blue-700 dark:text-blue-300">{fmtComma(summary.assigneeSum)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span></p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  = 실수령 {fmtComma(summary.takeHomeSum)} + 원천 {fmtComma(summary.assigneeSum - summary.takeHomeSum)}
                </p>
              </CardBody>
            </Card>
            {isOwner ? (
              <Card>
                <CardBody className="p-4">
                  <p className="text-[11px] font-medium text-gray-500">사무실</p>
                  <p className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-300">{fmtComma(summary.officeShare)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span></p>
                  <p className="mt-0.5 text-[10px] text-gray-500">
                    = 공급가 {fmtComma(summary.supplySum)} − 담당자 {fmtComma(summary.assigneeSum)} (분배 행 제외)
                  </p>
                </CardBody>
              </Card>
            ) : (
              <Card>
                <CardBody className="p-4">
                  <p className="text-[11px] font-medium text-gray-500">전월 대비</p>
                  {(() => {
                    if (allMode) return <p className="mt-1 text-xl font-black text-gray-500">전체 모드</p>
                    if (prevMonthTakeHome == null) return <p className="mt-1 text-xl font-black text-gray-500">—</p>
                    if (prevMonthTakeHome === 0) return (<>
                      <p className="mt-1 text-xl font-black text-gray-500">신규</p>
                      <p className="mt-0.5 text-[10px] text-gray-500">전월 데이터 없음</p>
                    </>)
                    const pct = Math.round((summary.takeHomeSum - prevMonthTakeHome) / prevMonthTakeHome * 100)
                    const cls = pct >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-400'
                    return (<>
                      <p className={`mt-1 text-xl font-black ${cls}`}>{pct >= 0 ? '+' : ''}{pct}<span className="ml-0.5 text-xs font-medium text-gray-500">%</span></p>
                      <p className="mt-0.5 text-[10px] text-gray-500">전월 실수령 {fmtComma(prevMonthTakeHome)}원</p>
                    </>)
                  })()}
                </CardBody>
              </Card>
            )}
          </div>

        {/* 시트형 표 */}
        <Card>
          <div className="overflow-x-auto">
            <table className="table-fixed text-xs whitespace-nowrap" style={{ minWidth: 1640 }}>
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 100 }}>계약일</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ minWidth: 200 }}>계약주소</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 100 }}>매도인(임대)</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 100 }}>매수인(임차)</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 80 }}>담당자</th>
                  <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500" style={{ width: 60 }}>정산비</th>
                  <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500" style={{ width: 90 }}>매도수수료</th>
                  <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500" style={{ width: 90 }}>매수수수료</th>
                  <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500" style={{ width: 90 }}>총수수료</th>
                  <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500" style={{ width: 90 }}>공급가</th>
                  <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500" style={{ width: 100 }}>담당자수수료</th>
                  <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500" style={{ width: 100 }}>실수령</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 110 }}>매도입금일</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 110 }}>매수입금일</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ minWidth: 140 }}>비고</th>
                  <SheetActionHeader width={72}>{null}</SheetActionHeader>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(raw => {
                  const r = withLiveProfit(raw)
                  const c = calcSettlement(r)
                  const canEditMoney = isOwner || r.assignee_broker_id === meBroker?.id

                  return (
                    <tr key={r.id} data-row-id={r.id} className={`border-t border-gray-100 hover:bg-gray-50/60 dark:border-gray-800 dark:hover:bg-gray-800/20 transition-colors ${highlightSettlementId === r.id ? 'animate-pulse bg-blue-50/60' : ''}`}>
                      <td className="px-1 py-1">
                        <DateCell value={r.contract_date} onSave={v => updateRow(r.id, { contract_date: v })} />
                      </td>
                      <td className="px-1 py-1">
                        <TextCell value={r.contract_address} placeholder="주소" onSave={v => updateRow(r.id, { contract_address: v })} />
                      </td>
                      <td className="px-1 py-1">
                        <TextCell value={r.seller} placeholder="—" onSave={v => updateRow(r.id, { seller: v })} />
                      </td>
                      <td className="px-1 py-1">
                        <TextCell value={r.buyer} placeholder="—" onSave={v => updateRow(r.id, { buyer: v })} />
                      </td>
                      <td className="px-1 py-1">
                        <SelectCell
                          value={r.assignee_name}
                          options={memberOptions}
                          readOnly={!isOwner}
                          onSave={name => {
                            const m = nameToBroker.get(name)
                            updateRow(r.id, {
                              assignee_name: name,
                              assignee_broker_id: m?.id ?? null,
                              withhold_exempt: !!m?.is_owner,
                            })
                          }}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <RateCell value={Number(r.settlement_rate)} readOnly={!canEditMoney} onSave={v => updateRow(r.id, { settlement_rate: v })} />
                      </td>
                      <td className="px-1 py-1">
                        {/* 분배 행의 매도칸(사무실 수익)은 현재 합계 실시간 파생 → 편집 차단 */}
                        <MoneyCell value={r.seller_fee} readOnly={!canEditMoney || isDistributionRow(r)} onSave={v => updateRow(r.id, { seller_fee: v })} />
                      </td>
                      <td className="px-1 py-1">
                        <MoneyCell value={r.buyer_fee} readOnly={!canEditMoney} onSave={v => updateRow(r.id, { buyer_fee: v })} />
                      </td>
                      <td className="px-1 py-1"><MoneyCell value={c.total} readOnly /></td>
                      <td className="px-1 py-1">
                        {isDistributionRow(r) ? (
                          // 분배 행은 공급가 = 총수수료(순손익)로 항상 같아 중복 표시 생략.
                          // 잘못 수정하면 자동 VAT 분리(÷1.1)로 계산이 틀어지므로 편집도 차단.
                          <div className="w-full px-1 py-0.5 text-xs text-right font-mono text-gray-500 dark:text-gray-400 min-h-[22px]">—</div>
                        ) : (
                          <SupplyCell
                            supply={c.supply}
                            isManual={r.vat_override != null}
                            readOnly={!canEditMoney}
                            onSave={newSupply => {
                              if (newSupply == null) updateRow(r.id, { vat_override: null })
                              else updateRow(r.id, { vat_override: Math.max(0, c.total - newSupply) })
                            }}
                          />
                        )}
                      </td>
                      <td className="px-1 py-1"><MoneyCell value={c.assignee} readOnly /></td>
                      <td className="px-1 py-1"><MoneyCell value={c.takeHome} readOnly accent="blue" /></td>
                      <td className="px-1 py-1">
                        <DateCell
                          value={r.seller_payment_date}
                          readOnly={!canEditMoney}
                          onSave={v => updateRow(r.id, { seller_payment_date: v || null })}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <DateCell
                          value={r.buyer_payment_date}
                          readOnly={!canEditMoney}
                          onSave={v => updateRow(r.id, { buyer_payment_date: v || null })}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <TextCell value={r.memo} placeholder="—" readOnly={!canEditMoney} onSave={v => updateRow(r.id, { memo: v })} />
                      </td>
                      <td className="px-2 py-1.5 bg-white sticky right-0 z-10 shadow-[-4px_0_8px_-4px_rgba(0,0,0,0.06)] dark:bg-gray-900">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="month"
                            value={r.record_month ?? ''}
                            disabled={!canEditMoney || isDistributionRow(r)}
                            onChange={e => { if (e.target.value) updateRow(r.id, { record_month: e.target.value }) }}
                            title="다른 달로 옮기기"
                            aria-label="기록월 변경"
                            className="h-6 w-6 cursor-pointer rounded border-none bg-transparent p-0 text-transparent text-gray-300 hover:bg-blue-50 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-datetime-edit]:hidden [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 hover:[&::-webkit-calendar-picker-indicator]:opacity-100"
                          />
                          {canEditMoney && (
                            <button onClick={() => deleteRow(r)} title="삭제"
                              className="flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td colSpan={16} className="border-t border-gray-100 dark:border-gray-800">
                    <div className="flex items-stretch">
                      <button onClick={addNewRow}
                        className="flex shrink-0 items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50/80 hover:text-gray-600 dark:text-gray-500 transition-colors">
                        <Plus className="h-3.5 w-3.5" />정산 등록
                      </button>
                      {isOwner && !allMode && expenseSettings && (
                        <button onClick={addDistributionRow}
                          title="이 달 순손익의 동업자 몫을 정산 행으로 등록 (3.3% 공제 적용)"
                          className="flex shrink-0 items-center gap-2 border-l border-gray-100 px-4 py-2 text-sm text-blue-600/80 hover:bg-blue-50/80 hover:text-blue-700 dark:border-gray-800 dark:text-blue-400 dark:hover:bg-blue-500/10 transition-colors">
                          <Plus className="h-3.5 w-3.5" />분배 등록
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  )
}
