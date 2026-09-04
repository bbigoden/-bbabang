'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import {
  ArrowLeft, Save, Download, Mail, RefreshCw, Settings, Building2,
} from 'lucide-react'
import {
  calcTotals, fmtComma, koreanAmount, validUntil, STATUS_LABEL,
  type Estimate, type EstimateCompany, type EstimateClient,
  type EstimateItem, type EstimateStatus, type VatMode,
} from '@/lib/estimate'
import { ItemsEditor } from './items-editor'
import { SendMailDialog } from './send-dialog'

interface TemplateRow { id: string; name: string; items: EstimateItem[] }

const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white'
const LABEL = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400'

export default function EstimateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const { broker, loading: authLoading } = useAuth()
  const brokerId = broker?.id ?? null

  const [est, setEst] = useState<Estimate | null>(null)
  const [items, setItems] = useState<EstimateItem[]>([])
  const [companies, setCompanies] = useState<EstimateCompany[]>([])
  const [clients, setClients] = useState<EstimateClient[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [mailOpen, setMailOpen] = useState(false)
  const [previewKey, setPreviewKey] = useState(0)

  const set = <K extends keyof Estimate>(k: K, v: Estimate[K]) => {
    setEst(prev => prev ? { ...prev, [k]: v } : prev)
    setDirty(true)
  }

  const load = useCallback(async () => {
    if (!brokerId) return
    setLoading(true)
    const [e, it, co, cl, tp] = await Promise.all([
      supabase.from('estimates').select('*').eq('id', id).maybeSingle(),
      supabase.from('estimate_items').select('*').eq('estimate_id', id).order('sort_order'),
      supabase.from('estimate_companies').select('*').eq('owner_broker_id', brokerId).order('is_default', { ascending: false }).order('sort_order'),
      supabase.from('estimate_clients').select('*').eq('owner_broker_id', brokerId).order('name'),
      supabase.from('estimate_templates').select('id,name,items').eq('owner_broker_id', brokerId).order('sort_order'),
    ])
    setEst((e.data as Estimate) ?? null)
    setItems((it.data as EstimateItem[]) ?? [])
    setCompanies((co.data as EstimateCompany[]) ?? [])
    setClients((cl.data as EstimateClient[]) ?? [])
    setTemplates((tp.data as TemplateRow[]) ?? [])
    setLoading(false)
    setDirty(false)
  }, [brokerId, id, supabase])

  useEffect(() => { if (brokerId) load() }, [brokerId, load])

  // 이탈 경고 (저장 안 한 변경이 있을 때)
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const totals = useMemo(
    () => calcTotals(items, {
      overhead_rate: est?.overhead_rate ?? 0,
      discount: est?.discount ?? 0,
      vat_mode: est?.vat_mode ?? 'add',
    }),
    [items, est?.overhead_rate, est?.discount, est?.vat_mode]
  )

  const save = useCallback(async (silent = false) => {
    if (!est || !brokerId || saving) return false
    setSaving(true)
    try {
      const company = companies.find(c => c.id === est.company_id) ?? null

      const { error: e1 } = await supabase.from('estimates').update({
        company_id: est.company_id,
        client_id: est.client_id,
        estimate_no: est.estimate_no,
        issue_date: est.issue_date,
        company_snapshot: company,
        client_name: est.client_name,
        client_contact: est.client_contact,
        client_phone: est.client_phone,
        client_email: est.client_email,
        site_address: est.site_address,
        project_name: est.project_name,
        period: est.period,
        valid_days: est.valid_days,
        payment_terms: est.payment_terms,
        notes: est.notes,
        overhead_rate: est.overhead_rate,
        discount: est.discount,
        vat_mode: est.vat_mode,
        status: est.status,
        ...totals,
      }).eq('id', est.id)
      if (e1) throw e1

      // 내역은 통째로 갈아끼운다 (줄 순서·추가·삭제가 잦아 diff보다 단순하고 안전)
      const { error: e2 } = await supabase.from('estimate_items').delete().eq('estimate_id', est.id)
      if (e2) throw e2
      if (items.length) {
        const { error: e3 } = await supabase.from('estimate_items').insert(
          items.map((it, i) => ({
            estimate_id: est.id,
            sort_order: i,
            is_header: it.is_header,
            category: it.category, name: it.name, spec: it.spec, unit: it.unit,
            qty: it.qty, unit_price: it.unit_price, amount: it.amount, remark: it.remark,
          }))
        )
        if (e3) throw e3
      }

      setDirty(false)
      setPreviewKey(k => k + 1)
      if (!silent) toast.success('저장했습니다')
      return true
    } catch {
      toast.error('저장하지 못했습니다')
      return false
    } finally {
      setSaving(false)
    }
  }, [est, brokerId, saving, companies, items, totals, supabase, toast])

  // Ctrl+S 저장
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [save])

  const pickCompany = (companyId: string) => {
    const c = companies.find(x => x.id === companyId)
    setEst(prev => prev ? {
      ...prev,
      company_id: companyId || null,
      notes: prev.notes || c?.default_notes || null,
    } : prev)
    setDirty(true)
  }

  const pickClient = (clientId: string) => {
    const c = clients.find(x => x.id === clientId)
    setEst(prev => prev ? {
      ...prev,
      client_id: clientId || null,
      client_name: c?.name ?? prev.client_name,
      client_contact: c?.contact_name ?? prev.client_contact,
      client_phone: c?.phone ?? prev.client_phone,
      client_email: c?.email ?? prev.client_email,
      site_address: c?.address ?? prev.site_address,
    } : prev)
    setDirty(true)
  }

  /** 지금 입력된 거래처 정보를 거래처 목록에 저장 (다음부터 골라 쓰기) */
  const saveClient = async () => {
    if (!est?.client_name?.trim() || !brokerId) { toast.error('거래처명을 먼저 입력하세요'); return }
    const payload = {
      owner_broker_id: brokerId,
      name: est.client_name.trim(),
      contact_name: est.client_contact,
      phone: est.client_phone,
      email: est.client_email,
      address: est.site_address,
    }
    const res = est.client_id
      ? await supabase.from('estimate_clients').update(payload).eq('id', est.client_id).select('*').single()
      : await supabase.from('estimate_clients').insert(payload).select('*').single()
    if (res.error) { toast.error('거래처를 저장하지 못했습니다'); return }
    const saved = res.data as EstimateClient
    setClients(prev => {
      const rest = prev.filter(c => c.id !== saved.id)
      return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    })
    set('client_id', saved.id)
    toast.success('거래처를 저장했습니다')
  }

  const applyTemplate = (tplId: string) => {
    const tpl = templates.find(t => t.id === tplId)
    if (!tpl) return
    if (items.length && !confirm(`현재 내역 ${items.length}줄을 "${tpl.name}" 프리셋으로 바꿀까요?`)) return
    setItems(tpl.items.map((it, i) => ({ ...it, sort_order: i })))
    setDirty(true)
  }

  /** 지금 내역을 프리셋으로 저장 — 같은 이름이 있으면 덮어쓴다 */
  const saveAsTemplate = async () => {
    if (!brokerId) return
    if (items.length === 0) { toast.error('저장할 내역이 없습니다'); return }
    const name = prompt('프리셋 이름', est?.project_name || '')?.trim()
    if (!name) return

    const existing = templates.find(t => t.name === name)
    if (existing && !confirm(`"${name}" 프리셋을 지금 내역으로 덮어쓸까요?`)) return

    const payload = { owner_broker_id: brokerId, name, items }
    const res = existing
      ? await supabase.from('estimate_templates').update(payload).eq('id', existing.id).select('id,name,items').single()
      : await supabase.from('estimate_templates').insert({ ...payload, sort_order: templates.length }).select('id,name,items').single()
    if (res.error) { toast.error('프리셋을 저장하지 못했습니다'); return }

    const saved = res.data as TemplateRow
    setTemplates(prev => [...prev.filter(t => t.id !== saved.id), saved])
    toast.success(existing ? '프리셋을 덮어썼습니다' : '프리셋으로 저장했습니다')
  }

  const downloadPdf = async () => {
    if (dirty && !(await save(true))) return
    window.open(`/api/estimates/${id}/pdf`, '_blank')
  }

  const openMail = async () => {
    if (dirty && !(await save(true))) return
    setMailOpen(true)
  }

  if (authLoading || loading) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="px-4 py-8 text-center text-sm text-gray-500">불러오는 중…</div>
      </div>
    )
  }

  if (!est) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950">
        <Header />
        <div className="px-4 py-8 text-center text-sm text-gray-500">
          견적서를 찾을 수 없습니다. <Link href="/broker/estimates" className="text-blue-600 underline">목록으로</Link>
        </div>
      </div>
    )
  }

  const noCompany = companies.length === 0

  return (
    <div className="bg-gray-50 dark:bg-gray-950 overflow-x-hidden">
      <Header />

      <div className="px-4 py-6">
        {/* 상단 바 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button onClick={() => router.push('/broker/estimates')} aria-label="목록으로" title="목록으로"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-black text-gray-900 dark:text-white">견적서</h1>
          <span className="rounded-lg bg-gray-100 px-2 py-1 font-mono text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {est.estimate_no}
          </span>
          {dirty && <span className="text-xs font-semibold text-amber-600">저장 안 된 변경</span>}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={est.status}
              onChange={e => set('status', e.target.value as EstimateStatus)}
              aria-label="견적 상태"
              className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm font-semibold dark:border-gray-800 dark:bg-gray-900 dark:text-white"
            >
              {(Object.keys(STATUS_LABEL) as EstimateStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <button onClick={() => save()} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <Save className="h-4 w-4" />저장
            </button>
            <button onClick={downloadPdf} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <Download className="h-4 w-4" />PDF
            </button>
            <button onClick={openMail} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
              <Mail className="h-4 w-4" />메일 발송
            </button>
          </div>
        </div>

        {noCompany && (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <Building2 className="h-5 w-5 shrink-0" />
            <span>발행할 회사가 아직 없습니다. 설정에서 회사(상호·사업자번호·직인)를 먼저 등록하세요.</span>
            <Link href="/broker/estimates/settings" className="ml-auto shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">
              설정으로
            </Link>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          {/* ── 왼쪽: 입력 ─────────────────────────────── */}
          <div className="space-y-4">
            {/* 발행 정보 */}
            <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">발행 정보</h2>
                <Link href="/broker/estimates/settings" className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600">
                  <Settings className="h-3.5 w-3.5" />회사 관리
                </Link>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className={LABEL} htmlFor="f-company">발행 명의</label>
                  <select id="f-company" value={est.company_id ?? ''} onChange={e => pickCompany(e.target.value)} className={FIELD}>
                    <option value="">선택하세요</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL} htmlFor="f-no">견적번호</label>
                  <input id="f-no" value={est.estimate_no} onChange={e => set('estimate_no', e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="f-date">발행일</label>
                  <input id="f-date" type="date" value={est.issue_date} onChange={e => set('issue_date', e.target.value)} className={FIELD} />
                </div>
              </div>
            </section>

            {/* 거래처 */}
            <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">거래처</h2>
                <button onClick={saveClient} className="text-xs font-semibold text-blue-600 hover:underline">
                  거래처 목록에 저장
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <label className={LABEL} htmlFor="f-client">저장된 거래처에서 불러오기</label>
                  <select id="f-client" value={est.client_id ?? ''} onChange={e => pickClient(e.target.value)} className={FIELD}>
                    <option value="">직접 입력</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.contact_name ? ` (${c.contact_name})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL} htmlFor="f-cname">상호·고객명</label>
                  <input id="f-cname" value={est.client_name ?? ''} onChange={e => set('client_name', e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="f-ccontact">담당자</label>
                  <input id="f-ccontact" value={est.client_contact ?? ''} onChange={e => set('client_contact', e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="f-cphone">연락처</label>
                  <input id="f-cphone" value={est.client_phone ?? ''} onChange={e => set('client_phone', e.target.value)} className={FIELD} />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL} htmlFor="f-cemail">이메일 (견적서 받을 주소)</label>
                  <input id="f-cemail" type="email" value={est.client_email ?? ''} onChange={e => set('client_email', e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="f-site">현장 주소</label>
                  <input id="f-site" value={est.site_address ?? ''} onChange={e => set('site_address', e.target.value)} className={FIELD} />
                </div>
              </div>
            </section>

            {/* 공사 개요 */}
            <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 text-sm font-bold text-gray-900 dark:text-white">공사 개요</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={LABEL} htmlFor="f-project">공사명</label>
                  <input id="f-project" value={est.project_name ?? ''} onChange={e => set('project_name', e.target.value)}
                    placeholder="예: 불당동 ○○상가 1층 인테리어 공사" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="f-period">공사기간</label>
                  <input id="f-period" value={est.period ?? ''} onChange={e => set('period', e.target.value)}
                    placeholder="예: 착공일로부터 30일" className={FIELD} />
                </div>
                <div>
                  <label className={LABEL} htmlFor="f-valid">견적 유효기간 (일)</label>
                  <input id="f-valid" type="number" value={est.valid_days} onChange={e => set('valid_days', Number(e.target.value))} className={FIELD} />
                </div>
                <div className="sm:col-span-2">
                  <label className={LABEL} htmlFor="f-pay">결제조건</label>
                  <input id="f-pay" value={est.payment_terms ?? ''} onChange={e => set('payment_terms', e.target.value)}
                    placeholder="예: 계약금 30% / 중도금 40% / 잔금 30%" className={FIELD} />
                </div>
              </div>
            </section>

            {/* 내역 */}
            <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">공사 내역</h2>
                <div className="flex items-center gap-2">
                  <button onClick={saveAsTemplate} className="text-xs font-semibold text-blue-600 hover:underline">
                    프리셋으로 저장
                  </button>
                  <select
                    value=""
                    onChange={e => { if (e.target.value) applyTemplate(e.target.value); e.target.value = '' }}
                    aria-label="프리셋 불러오기"
                    className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm dark:border-gray-800 dark:bg-gray-900 dark:text-white"
                  >
                    <option value="">프리셋 불러오기…</option>
                    {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <ItemsEditor items={items} onChange={v => { setItems(v); setDirty(true) }} />
            </section>

            {/* 정산 + 특기사항 */}
            <section className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 text-sm font-bold text-gray-900 dark:text-white">금액 정산</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <label className={LABEL} htmlFor="f-oh">경비(공과잡비) 비율 %</label>
                    <input id="f-oh" type="number" step="0.1" value={(est.overhead_rate * 100).toFixed(1)}
                      onChange={e => set('overhead_rate', Number(e.target.value) / 100)} className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="f-disc">할인액</label>
                    <input id="f-disc" type="number" value={est.discount || ''} onChange={e => set('discount', Number(e.target.value))} className={FIELD} />
                  </div>
                  <div>
                    <label className={LABEL} htmlFor="f-vat">부가세</label>
                    <select id="f-vat" value={est.vat_mode} onChange={e => set('vat_mode', e.target.value as VatMode)} className={FIELD}>
                      <option value="add">부가세 별도 (10% 가산)</option>
                      <option value="none">부가세 없음</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-950/50">
                  <Row label="소계" value={totals.subtotal} />
                  <Row label={`경비 (${(est.overhead_rate * 100).toFixed(1)}%)`} value={totals.overhead_amount} />
                  {est.discount > 0 && <Row label="할인" value={-est.discount} />}
                  <Row label="공급가액" value={totals.supply_amount} />
                  <Row label="부가세" value={totals.vat} />
                  <div className="mt-2 border-t border-gray-200 pt-2 dark:border-gray-800">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-900 dark:text-white">합계</span>
                      <span className="text-lg font-black text-blue-700 dark:text-blue-300">{fmtComma(totals.total)}원</span>
                    </div>
                    <p className="mt-1 text-right text-xs text-gray-500">{koreanAmount(totals.total)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <label className={LABEL} htmlFor="f-notes">특기사항 (견적서 하단에 표기)</label>
                <textarea id="f-notes" rows={5} value={est.notes ?? ''} onChange={e => set('notes', e.target.value)}
                  placeholder={'예)\n- 상기 금액은 부가세 별도입니다.\n- 자재 변경 시 단가가 조정될 수 있습니다.\n- 폐기물 처리비는 견적에 포함되어 있습니다.'}
                  className={`${FIELD} resize-y font-mono text-xs leading-relaxed`} />
                <p className="mt-1 text-xs text-gray-400">
                  유효기간: {est.issue_date} ~ {validUntil(est.issue_date, est.valid_days)}
                </p>
              </div>
            </section>
          </div>

          {/* ── 오른쪽: 실제 PDF 미리보기 ────────────────── */}
          <div className="xl:sticky xl:top-20 xl:self-start">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">미리보기</h2>
              <button
                onClick={async () => { if (dirty) await save(true); setPreviewKey(k => k + 1) }}
                className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-600"
              >
                <RefreshCw className="h-3.5 w-3.5" />새로고침
              </button>
            </div>
            <iframe
              key={previewKey}
              src={`/api/estimates/${id}/pdf?inline=1&v=${previewKey}`}
              title="견적서 미리보기"
              className="h-[40rem] w-full rounded-xl border border-gray-200 bg-white dark:border-gray-800"
            />
            <p className="mt-2 text-xs text-gray-400">
              실제로 발송될 PDF 그대로입니다. 저장하면 자동으로 갱신됩니다.
            </p>
          </div>
        </div>
      </div>

      {mailOpen && (
        <SendMailDialog
          estimate={{ ...est, ...totals }}
          onClose={() => setMailOpen(false)}
          onSent={() => { setMailOpen(false); set('status', 'sent'); load() }}
        />
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`font-semibold ${value < 0 ? 'text-red-600' : 'text-gray-800 dark:text-gray-200'}`}>
        {fmtComma(value)}
      </span>
    </div>
  )
}
