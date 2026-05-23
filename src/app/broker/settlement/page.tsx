'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, Download,
} from 'lucide-react'
import { TextCell } from '@/components/sheet/cells/text-cell'
import { SelectCell } from '@/components/sheet/cells/select-cell'
import { DateCell } from '@/components/sheet/cells/date-cell'
import { SheetActionCell, SheetActionHeader } from '@/components/sheet/action-cell'
import { calcSettlement, calcOfficeShare, fmtComma, type SettlementRow } from '@/lib/settlement'

interface Settlement {
  id: string
  office_broker_id: string
  assignee_broker_id: string | null
  contract_no: number
  contract_date: string | null
  contract_address: string | null
  seller: string | null
  buyer: string | null
  assignee_name: string | null
  settlement_rate: number
  seller_fee: number
  buyer_fee: number
  seller_payment_date: string | null
  buyer_payment_date: string | null
  is_settled: boolean
  settled_at: string | null
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
const monthBounds = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const end = new Date(y, m, 0)
  return { start, end: `${y}-${String(m).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}` }
}

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
      <div className={`w-full px-1 py-0.5 text-xs text-right font-mono ${value ? colorCls : 'text-gray-300'} min-h-[22px]`}>
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
      className={`w-full cursor-pointer rounded px-1 py-0.5 text-xs text-right font-mono hover:bg-blue-50 min-h-[22px] ${value ? colorCls : 'text-gray-300'}`}>
      {value != null && value !== 0 ? value.toLocaleString() : '0'}
    </div>
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
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const auth = useAuth()

  const [officeId, setOfficeId] = useState<string | null>(null)
  const [isOwner, setIsOwner] = useState(false)
  const [meBroker, setMeBroker] = useState<Member | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [month, setMonth] = useState(() => yyyymm(new Date()))
  const [allMode, setAllMode] = useState(false)
  const [rows, setRows] = useState<Settlement[]>([])
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
  }, [auth.user, supabase])

  // 정산 데이터 로드 — 월별 분류 기준은 '수수료 입금일'(payment_month)
  // 계약일이 12월이고 입금이 1월이면 1월에 잡힘. 정산 처리 월은 그 다음 달.
  const loadRows = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    let q = supabase
      .from('settlements')
      .select('*')
      .eq('office_broker_id', officeId)
    if (!allMode) {
      const { start, end } = monthBounds(month)
      q = q.gte('contract_date', start).lte('contract_date', end)
    }
    const { data } = await q
      .order('contract_date', { ascending: true, nullsFirst: false })
      .order('contract_no', { ascending: true })
    setRows((data ?? []) as Settlement[])
    setLoading(false)
  }, [officeId, month, allMode, supabase])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadRows() }, [loadRows])

  // 내 행만 보는 직원 / 대표는 전체
  const visibleRows = useMemo(() => {
    if (isOwner) return rows
    if (!meBroker) return []
    return rows.filter(r => r.assignee_broker_id === meBroker.id)
  }, [rows, isOwner, meBroker])

  // 같은 contract_no 그룹 — 공동중개 시 지점수익 계산용 (사무소 전체 기준)
  const groupedRows = useMemo(() => {
    const map = new Map<number, Settlement[]>()
    for (const r of rows) {
      const k = r.contract_no
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    return map
  }, [rows])

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

    let officeShare = 0
    if (isOwner) {
      for (const arr of groupedRows.values()) {
        officeShare += calcOfficeShare(arr as SettlementRow[])
      }
    }

    return { totalFee, supplySum, assigneeSum, takeHomeSum, myAssigneeSum, myTakeHomeSum, officeShare,
      count: visibleRows.length }
  }, [visibleRows, isOwner, groupedRows, meBroker])

  const moveMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(yyyymm(d))
  }

  // 한 셀 업데이트 — 즉시 DB 반영 + 낙관적 UI
  const updateRow = async (id: string, patch: Partial<Settlement>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
    const { error } = await supabase.from('settlements').update(patch).eq('id', id)
    if (error) { alert('저장 실패: ' + error.message); loadRows() }
  }

  // 새 빈 행 추가 — 시트 상단에 노출
  const addNewRow = async () => {
    if (!officeId || !meBroker) return
    const { data: nextNoData } = await supabase.rpc('next_settlement_no', { p_office: officeId })
    const nextNo = (nextNoData as number) ?? 1
    const today = new Date()
    const dateInMonth = month === yyyymm(today)
      ? today.toISOString().slice(0, 10)
      : `${month}-01`

    // 직원이 만들면 본인 할당, 대표면 일단 본인 (다른 사람으로 바꿀 수 있게)
    const rate = isOwner
      ? Number(meBroker.default_settlement_rate ?? 0.5)
      : Number(meBroker.default_settlement_rate ?? 0.5)
    const exempt = !!meBroker.withhold_exempt

    const { data, error } = await supabase
      .from('settlements')
      .insert({
        office_broker_id: officeId,
        assignee_broker_id: meBroker.id,
        assignee_name: meBroker.profiles?.name ?? null,
        contract_no: nextNo,
        contract_date: dateInMonth,
        settlement_rate: rate,
        withhold_exempt: exempt,
        seller_fee: 0,
        buyer_fee: 0,
        is_settled: false,
        created_by: meBroker.id,
      })
      .select('*')
      .single()
    if (error) { alert('추가 실패: ' + error.message); return }
    setRows(prev => [...prev, data as Settlement])
  }

  // 행 복사 — 같은 내용을 새 NO로 복제 (담당자만 바꾸면 공동중개 분할)
  const copyRow = async (r: Settlement) => {
    if (!officeId || !meBroker) return
    const { data: nextNoData } = await supabase.rpc('next_settlement_no', { p_office: officeId })
    const nextNo = (nextNoData as number) ?? 1
    const { data, error } = await supabase
      .from('settlements')
      .insert({
        office_broker_id: officeId,
        assignee_broker_id: r.assignee_broker_id,
        assignee_name: r.assignee_name,
        contract_no: nextNo,
        contract_date: r.contract_date,
        contract_address: r.contract_address,
        seller: r.seller,
        buyer: r.buyer,
        settlement_rate: r.settlement_rate,
        seller_fee: r.seller_fee,
        buyer_fee: r.buyer_fee,
        seller_payment_date: r.seller_payment_date,
        buyer_payment_date: r.buyer_payment_date,
        is_settled: false,
        withhold_exempt: r.withhold_exempt,
        memo: r.memo,
        created_by: meBroker.id,
      })
      .select('*')
      .single()
    if (error) { alert('복사 실패: ' + error.message); return }
    setRows(prev => [...prev, data as Settlement])
  }

  const deleteRow = async (r: Settlement) => {
    if (!confirm(`#${r.contract_no} ${r.contract_address ?? ''} 삭제할까요?`)) return
    const { error } = await supabase.from('settlements').delete().eq('id', r.id)
    if (error) { alert('삭제 실패: ' + error.message); return }
    setRows(prev => prev.filter(x => x.id !== r.id))
  }

  // CSV 다운로드 (직원·사무소 두 양식)
  const downloadCsv = (mode: 'employee' | 'office') => {
    const head = mode === 'employee'
      ? ['NO','계약일','계약주소','매도인(임대)','매수인(임차)','담당자','정산비','매도수수료','매수수수료','총수수료','VAT','공급가','담당자수수료','실수령(원천후)','매도입금일','매수입금일']
      : ['NO','계약일','계약주소','매도인(임대)','매수인(임차)','담당자','정산비','매도수수료','매수수수료','총수수료','VAT','공급가','담당자수수료','실수령(원천후)','지점수익','매도입금일','매수입금일','정산일']

    const lines: string[] = [head.join(',')]
    for (const r of visibleRows) {
      const c = calcSettlement(r)
      const group = groupedRows.get(r.contract_no) ?? []
      const isFirstInGroup = group[0]?.id === r.id
      const officeShareForRow = mode === 'office'
        ? (isFirstInGroup ? String(calcOfficeShare(group as SettlementRow[])) : '')
        : ''
      const csv = (s: string | number | null | undefined) => {
        const v = s == null ? '' : String(s)
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
      }
      const row: (string | number)[] = [
        r.contract_no,
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
      ]
      if (mode === 'office') row.push(officeShareForRow, r.seller_payment_date ?? '', r.buyer_payment_date ?? '', r.settled_at ?? (r.is_settled ? 'O' : ''))
      else row.push(r.seller_payment_date ?? '', r.buyer_payment_date ?? '')
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="px-4 py-8 text-center text-sm text-gray-500">불러오는 중…</div>
      </div>
    )
  }

  if (!officeId) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          사무소 정보를 찾을 수 없습니다. <Link href="/broker/register" className="text-blue-600 underline">사무소 등록</Link>이 필요합니다.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="px-4 py-6">
        {/* 헤더 */}
        <div className="mb-4 flex items-center gap-3">
          <button onClick={() => router.back()} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-black text-gray-900 dark:text-white">정산</h1>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">
            {isOwner ? '사무소 보기' : '직원 보기'}
          </span>
        </div>

        {/* 월 네비 + 액션 */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={() => { setAllMode(false); moveMonth(-1) }} disabled={allMode}
              className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {allMode ? (
              <span className="min-w-[8rem] text-center text-base font-bold text-gray-400">전체 보기</span>
            ) : (
              <input
                type="month"
                value={month}
                onChange={e => { if (e.target.value) setMonth(e.target.value) }}
                className="cursor-pointer rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-base font-bold text-gray-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white"
              />
            )}
            <button onClick={() => { setAllMode(false); moveMonth(1) }} disabled={allMode}
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
          <div className="flex items-center gap-2">
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

        {/* 대표용 요약 카드 — 직원은 표 하단 합계 줄만 봄 */}
        {isOwner && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card>
              <CardBody className="p-4">
                <p className="text-[11px] font-medium text-gray-500">이번 달 총수수료</p>
                <p className="mt-1 text-xl font-black text-gray-900 dark:text-white">{fmtComma(summary.totalFee)}<span className="ml-0.5 text-xs font-medium text-gray-400">원</span></p>
                <p className="mt-0.5 text-[10px] text-gray-400">VAT 포함</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-4">
                <p className="text-[11px] font-medium text-gray-500">공급가 (VAT 별도)</p>
                <p className="mt-1 text-xl font-black text-gray-900 dark:text-white">{fmtComma(summary.supplySum)}<span className="ml-0.5 text-xs font-medium text-gray-400">원</span></p>
                <p className="mt-0.5 text-[10px] text-gray-400">VAT {fmtComma(summary.totalFee - summary.supplySum)}원</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-4">
                <p className="text-[11px] font-medium text-gray-500">담당자 수수료 합</p>
                <p className="mt-1 text-xl font-black text-blue-700 dark:text-blue-300">{fmtComma(summary.assigneeSum)}<span className="ml-0.5 text-xs font-medium text-gray-400">원</span></p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="p-4">
                <p className="text-[11px] font-medium text-gray-500">사무소 수익</p>
                <p className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-300">{fmtComma(summary.officeShare)}<span className="ml-0.5 text-xs font-medium text-gray-400">원</span></p>
              </CardBody>
            </Card>
          </div>
        )}

        {/* 시트형 표 */}
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50">
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 40 }}>NO</th>
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
                  {isOwner && <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500" style={{ width: 90 }}>지점수익</th>}
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 110 }}>매도입금일</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500" style={{ width: 110 }}>매수입금일</th>
                  <SheetActionHeader width={56}>{null}</SheetActionHeader>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => {
                  const c = calcSettlement(r)
                  const group = groupedRows.get(r.contract_no) ?? []
                  const isFirstInGroup = group[0]?.id === r.id
                  const isCoBroker = group.length > 1
                  const officeShareForRow = isFirstInGroup ? calcOfficeShare(group as SettlementRow[]) : null
                  const canEditMoney = isOwner || r.assignee_broker_id === meBroker?.id

                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/60 dark:border-gray-800 dark:hover:bg-gray-800/20">
                      <td className="px-2 py-1 font-mono text-gray-500">{r.contract_no}</td>
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
                              withhold_exempt: !!m?.withhold_exempt,
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
                      <td className="px-1 py-1"><MoneyCell value={c.supply} readOnly /></td>
                      <td className="px-1 py-1"><MoneyCell value={c.assignee} readOnly accent="blue" /></td>
                      <td className="px-1 py-1"><MoneyCell value={c.takeHome} readOnly accent="emerald" /></td>
                      {isOwner && (
                        <td className="px-1 py-1">
                          <MoneyCell value={officeShareForRow} readOnly accent="emerald" />
                        </td>
                      )}
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
                      <SheetActionCell
                        canEdit={canEditMoney}
                        onCopy={() => copyRow(r)}
                        onDelete={() => deleteRow(r)}
                      />
                    </tr>
                  )
                })}
                {visibleRows.length > 0 && (
                  <tr className="border-t-2 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60 font-bold">
                    <td colSpan={12} className="px-2 py-2 text-right text-[11px] text-gray-600 dark:text-gray-300">
                      총 {summary.count}건 · 실수령 합계
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-mono text-emerald-700">
                      {fmtComma(isOwner ? summary.takeHomeSum : summary.myTakeHomeSum)}
                    </td>
                    <td colSpan={isOwner ? 4 : 3} />
                  </tr>
                )}
                <tr>
                  <td colSpan={isOwner ? 17 : 16} className="border-t border-gray-100 dark:border-gray-800">
                    <button onClick={addNewRow}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-400 hover:bg-gray-50/80 hover:text-gray-600 dark:text-gray-400 transition-colors">
                      <Plus className="h-3.5 w-3.5" />계약 등록
                    </button>
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
