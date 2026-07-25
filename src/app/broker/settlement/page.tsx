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
import { calcSettlement, calcWithhold, fmtComma } from '@/lib/settlement'
import { notifyOwnerOfBrokerAction } from '@/lib/notify-owner'

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

  const colorCls = accent === 'blue' ? 'text-blue-700 font-semibold'
    : accent === 'emerald' ? 'text-emerald-700 font-semibold'
    : 'text-gray-800'

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
      className={`w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right font-mono hover:bg-blue-50 min-h-[22px] ${value ? colorCls : 'text-gray-500 dark:text-gray-400'}`}>
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
      <div className={`w-full px-1 py-0.5 text-xs text-right font-mono min-h-[22px] ${isManual ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}>
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
      className={`w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right font-mono hover:bg-blue-50 min-h-[22px] ${isManual ? 'text-blue-700 font-semibold' : 'text-gray-700'}`}
    >
      {supply ? supply.toLocaleString() : '0'}
      {isManual && <span className="ml-0.5 text-[9px] text-blue-500">●</span>}
    </div>
  )
}

// ── 손익 분배 카드용 인라인 숫자 입력 (blur/Enter 저장, 콤마 표시) ──
function InlineNumber({ value, onSave, min, max, className }: {
  value: number
  onSave: (v: number) => void
  min?: number
  max?: number
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    const n = Number(draft)
    if (isNaN(n)) return
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? 0, n))
    if (clamped !== value) onSave(clamped)
  }

  if (editing) {
    return (
      <input ref={inputRef} type="number" value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(String(value)); setEditing(false) } }}
        className={`rounded border border-blue-400 bg-white dark:bg-gray-900 px-1 py-0.5 text-xs text-right font-mono outline-none focus:ring-2 focus:ring-blue-300 ${className ?? 'w-24'}`}
      />
    )
  }
  return (
    <button type="button" onClick={() => { setDraft(String(value)); setEditing(true) }}
      title="클릭해서 수정"
      className={`rounded px-1 py-0.5 text-xs text-right font-mono text-gray-800 dark:text-gray-200 underline decoration-dotted decoration-gray-400 underline-offset-2 hover:bg-blue-50 dark:hover:bg-blue-500/10 ${className ?? ''}`}>
      {value.toLocaleString()}
    </button>
  )
}

// ── 정산비 셀 (0.50 / 0.55 / 0.60 / 0.70 ...) ─────────────
function RateCell({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) { inputRef.current?.focus(); inputRef.current?.select() } }, [editing])

  const commit = () => {
    setEditing(false)
    const num = Number(draft)
    if (!isNaN(num) && num !== value) onSave(num)
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
      className="w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right font-mono hover:bg-blue-50 min-h-[22px] text-gray-800">
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
      const { data: dist } = await supabase
        .from('settlements')
        .select('assignee_broker_id, assignee_name')
        .eq('office_broker_id', office)
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
    let q = supabase
      .from('settlements')
      .select('*')
      .eq('office_broker_id', officeId)
    if (!allMode) {
      q = q.eq('record_month', month)
    }
    const { data } = await q
      .order('contract_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
    setRows((data ?? []) as Settlement[])
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
      .select('seller_fee, buyer_fee, settlement_rate, withhold_exempt, vat_override')
      .eq('office_broker_id', officeId)
      .eq('assignee_broker_id', meBroker.id)
      .eq('record_month', prev)
      .then(({ data }) => {
        if (!data) { setPrevMonthTakeHome(0); return }
        const sum = data.reduce((s, r: any) => s + calcSettlement(r).takeHome, 0)
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
    return base
  }, [rows, isOwner, meBroker, filterAssigneeId])

  // 공동중개(contract_no) 그룹화 폐기 — 1계약 1행 구조로 단순화

  // 멤버 이름 옵션 (SelectCell)
  const memberOptions = useMemo(() => members.map(m => m.profiles?.name ?? '').filter(Boolean), [members])
  const nameToBroker = useMemo(() => {
    const m = new Map<string, Member>()
    for (const x of members) if (x.profiles?.name) m.set(x.profiles.name, x)
    return m
  }, [members])

  // 요약 합계
  const summary = useMemo(() => {
    let totalFee = 0, supplySum = 0, assigneeSum = 0, takeHomeSum = 0
    let myAssigneeSum = 0, myTakeHomeSum = 0
    for (const r of visibleRows) {
      const c = calcSettlement(r)
      totalFee     += c.total
      supplySum    += c.supply
      assigneeSum  += c.assignee
      takeHomeSum  += c.takeHome
      if (meBroker && r.assignee_broker_id === meBroker.id) {
        myAssigneeSum += c.assignee
        myTakeHomeSum += c.takeHome
      }
    }

    // 사무실 수익: 공급가 합 − 담당자 수수료 합 (1계약 1행 구조)
    const officeShare = isOwner ? (supplySum - assigneeSum) : 0

    return { totalFee, supplySum, assigneeSum, takeHomeSum, myAssigneeSum, myTakeHomeSum, officeShare,
      count: visibleRows.length }
  }, [visibleRows, isOwner, meBroker])

  // 대표 전용: 이 달 사무실 수익 (직원 필터와 무관하게 월 전체 행 기준)
  const officeMonthProfit = useMemo(() => {
    let supply = 0, assignee = 0
    for (const r of rows) {
      const c = calcSettlement(r)
      supply += c.supply
      assignee += c.assignee
    }
    return supply - assignee
  }, [rows])

  // 경비·비율 저장 — 낙관적 UI + upsert
  const saveExpenseSettings = async (patch: Partial<{ monthly_expense: number; partner_split: number }>) => {
    if (!officeId || !expenseSettings) return
    const next = { ...expenseSettings, ...patch }
    setExpenseSettings(next)
    const { error } = await supabase
      .from('office_settlement_settings')
      .upsert({ office_broker_id: officeId, ...next, updated_at: new Date().toISOString() })
    if (error) toast.error('분배 설정 저장 실패: ' + error.message)
  }

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

  // 대표 전용: 이 달 동업자 몫을 정산 행으로 등록
  // 정산비 1.0 + VAT 0(vat_override)으로 넣어 담당자수수료 = 몫 그대로, 3.3% 공제는 기존 계산이 적용.
  // 공급가 = 담당자수수료라 사무실 수익(공급가−담당자) 집계를 왜곡하지 않는다.
  const addDistributionRow = async () => {
    if (!officeId || !meBroker || !expenseSettings || allMode) return
    const net = officeMonthProfit - expenseSettings.monthly_expense
    const partnerShare = net - Math.round(net * expenseSettings.partner_split)
    if (partnerShare <= 0) {
      toast.error(`이 달은 분배할 수익이 없습니다 (순손익 ${fmtComma(net)}원)`)
      return
    }
    const label = `${month} 사무실 손익 분배`
    const dup = rows.find(r => r.record_month === month && r.contract_address === label)
    if (dup) {
      toast.error('이미 이 달 분배 행이 있습니다. 금액이 바뀌었으면 기존 행을 삭제하고 다시 등록하세요.')
      setHighlightSettlementId(dup.id)
      document.querySelector(`tr[data-row-id="${dup.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setTimeout(() => setHighlightSettlementId(null), 2500)
      return
    }
    const myPct = Math.round(expenseSettings.partner_split * 100)
    const { data, error } = await supabase
      .from('settlements')
      .insert({
        office_broker_id: officeId,
        assignee_broker_id: null,
        assignee_name: '동업자',
        contract_address: label,
        record_month: month,
        settlement_rate: 1,
        withhold_exempt: false,
        seller_fee: partnerShare,
        buyer_fee: 0,
        vat_override: 0,
        memo: `순손익 ${fmtComma(net)} × ${100 - myPct}%`,
        created_by: meBroker.id,
      })
      .select('*')
      .single()
    if (error) { toast.error('분배 등록 실패: ' + error.message); return }
    setRows(prev => [...prev, data as Settlement])
    setHighlightSettlementId((data as Settlement).id)
    setTimeout(() => setHighlightSettlementId(null), 2500)
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
    for (const r of visibleRows) {
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
                <p className="text-[11px] font-medium text-gray-500">담당자</p>
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
                    = 공급가 {fmtComma(summary.supplySum)} − 담당자 {fmtComma(summary.assigneeSum)}
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

        {/* 대표 전용: 사무실 손익 분배 — 월 수익 − 기본경비를 동업 비율로 분배 */}
        {isOwner && expenseSettings && !allMode && (() => {
          const net = officeMonthProfit - expenseSettings.monthly_expense
          const myPct = Math.round(expenseSettings.partner_split * 100)
          const myShare = Math.round(net * expenseSettings.partner_split)
          const partnerShare = net - myShare
          // 동업자는 직원과 동일하게 3.3% 원천공제 후 지급 (손실이면 공제 없음)
          const partnerWithhold = calcWithhold(partnerShare)
          const partnerTakeHome = partnerShare - partnerWithhold
          const amountCls = (n: number) => n < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300'
          return (
            <Card className="mb-4">
              <CardBody className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-gray-500">
                    사무실 손익 분배 <span className="text-gray-400">— 직원 필터와 무관하게 이 달 전체 기준</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
                    <span className="flex items-center gap-1">
                      기본경비
                      <InlineNumber value={expenseSettings.monthly_expense} min={0}
                        onSave={v => saveExpenseSettings({ monthly_expense: Math.round(v) })} />
                      원
                    </span>
                    <span className="flex items-center gap-1">
                      내 비율
                      <InlineNumber value={myPct} min={0} max={100} className="w-10"
                        onSave={v => saveExpenseSettings({ partner_split: Math.round(v) / 100 })} />
                      %
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <p className="text-[11px] font-medium text-gray-500">순손익</p>
                    <p className={`mt-1 text-xl font-black ${amountCls(net)}`}>{fmtComma(net)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span></p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      = 사무실 수익 {fmtComma(officeMonthProfit)} − 경비 {fmtComma(expenseSettings.monthly_expense)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-gray-500">내 몫 ({myPct}%)</p>
                    <p className={`mt-1 text-xl font-black ${amountCls(myShare)}`}>{fmtComma(myShare)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span></p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-gray-500">동업자 실수령 ({100 - myPct}%)</p>
                    <p className={`mt-1 text-xl font-black ${amountCls(partnerTakeHome)}`}>{fmtComma(partnerTakeHome)}<span className="ml-0.5 text-xs font-medium text-gray-500">원</span></p>
                    <p className="mt-0.5 text-[10px] text-gray-500">
                      = 몫 {fmtComma(partnerShare)} − 원천 3.3% {fmtComma(partnerWithhold)}
                    </p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        })()}

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
                {visibleRows.map(r => {
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
                        <RateCell value={Number(r.settlement_rate)} onSave={v => updateRow(r.id, { settlement_rate: v })} />
                      </td>
                      <td className="px-1 py-1">
                        <MoneyCell value={r.seller_fee} readOnly={!canEditMoney} onSave={v => updateRow(r.id, { seller_fee: v })} />
                      </td>
                      <td className="px-1 py-1">
                        <MoneyCell value={r.buyer_fee} readOnly={!canEditMoney} onSave={v => updateRow(r.id, { buyer_fee: v })} />
                      </td>
                      <td className="px-1 py-1"><MoneyCell value={c.total} readOnly /></td>
                      <td className="px-1 py-1">
                        <SupplyCell
                          supply={c.supply}
                          isManual={r.vat_override != null}
                          readOnly={!canEditMoney}
                          onSave={newSupply => {
                            if (newSupply == null) updateRow(r.id, { vat_override: null })
                            else updateRow(r.id, { vat_override: Math.max(0, c.total - newSupply) })
                          }}
                        />
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
                            disabled={!canEditMoney}
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
                        className="flex flex-1 items-center gap-2 px-4 py-2 text-sm text-gray-500 hover:bg-gray-50/80 hover:text-gray-600 dark:text-gray-500 transition-colors">
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
