'use client'

/**
 * 견적서에 딸린 청구서 목록 + 발행.
 * 수주한 공사를 계약금·중도금·잔금으로 나눠 청구하는 흐름이라, 견적서 화면 안에 둔다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { Plus, Download, Trash2, X, ReceiptText, CheckCircle2 } from 'lucide-react'
import {
  fmtComma, invoiceAmounts, INVOICE_KIND_LABEL, INVOICE_KIND_RATIO,
  type Estimate, type EstimateInvoice, type InvoiceKind,
} from '@/lib/estimate'

const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white'
const LABEL = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400'

/** 오늘부터 n일 뒤 (입금기한 기본값) */
function daysLater(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function InvoicesPanel({ estimate, brokerId }: { estimate: Estimate; brokerId: string }) {
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<EstimateInvoice[]>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [kind, setKind] = useState<InvoiceKind>('deposit')
  const [ratioPct, setRatioPct] = useState(30)
  const [dueDate, setDueDate] = useState(daysLater(7))
  const [notes, setNotes] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase.from('estimate_invoices')
      .select('*').eq('estimate_id', estimate.id).order('issue_date').order('created_at')
    setRows((data as EstimateInvoice[]) ?? [])
  }, [estimate.id, supabase])

  useEffect(() => { load() }, [load])

  const billed = rows.reduce((s, r) => s + (r.supply_amount || 0), 0)
  const remain = estimate.supply_amount - billed
  const preview = invoiceAmounts(estimate.supply_amount, ratioPct / 100, estimate.vat_mode)

  const pickKind = (k: InvoiceKind) => {
    setKind(k)
    setRatioPct(Math.round(INVOICE_KIND_RATIO[k] * 100))
  }

  const issue = async () => {
    if (preview.supply_amount <= 0) { toast.error('청구 금액이 0원입니다'); return }

    // 계약금·중도금·잔금을 떼다 보면 이미 다 청구한 걸 잊고 한 장을 더 뗀다.
    // 막지는 않는다 — 추가 공사로 견적보다 더 받는 일이 실제로 있다. 다만
    // 넘어간다는 사실을 짚어 주고 한 번 확인받는다.
    const willBe = billed + preview.supply_amount
    if (willBe > estimate.supply_amount) {
      const over = willBe - estimate.supply_amount
      const ok = confirm(
        `견적 금액보다 ${fmtComma(over)}원 더 청구하게 됩니다.\n`
        + `(견적 ${fmtComma(estimate.supply_amount)}원 · 이미 청구 ${fmtComma(billed)}원 `
        + `· 이번 ${fmtComma(preview.supply_amount)}원)\n\n그대로 발행할까요?`
      )
      if (!ok) return
    }

    setSaving(true)
    try {
      const { data: noData, error: noErr } = await supabase.rpc('next_invoice_no', { p_owner: brokerId })
      if (noErr) throw noErr

      const { error } = await supabase.from('estimate_invoices').insert({
        owner_broker_id: brokerId,
        estimate_id: estimate.id,
        invoice_no: noData as string,
        kind,
        ratio: ratioPct / 100,
        company_snapshot: estimate.company_snapshot,
        client_name: estimate.client_name,
        client_contact: estimate.client_contact,
        client_phone: estimate.client_phone,
        client_email: estimate.client_email,
        site_address: estimate.site_address,
        project_name: estimate.project_name,
        vat_mode: estimate.vat_mode,
        ...preview,
        due_date: dueDate || null,
        notes: notes.trim() || null,
      })
      if (error) throw error
      toast.success('청구서를 발행했습니다')
      setOpen(false)
      setNotes('')
      load()
    } catch {
      toast.error('청구서를 발행하지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  const togglePaid = async (row: EstimateInvoice) => {
    const paid_at = row.paid_at ? null : new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('estimate_invoices').update({ paid_at }).eq('id', row.id)
    if (error) { toast.error('바꾸지 못했습니다'); return }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, paid_at } : r))
  }

  const remove = async (row: EstimateInvoice) => {
    if (!confirm(`청구서 ${row.invoice_no} 를 삭제할까요?`)) return
    const { error } = await supabase.from('estimate_invoices').delete().eq('id', row.id)
    if (error) { toast.error('삭제하지 못했습니다'); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  return (
    <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-white">
          <ReceiptText className="h-4 w-4 text-gray-500" />청구서
        </h2>
        <button onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <Plus className="h-4 w-4" />청구서 발행
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-500">
          아직 발행한 청구서가 없습니다. 수주한 공사를 계약금·중도금·잔금으로 나눠 청구할 수 있습니다.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="border-b border-gray-100 text-xs text-gray-500 dark:border-gray-800">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">청구번호</th>
                  <th className="px-2 py-2 text-left font-semibold">구분</th>
                  <th className="px-2 py-2 text-left font-semibold">기한</th>
                  <th className="px-2 py-2 text-right font-semibold">금액</th>
                  <th className="px-2 py-2 text-center font-semibold">입금</th>
                  <th className="px-2 py-2 text-center font-semibold">관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 dark:border-gray-800/50">
                    <td className="px-2 py-2.5 font-mono text-xs font-semibold text-gray-700 dark:text-gray-300">{r.invoice_no}</td>
                    <td className="px-2 py-2.5 text-gray-700 dark:text-gray-300">
                      {INVOICE_KIND_LABEL[r.kind]}
                      {r.ratio != null && <span className="ml-1 text-xs text-gray-500">{Math.round(r.ratio * 100)}%</span>}
                    </td>
                    <td className="px-2 py-2.5 text-gray-500">{r.due_date ?? '—'}</td>
                    <td className="px-2 py-2.5 text-right font-bold text-gray-900 dark:text-white">{fmtComma(r.total)}</td>
                    <td className="px-2 py-2.5 text-center">
                      <button onClick={() => togglePaid(r)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                          r.paid_at
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                        }`}>
                        {r.paid_at ? <><CheckCircle2 className="h-3 w-3" />{r.paid_at}</> : '미입금'}
                      </button>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => window.open(`/api/estimates/invoices/${r.id}/pdf`, '_blank')}
                          title="PDF" aria-label="청구서 PDF"
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800">
                          <Download className="h-4 w-4" />
                        </button>
                        <button onClick={() => remove(r)} title="삭제" aria-label="청구서 삭제"
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex justify-end gap-4 text-xs">
            <span className="text-gray-500">청구 합계 <b className="text-gray-800 dark:text-gray-200">{fmtComma(billed)}</b></span>
            <span className={remain < 0 ? 'text-red-600' : 'text-gray-500'}>
              남은 금액 <b className={remain < 0 ? 'text-red-600' : 'text-gray-800 dark:text-gray-200'}>{fmtComma(remain)}</b>
              {remain < 0 && ' (초과)'}
            </span>
          </div>
        </>
      )}

      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-gray-900 sm:rounded-2xl">
            <div className="mb-4 flex items-center">
              <h2 className="text-base font-black text-gray-900 dark:text-white">청구서 발행</h2>
              <button onClick={() => setOpen(false)} aria-label="닫기" className="ml-auto rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-3">
              <span className={LABEL}>청구 구분</span>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(INVOICE_KIND_LABEL) as InvoiceKind[]).map(k => (
                  <button key={k} onClick={() => pickKind(k)}
                    className={`rounded-lg px-3 py-2 text-sm font-bold transition-colors ${
                      kind === k
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400'
                    }`}>
                    {INVOICE_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="iv-ratio">비율 (%)</label>
                <input id="iv-ratio" type="number" min={0} max={100} value={ratioPct}
                  onChange={e => setRatioPct(Number(e.target.value))} className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="iv-due">입금기한</label>
                <input id="iv-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={FIELD} />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="iv-notes">비고</label>
                <input id="iv-notes" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="예: 착공 전 입금 부탁드립니다" className={FIELD} />
              </div>
            </div>

            <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-950/50">
              <div className="flex items-center justify-between py-1">
                <span className="text-gray-500">공급가액</span>
                <span className="font-semibold">{fmtComma(preview.supply_amount)}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-gray-500">부가세</span>
                <span className="font-semibold">{fmtComma(preview.vat)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-gray-200 pt-2 dark:border-gray-800">
                <span className="font-bold text-gray-900 dark:text-white">청구 금액</span>
                <span className="text-lg font-black text-blue-700 dark:text-blue-300">{fmtComma(preview.total)}원</span>
              </div>
              {billed > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  이미 청구한 금액 {fmtComma(billed)} · 이번 건 포함 {fmtComma(billed + preview.supply_amount)}
                  {billed + preview.supply_amount > estimate.supply_amount && (
                    <b className="ml-1 text-red-600">계약 금액을 넘습니다</b>
                  )}
                </p>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setOpen(false)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                취소
              </button>
              <button onClick={issue} disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                발행
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
