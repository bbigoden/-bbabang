'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { Card, CardBody } from '@/components/ui/card'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, Download, Trash2, Edit3, Calculator, X,
} from 'lucide-react'
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
  payment_date: string | null
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
  const [rows, setRows] = useState<Settlement[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Settlement | null>(null)

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

    // 같은 사무소 멤버 전체 (대표 포함)
    const { data: mems } = await supabase
      .from('broker_profiles')
      .select('id, user_id, is_owner, parent_broker_id, default_settlement_rate, withhold_exempt, is_approved, profiles:user_id(name)')
      .or(`id.eq.${office},parent_broker_id.eq.${office}`)
    setMembers((mems ?? []).filter((m: any) => m.is_owner || m.is_approved) as any)
  }, [auth.user, supabase])

  // 정산 데이터 로드
  const loadRows = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    const { start, end } = monthBounds(month)
    const { data } = await supabase
      .from('settlements')
      .select('*')
      .eq('office_broker_id', officeId)
      .gte('contract_date', start)
      .lte('contract_date', end)
      .order('contract_date', { ascending: true })
      .order('contract_no', { ascending: true })
    setRows((data ?? []) as Settlement[])
    setLoading(false)
  }, [officeId, month, supabase])

  useEffect(() => { loadMeta() }, [loadMeta])
  useEffect(() => { loadRows() }, [loadRows])

  // 내 행만 보는 직원 / 대표는 전체
  const visibleRows = useMemo(() => {
    if (isOwner) return rows
    if (!meBroker) return []
    return rows.filter(r => r.assignee_broker_id === meBroker.id)
  }, [rows, isOwner, meBroker])

  // 한 계약(같은 contract_no) 그룹 — 공동중개 시 지점수익 계산용
  const groupedRows = useMemo(() => {
    const map = new Map<number, Settlement[]>()
    for (const r of rows) {
      const k = r.contract_no
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    return map
  }, [rows])

  // 요약 합계
  const summary = useMemo(() => {
    let totalFee = 0, supplySum = 0, assigneeSum = 0, takeHomeSum = 0
    let myAssigneeSum = 0, myTakeHomeSum = 0
    const settledCount = visibleRows.filter(r => r.is_settled).length

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

    // 사무소 수익 = 공급가 합 − 모든 담당자 수수료 합 (사무소뷰만 의미 있음)
    let officeShare = 0
    if (isOwner) {
      for (const arr of groupedRows.values()) {
        officeShare += calcOfficeShare(arr as SettlementRow[])
      }
    }

    return {
      totalFee, supplySum, assigneeSum, takeHomeSum,
      myAssigneeSum, myTakeHomeSum,
      officeShare,
      count: visibleRows.length,
      settledCount,
    }
  }, [visibleRows, isOwner, groupedRows, meBroker])

  const moveMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(yyyymm(d))
  }

  // 새 계약 저장
  const saveRow = async (payload: Partial<Settlement>) => {
    if (!officeId || !meBroker) return
    if (editing) {
      const { error } = await supabase
        .from('settlements')
        .update(payload)
        .eq('id', editing.id)
      if (error) { alert('저장 실패: ' + error.message); return }
    } else {
      // 새 contract_no 자동 부여 (같은 사무소 + 같은 contract_date 그룹은 같은 번호로 묶을 수 있게 추후 UI에서 조정)
      const { data: nextNo } = await supabase.rpc('next_settlement_no', { p_office: officeId })
      const { error } = await supabase
        .from('settlements')
        .insert({
          ...payload,
          office_broker_id: officeId,
          contract_no: payload.contract_no ?? (nextNo as number) ?? 1,
          created_by: meBroker.id,
        })
      if (error) { alert('저장 실패: ' + error.message); return }
    }
    setShowForm(false); setEditing(null)
    loadRows()
  }

  const deleteRow = async (r: Settlement) => {
    if (!confirm(`계약 #${r.contract_no} (${r.contract_address ?? ''}) 삭제할까요?`)) return
    const { error } = await supabase.from('settlements').delete().eq('id', r.id)
    if (error) { alert('삭제 실패: ' + error.message); return }
    loadRows()
  }

  const toggleSettled = async (r: Settlement) => {
    const next = !r.is_settled
    const { error } = await supabase
      .from('settlements')
      .update({ is_settled: next, settled_at: next ? new Date().toISOString().slice(0, 10) : null })
      .eq('id', r.id)
    if (error) { alert('변경 실패: ' + error.message); return }
    loadRows()
  }

  // CSV 다운로드 (직원·사무소 두 양식)
  const downloadCsv = (mode: 'employee' | 'office') => {
    const head = mode === 'employee'
      ? ['NO','계약일','계약주소','매도인(임대)','매수인(임차)','담당자','정산비','매도수수료','매수수수료','총수수료','VAT','공급가','담당자수수료','실수령(원천후)','수수료입금일']
      : ['NO','계약일','계약주소','매도인(임대)','매수인(임차)','담당자','정산비','매도수수료','매수수수료','총수수료','VAT','공급가','담당자수수료','실수령(원천후)','지점수익','수수료입금일','정산일']

    const lines: string[] = [head.join(',')]
    for (const r of visibleRows) {
      const c = calcSettlement(r)
      const group = groupedRows.get(r.contract_no) ?? []
      const officeShareForRow = group.length > 1
        ? '' // 공동중개는 첫 행에만 표기하기 애매하니 빈칸. 합계로 표시.
        : String(c.supply - c.assignee)
      const csv = (s: string | number | null | undefined) => {
        const v = s == null ? '' : String(s)
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
      }
      const row = [
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
      if (mode === 'office') row.push(officeShareForRow, csv(r.payment_date ?? ''), r.settled_at ?? (r.is_settled ? 'O' : ''))
      else row.push(csv(r.payment_date ?? ''))
      lines.push(row.join(','))
    }
    // BOM 추가 → 엑셀 한글 안 깨짐
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${mode === 'employee' ? '직원정산' : '사무소정산'}_${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (auth.loading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="mx-auto max-w-6xl px-4 py-8 text-center text-sm text-gray-500">불러오는 중…</div>
      </div>
    )
  }

  if (!officeId) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="mx-auto max-w-6xl px-4 py-8 text-center text-sm text-gray-500">
          사무소 정보를 찾을 수 없습니다. <Link href="/broker/register" className="text-blue-600 underline">사무소 등록</Link>이 필요합니다.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Header />

      <div className="mx-auto max-w-6xl px-4 py-6">
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
            <button onClick={() => moveMonth(-1)} className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[7rem] text-center text-base font-bold text-gray-900 dark:text-white">
              {month.replace('-', '년 ')}월
            </span>
            <button onClick={() => moveMonth(1)} className="rounded-lg border border-gray-200 bg-white p-2 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={() => setMonth(yyyymm(new Date()))} className="ml-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              이번 달
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
            <button onClick={() => { setEditing(null); setShowForm(true) }} className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
              <Plus className="h-3.5 w-3.5" /> 새 계약
            </button>
          </div>
        </div>

        {/* 요약 카드 */}
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
          {isOwner ? (
            <>
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
            </>
          ) : (
            <>
              <Card>
                <CardBody className="p-4">
                  <p className="text-[11px] font-medium text-gray-500">내 담당자 수수료</p>
                  <p className="mt-1 text-xl font-black text-blue-700 dark:text-blue-300">{fmtComma(summary.myAssigneeSum)}<span className="ml-0.5 text-xs font-medium text-gray-400">원</span></p>
                </CardBody>
              </Card>
              <Card>
                <CardBody className="p-4">
                  <p className="text-[11px] font-medium text-gray-500">내 실수령 (원천후)</p>
                  <p className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-300">{fmtComma(summary.myTakeHomeSum)}<span className="ml-0.5 text-xs font-medium text-gray-400">원</span></p>
                </CardBody>
              </Card>
            </>
          )}
        </div>

        {/* 표 */}
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-[11px] font-semibold text-gray-500 dark:bg-gray-800/50">
                <tr>
                  <th className="px-2 py-2 text-left">#</th>
                  <th className="px-2 py-2 text-left">계약일</th>
                  <th className="px-2 py-2 text-left">주소</th>
                  <th className="px-2 py-2 text-left">담당자</th>
                  <th className="px-2 py-2 text-right">정산비</th>
                  <th className="px-2 py-2 text-right">총수수료</th>
                  <th className="px-2 py-2 text-right">공급가</th>
                  <th className="px-2 py-2 text-right">담당자수수료</th>
                  <th className="px-2 py-2 text-right">실수령</th>
                  {isOwner && <th className="px-2 py-2 text-right">지점수익</th>}
                  <th className="px-2 py-2 text-center">정산</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr><td colSpan={isOwner ? 12 : 11} className="py-12 text-center text-sm text-gray-400">이번 달에 등록된 계약이 없습니다</td></tr>
                )}
                {visibleRows.map(r => {
                  const c = calcSettlement(r)
                  const group = groupedRows.get(r.contract_no) ?? []
                  const isFirstInGroup = group[0]?.id === r.id
                  const officeShareForRow = isFirstInGroup ? calcOfficeShare(group as SettlementRow[]) : null
                  return (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/30">
                      <td className="px-2 py-2 font-mono text-gray-500">{r.contract_no}{group.length > 1 ? '*' : ''}</td>
                      <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{r.contract_date ?? '-'}</td>
                      <td className="px-2 py-2 text-gray-900 dark:text-white max-w-[18rem] truncate" title={r.contract_address ?? ''}>{r.contract_address ?? '-'}</td>
                      <td className="px-2 py-2 text-gray-700 dark:text-gray-300">{r.assignee_name ?? '-'}</td>
                      <td className="px-2 py-2 text-right font-mono text-gray-700 dark:text-gray-300">{r.settlement_rate}</td>
                      <td className="px-2 py-2 text-right font-mono text-gray-900 dark:text-white">{fmtComma(c.total)}</td>
                      <td className="px-2 py-2 text-right font-mono text-gray-700 dark:text-gray-300">{fmtComma(c.supply)}</td>
                      <td className="px-2 py-2 text-right font-mono font-semibold text-blue-700 dark:text-blue-300">{fmtComma(c.assignee)}</td>
                      <td className="px-2 py-2 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-300">{fmtComma(c.takeHome)}</td>
                      {isOwner && (
                        <td className="px-2 py-2 text-right font-mono text-emerald-700 dark:text-emerald-300">
                          {officeShareForRow != null ? fmtComma(officeShareForRow) : ''}
                        </td>
                      )}
                      <td className="px-2 py-2 text-center">
                        <button onClick={() => toggleSettled(r)}
                          className={`rounded-md px-2 py-1 text-[10px] font-bold ${r.is_settled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>
                          {r.is_settled ? '완료' : '대기'}
                        </button>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => { setEditing(r); setShowForm(true) }} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800">
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          {isOwner && (
                            <button onClick={() => deleteRow(r)} className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {visibleRows.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3 text-[11px] text-gray-500 dark:border-gray-800">
              총 {summary.count}건 · 정산 완료 {summary.settledCount}건 · <span className="text-gray-400">* 표시 = 공동중개</span>
            </div>
          )}
        </Card>
      </div>

      {showForm && (
        <SettlementForm
          editing={editing}
          members={members}
          meBroker={meBroker}
          isOwner={isOwner}
          officeId={officeId}
          defaultMonth={month}
          onCancel={() => { setShowForm(false); setEditing(null) }}
          onSave={saveRow}
        />
      )}
    </div>
  )
}

// ─── 입력 모달 ──────────────────────────────────────────────
function SettlementForm({
  editing, members, meBroker, isOwner, officeId, defaultMonth, onCancel, onSave,
}: {
  editing: Settlement | null
  members: Member[]
  meBroker: Member | null
  isOwner: boolean
  officeId: string
  defaultMonth: string
  onCancel: () => void
  onSave: (payload: Partial<Settlement>) => Promise<void>
}) {
  // 직원은 본인 행만 등록/수정 가능
  const editable = members.filter(m => isOwner || m.id === meBroker?.id)

  const defaultAssignee = editing
    ? members.find(m => m.id === editing.assignee_broker_id) ?? meBroker
    : meBroker

  const [assigneeId, setAssigneeId] = useState<string>(editing?.assignee_broker_id ?? defaultAssignee?.id ?? '')
  const [contractDate, setContractDate] = useState<string>(
    editing?.contract_date ?? `${defaultMonth}-${String(new Date().getDate()).padStart(2, '0')}`
  )
  const [address, setAddress] = useState(editing?.contract_address ?? '')
  const [seller, setSeller] = useState(editing?.seller ?? '')
  const [buyer, setBuyer] = useState(editing?.buyer ?? '')
  const initialAssignee = members.find(m => m.id === (editing?.assignee_broker_id ?? defaultAssignee?.id))
  const [rate, setRate] = useState<number>(editing?.settlement_rate ?? (initialAssignee?.default_settlement_rate ?? 0.5))
  const [sellerFee, setSellerFee] = useState<number>(editing?.seller_fee ?? 0)
  const [buyerFee, setBuyerFee] = useState<number>(editing?.buyer_fee ?? 0)
  const [paymentDate, setPaymentDate] = useState(editing?.payment_date ?? '')
  const [withholdExempt, setWithholdExempt] = useState<boolean>(
    editing?.withhold_exempt ?? (initialAssignee?.withhold_exempt ?? false)
  )
  const [memo, setMemo] = useState(editing?.memo ?? '')
  const [coBroker, setCoBroker] = useState(false) // 공동중개 추가 행 자동 생성
  const [coBrokerId, setCoBrokerId] = useState<string>('')
  const [coRate, setCoRate] = useState<number>(0.5)
  const [saving, setSaving] = useState(false)

  // 담당자 바뀌면 기본 정산비 / 원천 면제 자동 채움 (편집 모드가 아닐 때만)
  useEffect(() => {
    if (editing) return
    const m = members.find(x => x.id === assigneeId)
    if (m) {
      setRate(Number(m.default_settlement_rate ?? 0.5))
      setWithholdExempt(!!m.withhold_exempt)
    }
  }, [assigneeId, editing, members])

  const calc = calcSettlement({ seller_fee: sellerFee, buyer_fee: buyerFee, settlement_rate: rate, withhold_exempt: withholdExempt })
  const coCalc = coBroker && coBrokerId
    ? calcSettlement({
        seller_fee: sellerFee, buyer_fee: buyerFee, settlement_rate: coRate,
        withhold_exempt: !!members.find(m => m.id === coBrokerId)?.withhold_exempt,
      })
    : null

  const handleSubmit = async () => {
    if (!assigneeId) { alert('담당자를 선택하세요'); return }
    if (!address.trim()) { alert('계약 주소를 입력하세요'); return }
    setSaving(true)
    const assigneeMember = members.find(m => m.id === assigneeId)

    const payload: Partial<Settlement> = {
      assignee_broker_id: assigneeId,
      assignee_name: assigneeMember?.profiles?.name ?? null,
      contract_date: contractDate || null,
      contract_address: address.trim(),
      seller: seller || null,
      buyer: buyer || null,
      settlement_rate: rate,
      seller_fee: Math.max(0, Math.round(sellerFee)),
      buyer_fee: Math.max(0, Math.round(buyerFee)),
      payment_date: paymentDate || null,
      withhold_exempt: withholdExempt,
      memo: memo || null,
    }
    await onSave(payload)

    // 공동중개 — 같은 계약번호로 추가 행 자동 생성 (편집 모드에선 안 함)
    if (!editing && coBroker && coBrokerId) {
      try {
        const supabase = createClient()
        // 방금 저장된 행에서 contract_no 가져오기
        const { data: just } = await supabase
          .from('settlements')
          .select('contract_no')
          .eq('office_broker_id', officeId)
          .order('created_at', { ascending: false })
          .limit(1)
        const lastNo = just?.[0]?.contract_no ?? 1
        const coMember = members.find(m => m.id === coBrokerId)
        await supabase.from('settlements').insert({
          office_broker_id: officeId,
          assignee_broker_id: coBrokerId,
          assignee_name: coMember?.profiles?.name ?? null,
          contract_no: lastNo,
          contract_date: contractDate || null,
          contract_address: address.trim(),
          seller: seller || null,
          buyer: buyer || null,
          settlement_rate: coRate,
          seller_fee: Math.max(0, Math.round(sellerFee)),
          buyer_fee: Math.max(0, Math.round(buyerFee)),
          payment_date: paymentDate || null,
          withhold_exempt: !!coMember?.withhold_exempt,
          created_by: meBroker?.id ?? null,
        })
      } catch {}
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="max-h-[95vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-gray-900 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{editing ? '계약 수정' : '새 계약 등록'}</h2>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="계약일">
            <input type="date" value={contractDate} onChange={e => setContractDate(e.target.value)} className={inp} />
          </Field>
          <Field label="담당자">
            <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)} className={inp} disabled={!!editing && !isOwner}>
              {editable.map(m => <option key={m.id} value={m.id}>{m.profiles?.name ?? '이름 없음'}</option>)}
            </select>
          </Field>
          <Field label="계약 주소" full>
            <input type="text" value={address} onChange={e => setAddress(e.target.value)} className={inp} placeholder="예: 불당동 1421 중흥 1차101-2301" />
          </Field>
          <Field label="매도인 (임대)">
            <input type="text" value={seller} onChange={e => setSeller(e.target.value)} className={inp} />
          </Field>
          <Field label="매수인 (임차)">
            <input type="text" value={buyer} onChange={e => setBuyer(e.target.value)} className={inp} />
          </Field>
          <Field label="매도 수수료 (VAT 포함)">
            <input type="number" value={sellerFee} onChange={e => setSellerFee(Number(e.target.value))} className={inp} />
          </Field>
          <Field label="매수 수수료 (VAT 포함)">
            <input type="number" value={buyerFee} onChange={e => setBuyerFee(Number(e.target.value))} className={inp} />
          </Field>
          <Field label="정산비">
            <input type="number" step="0.01" min="0" max="1" value={rate} onChange={e => setRate(Number(e.target.value))} className={inp} />
          </Field>
          <Field label="수수료 입금일">
            <input type="text" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className={inp} placeholder="예: 250411 또는 250411/250430" />
          </Field>
          <Field label="원천 면제" full>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withholdExempt} onChange={e => setWithholdExempt(e.target.checked)} />
              <span className="text-gray-700 dark:text-gray-300">3.3% 원천징수를 떼지 않음 (대표·외주 등)</span>
            </label>
          </Field>
          <Field label="메모" full>
            <textarea value={memo} onChange={e => setMemo(e.target.value)} className={inp} rows={2} />
          </Field>

          {!editing && (
            <Field label="공동중개" full>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={coBroker} onChange={e => setCoBroker(e.target.checked)} />
                <span className="text-gray-700 dark:text-gray-300">같은 계약을 다른 담당자와 분배</span>
              </label>
              {coBroker && (
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                  <select value={coBrokerId} onChange={e => {
                    setCoBrokerId(e.target.value)
                    const m = members.find(x => x.id === e.target.value)
                    if (m) setCoRate(Number(m.default_settlement_rate ?? 0.5))
                  }} className={inp}>
                    <option value="">담당자 선택</option>
                    {members.filter(m => m.id !== assigneeId).map(m => (
                      <option key={m.id} value={m.id}>{m.profiles?.name ?? '이름 없음'}</option>
                    ))}
                  </select>
                  <input type="number" step="0.01" min="0" max="1" value={coRate} onChange={e => setCoRate(Number(e.target.value))} className={inp} placeholder="정산비" />
                </div>
              )}
            </Field>
          )}
        </div>

        {/* 자동 계산 미리보기 */}
        <div className="mt-4 rounded-xl bg-blue-50 p-4 text-sm dark:bg-blue-500/10">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-blue-700 dark:text-blue-300">
            <Calculator className="h-3.5 w-3.5" /> 자동 계산
          </div>
          <div className="grid grid-cols-2 gap-1 text-[12px] md:grid-cols-4">
            <Info label="총수수료" v={calc.total} />
            <Info label="공급가" v={calc.supply} />
            <Info label="VAT" v={calc.vat} />
            <Info label="담당자 수수료" v={calc.assignee} accent />
            <Info label="원천공제" v={calc.withhold} />
            <Info label="실수령" v={calc.takeHome} accent />
            {coCalc && <Info label={`공동 ${members.find(m=>m.id===coBrokerId)?.profiles?.name ?? ''} 수수료`} v={coCalc.assignee} />}
            {coCalc && <Info label={`공동 실수령`} v={coCalc.takeHome} />}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">취소</button>
          <button onClick={handleSubmit} disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
            {saving ? '저장 중…' : (editing ? '저장' : '등록')}
          </button>
        </div>
      </div>
    </div>
  )
}

const inp = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-400 dark:border-gray-700 dark:bg-gray-800 dark:text-white'

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <label className="mb-1 block text-[11px] font-bold text-gray-600 dark:text-gray-400">{label}</label>
      {children}
    </div>
  )
}

function Info({ label, v, accent }: { label: string; v: number; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-blue-700/70 dark:text-blue-300/70">{label}</div>
      <div className={`font-mono font-bold ${accent ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-white'}`}>{fmtComma(v)}<span className="ml-0.5 text-[10px] font-normal text-gray-400">원</span></div>
    </div>
  )
}
