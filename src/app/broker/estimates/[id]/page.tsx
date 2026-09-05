'use client'

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/lib/auth-context'
import { Header } from '@/components/layout/header'
import { useToast } from '@/components/toast'
import {
  ArrowLeft, Save, Download, Mail, RefreshCw, Settings, Building2,
  CheckCircle2, XCircle, Lock, CopyPlus,
} from 'lucide-react'
import {
  calcTotals, calcMargin, fmtComma, koreanAmount, revisionNo, validUntil, STATUS_LABEL,
  type CatalogItem, type Estimate, type EstimateCompany, type EstimateClient,
  type EstimateItem, type EstimateStatus, type VatMode,
  todayKST,
} from '@/lib/estimate'
import { ItemsEditor } from './items-editor'
import { SendMailDialog } from './send-dialog'
import { InvoicesPanel } from './invoices-panel'
import { SharePanel } from './share-panel'

interface TemplateRow { id: string; name: string; items: EstimateItem[] }
interface SendRow { id: string; to_email: string; ok: boolean; error: string | null; sent_at: string }

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
  const [sends, setSends] = useState<SendRow[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [mailOpen, setMailOpen] = useState(false)
  // 미리보기는 저장과 분리한다 — 입력을 멈추면 화면 값 그대로 다시 그린다
  const [previewSrc, setPreviewSrc] = useState('')
  const [previewing, setPreviewing] = useState(false)

  const set = <K extends keyof Estimate>(k: K, v: Estimate[K]) => {
    setEst(prev => prev ? { ...prev, [k]: v } : prev)
    setDirty(true)
  }

  const load = useCallback(async () => {
    if (!brokerId) return
    setLoading(true)
    const [e, it, co, cl, tp, sd, cat] = await Promise.all([
      supabase.from('estimates').select('*').eq('id', id).maybeSingle(),
      supabase.from('estimate_items').select('*').eq('estimate_id', id).order('sort_order'),
      supabase.from('estimate_companies').select('*').eq('owner_broker_id', brokerId).order('is_default', { ascending: false }).order('sort_order'),
      supabase.from('estimate_clients').select('*').eq('owner_broker_id', brokerId).order('name'),
      supabase.from('estimate_templates').select('id,name,items').eq('owner_broker_id', brokerId).order('sort_order'),
      supabase.from('estimate_sends').select('id,to_email,ok,error,sent_at').eq('estimate_id', id).order('sent_at', { ascending: false }),
      supabase.from('estimate_item_catalog')
        .select('id,category,name,spec,unit,unit_price,cost_price,use_count')
        .eq('owner_broker_id', brokerId).order('use_count', { ascending: false }).limit(500),
    ])
    setEst((e.data as Estimate) ?? null)
    setItems((it.data as EstimateItem[]) ?? [])
    setCompanies((co.data as EstimateCompany[]) ?? [])
    setClients((cl.data as EstimateClient[]) ?? [])
    setTemplates((tp.data as TemplateRow[]) ?? [])
    setSends((sd.data as SendRow[]) ?? [])
    setCatalog((cat.data as CatalogItem[]) ?? [])
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

  const margin = useMemo(() => calcMargin(items, totals.supply_amount), [items, totals.supply_amount])

  /**
   * 견적서를 저장할 때 거래처도 같이 쌓는다.
   * 품목은 자동으로 쌓이는데 거래처만 손으로 눌러야 해서 매번 잊게 된다.
   * 이미 같은 이름이 있으면 그 거래처에 이어 붙인다(중복으로 늘어나지 않게).
   * 확정된 client_id 를 돌려주어 견적서 저장에 함께 반영한다.
   */
  const syncClient = useCallback(async (): Promise<string | null> => {
    const name = est?.client_name?.trim()
    if (!brokerId || !name) return est?.client_id ?? null

    // 새로 만들 때만 견적서 내용을 그대로 옮긴다.
    // 주소는 이때만 넣는다 — 새 거래처는 이것 말고 단서가 없다.
    const payload = {
      owner_broker_id: brokerId,
      name,
      contact_name: est?.client_contact?.trim() || null,
      phone: est?.client_phone?.trim() || null,
      email: est?.client_email?.trim() || null,
      address: est?.site_address?.trim() || null,
    }

    // 이미 있는 거래처는 덮어쓰지 않고 채워 넣은 칸만 갱신한다.
    // 저장할 때마다 자동으로 도는 자리라, 견적서에서 담당자·연락처를 비워 뒀다는
    // 이유로 거래처에 적어 둔 정보가 소리 없이 지워지면 안 된다.
    // 주소는 아예 손대지 않는다 — 견적서의 주소는 현장 주소이지 거래처 주소가 아니라
    // 두 번째 현장 견적을 쓰면 첫 현장 주소로 덮여 버린다.
    const patch: Record<string, string> = {}
    if (est?.client_contact?.trim()) patch.contact_name = est.client_contact.trim()
    if (est?.client_phone?.trim()) patch.phone = est.client_phone.trim()
    if (est?.client_email?.trim()) patch.email = est.client_email.trim()

    let id = est?.client_id ?? null
    if (!id) {
      // 같은 이름이 여러 건일 수 있어(손으로 만들어 둔 것이 섞이면) 가장 먼저 만든 것에 붙인다.
      // maybeSingle 은 2건 이상이면 오류를 내서, 그때마다 거래처가 새로 생겨 버린다.
      const { data: exist } = await supabase.from('estimate_clients')
        .select('id').eq('owner_broker_id', brokerId).eq('name', name)
        .order('created_at').limit(1)
      id = exist?.[0]?.id ?? null
    }

    // 갱신할 내용이 없으면 그냥 둔다 (빈 update 는 오류가 난다)
    if (id && Object.keys(patch).length === 0) return id

    const res = id
      ? await supabase.from('estimate_clients').update(patch).eq('id', id).select('*').single()
      : await supabase.from('estimate_clients').insert(payload).select('*').single()
    if (res.error) return id ?? est?.client_id ?? null

    const saved = res.data as EstimateClient
    setClients(prev => [...prev.filter(c => c.id !== saved.id), saved]
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')))
    return saved.id
  }, [brokerId, est, supabase])

  /**
   * 저장할 때 이번 내역을 품목 사전에 반영한다.
   * 이미 있는 품목이면 단가·원가를 최신으로 갱신하고 사용 횟수를 올린다.
   * (사전은 편의 기능이라 실패해도 저장 자체는 성공으로 둔다)
   */
  const syncCatalog = useCallback(async () => {
    if (!brokerId) return
    const rows = items
      .filter(it => !it.is_header && it.name?.trim())
      .map(it => ({
        category: it.category, name: it.name, spec: it.spec, unit: it.unit,
        unit_price: it.unit_price, cost_price: it.cost_price,
      }))
    if (rows.length === 0) return

    // 같은 품목(품명+규격+단위)은 한 건으로 묶고 사용 횟수를 올린다 (서버에서 처리)
    const { error } = await supabase.rpc('sync_estimate_catalog', { p_items: rows })
    if (error) console.error('[품목 사전] 반영 실패', error)
  }, [brokerId, items, supabase])

  const save = useCallback(async (silent = false) => {
    if (!est || !brokerId || saving) return false
    setSaving(true)
    try {
      const company = companies.find(c => c.id === est.company_id) ?? null
      const clientId = await syncClient()

      const { error: e1 } = await supabase.from('estimates').update({
        company_id: est.company_id,
        client_id: clientId,
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
        total_cost: margin?.cost ?? 0,
      }).eq('id', est.id)
      if (e1) throw e1

      // 내역은 통째로 갈아끼운다 (줄 순서·추가·삭제가 잦아 diff보다 단순하고 안전).
      // 지우기와 넣기를 따로 보내면, 지우고 나서 넣기가 실패했을 때(연결이 끊기는 등)
      // 내역이 통째로 사라진다. 한 트랜잭션으로 묶은 RPC 로 보내 둘 다 되거나
      // 둘 다 안 되게 한다.
      const { error: e2 } = await supabase.rpc('replace_estimate_items', {
        p_estimate_id: est.id,
        p_items: items.map((it, i) => ({
          sort_order: i,
          is_header: it.is_header,
          category: it.category, name: it.name, spec: it.spec, unit: it.unit,
          qty: it.qty, unit_price: it.unit_price, cost_price: it.cost_price,
          amount: it.amount, remark: it.remark,
        })),
      })
      if (e2) throw e2

      await syncCatalog()
      if (clientId && clientId !== est.client_id) setEst(prev => prev ? { ...prev, client_id: clientId } : prev)

      setDirty(false)
      if (!silent) toast.success('저장했습니다')
      return true
    } catch {
      toast.error('저장하지 못했습니다')
      return false
    } finally {
      setSaving(false)
    }
  }, [est, brokerId, saving, companies, items, totals, margin, syncCatalog, syncClient, supabase, toast])

  /** 화면 값 그대로 PDF 를 받아 미리보기에 건다 (DB 는 건드리지 않는다) */
  const previewSeq = useRef(0)
  const renderPreview = useCallback(async () => {
    if (!est) return
    // 렌더가 느릴 때 다음 요청이 먼저 끝나면, 늦게 온 예전 PDF 가 최신 미리보기를
    // 덮어써 화면과 다른 내용이 남는다. 마지막에 보낸 것만 반영한다.
    const seq = ++previewSeq.current
    setPreviewing(true)
    try {
      const company = companies.find(c => c.id === est.company_id) ?? est.company_snapshot ?? null
      const res = await fetch('/api/estimates/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimate: { ...est, ...totals }, items, company }),
      })
      if (!res.ok) return
      const blob = await res.blob()
      if (seq !== previewSeq.current) return
      setPreviewSrc(prev => {
        if (prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
    } catch {
      // 미리보기는 보조 기능이라 실패해도 조용히 둔다 (저장·발송에는 영향 없음)
    } finally {
      if (seq === previewSeq.current) setPreviewing(false)
    }
  }, [est, items, totals, companies])

  // 입력을 멈추고 1.5초 뒤 한 번만 다시 그린다
  useEffect(() => {
    if (!est) return
    const t = setTimeout(renderPreview, 1500)
    return () => clearTimeout(t)
  }, [est, items, renderPreview])

  // 페이지를 떠날 때 마지막 blob 을 놓아준다.
  // setPreviewSrc 로는 안 된다 — 화면이 사라진 뒤의 setState 는 무시되어
  // 넘긴 함수가 아예 실행되지 않는다(그래서 마지막 하나가 계속 남아 있었다).
  const previewRef = useRef('')
  useEffect(() => { previewRef.current = previewSrc }, [previewSrc])
  useEffect(() => () => {
    if (previewRef.current.startsWith('blob:')) URL.revokeObjectURL(previewRef.current)
  }, [])

  // Ctrl+S 저장
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [save])

  /**
   * 수주로 바꾸면 착공·준공을 일정에 넣어준다.
   * 공사기간을 "2026-09-10 ~ 2026-10-10" 처럼 날짜로 적었을 때만 동작한다 —
   * "착공일로부터 30일" 같은 문장은 날짜를 알 수 없으므로 건너뛴다.
   */
  const addToSchedule = useCallback(async (e: Estimate) => {
    if (!brokerId) return
    const dates = (e.period ?? '').match(/\d{4}-\d{2}-\d{2}/g)
    if (!dates?.length) {
      // 조용히 지나가면 왜 일정이 안 생겼는지 알 수 없다
      toast.info('공사기간을 날짜로 적으면 일정관리에도 자동으로 들어갑니다')
      return
    }

    const title = `[공사] ${e.project_name || e.client_name || e.estimate_no}`
    // 이미 넣어 둔 같은 일정이 있으면 다시 만들지 않는다
    const { data: dup } = await supabase.from('office_events')
      .select('id').eq('office_broker_id', brokerId).eq('title', title).limit(1)
    if (dup?.length) { toast.info('이미 일정에 들어가 있습니다'); return }

    const { error } = await supabase.from('office_events').insert({
      office_broker_id: brokerId,
      created_by: brokerId,
      title,
      description: [e.client_name, e.site_address].filter(Boolean).join(' · ') || null,
      starts_at: new Date(`${dates[0]}T09:00:00+09:00`).toISOString(),
      ends_at: dates[1] ? new Date(`${dates[1]}T18:00:00+09:00`).toISOString() : null,
      all_day: true,
      visibility: 'office',
      location: e.site_address ?? null,
    })
    if (error) { toast.error('일정에 넣지 못했습니다'); return }
    toast.success('착공·준공을 일정에 넣었습니다')
  }, [brokerId, supabase, toast])

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

  /**
   * 수정 견적(리비전) — 값을 깎아 다시 보낼 때 쓴다.
   * 원본은 그대로 두고 -r2 로 새 견적을 만들되 뿌리를 이어 둔다.
   */
  const createRevision = async () => {
    if (!est || !brokerId) return
    if (dirty && !(await save(true))) return

    const root = est.root_estimate_id ?? est.id
    // 같은 뿌리에서 가장 큰 리비전 다음 번호
    const { data: sib } = await supabase
      .from('estimates').select('revision')
      .or(`id.eq.${root},root_estimate_id.eq.${root}`)
      .order('revision', { ascending: false }).limit(1)
    const nextRev = ((sib?.[0]?.revision as number) ?? 1) + 1

    const baseNo = est.estimate_no.replace(/-r\d+$/, '')
    const { id: _i, created_at: _c, sent_at: _s, ...rest } = est
    const { data, error } = await supabase.from('estimates').insert({
      ...rest,
      owner_broker_id: brokerId,
      root_estimate_id: root,
      revision: nextRev,
      estimate_no: revisionNo(baseNo, nextRev),
      issue_date: todayKST(),
      status: 'draft',
      sent_at: null,
    }).select('id').single()
    if (error) { toast.error('수정 견적을 만들지 못했습니다'); return }

    if (items.length) {
      await supabase.from('estimate_items').insert(
        items.map((it, i) => ({
          estimate_id: data.id, sort_order: i, is_header: it.is_header,
          category: it.category, name: it.name, spec: it.spec, unit: it.unit,
          qty: it.qty, unit_price: it.unit_price, cost_price: it.cost_price,
          amount: it.amount, remark: it.remark,
        }))
      )
    }
    toast.success(`수정 견적 r${nextRev} 를 만들었습니다`)
    router.push(`/broker/estimates/${data.id}`)
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
        <h1 className="sr-only">견적서</h1>
        <div className="px-4 py-8 text-center text-sm text-gray-500">불러오는 중…</div>
      </div>
    )
  }

  if (!est) {
    return (
      <div className="bg-gray-50 dark:bg-gray-950">
        <Header />
        <h1 className="sr-only">견적서</h1>
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
          {(est.revision ?? 1) > 1 && (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-bold text-violet-700 dark:bg-violet-500/20 dark:text-violet-300">
              수정 {est.revision}차
            </span>
          )}
          {dirty && <span className="text-xs font-semibold text-amber-600">저장 안 된 변경</span>}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={est.status}
              onChange={e => {
                const next = e.target.value as EstimateStatus
                set('status', next)
                if (next === 'won' && est.status !== 'won') addToSchedule({ ...est, status: next })
              }}
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
            <button onClick={createRevision} disabled={saving} title="값을 조정해 다시 보낼 때"
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              <CopyPlus className="h-4 w-4" />수정 견적
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
                <Link href="/broker/estimates/settings" className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600">
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
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  저장하면 거래처 목록에도 쌓입니다
                </span>
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
                    placeholder="예: 2026-10-01 ~ 2026-10-31" className={FIELD} />
                  <p className="mt-1 text-xs text-gray-500">
                    날짜로 적으면 수주로 바꿀 때 착공·준공이 일정관리에 자동 등록됩니다.
                  </p>
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
              <ItemsEditor items={items} catalog={catalog} onChange={v => { setItems(v); setDirty(true) }} />
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

                  {/* 할인에 0을 하나 더 치면 합계가 음수가 된다. 그대로 내보내면
                      거래처가 마이너스 견적서를 받으므로 눈에 띄게 알린다. */}
                  {totals.supply_amount < 0 && (
                    <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 dark:bg-red-500/10 dark:text-red-300">
                      할인이 소계보다 커서 합계가 마이너스입니다. 할인 금액을 확인하세요.
                    </p>
                  )}

                  {margin && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                      <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-400">
                        <Lock className="h-3 w-3" />내부용 · 견적서에는 나가지 않습니다
                      </div>
                      <Row label="원가 합계" value={margin.cost} />
                      <div className="flex items-center justify-between py-1">
                        <span className="text-gray-600 dark:text-gray-400">예상 이익</span>
                        <span className={`font-bold ${margin.profit < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                          {fmtComma(margin.profit)}
                          {margin.rate != null && (
                            <span className="ml-1 text-xs font-semibold">
                              ({(margin.rate * 100).toFixed(1)}%)
                            </span>
                          )}
                        </span>
                      </div>
                      {margin.profit < 0 && (
                        <p className="text-xs font-semibold text-red-600">원가가 견적가를 넘습니다.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <label className={LABEL} htmlFor="f-notes">특기사항 (견적서 하단에 표기)</label>
                <textarea id="f-notes" rows={5} value={est.notes ?? ''} onChange={e => set('notes', e.target.value)}
                  placeholder={'예)\n- 상기 금액은 부가세 별도입니다.\n- 자재 변경 시 단가가 조정될 수 있습니다.\n- 폐기물 처리비는 견적에 포함되어 있습니다.'}
                  className={`${FIELD} resize-y font-mono text-xs leading-relaxed`} />
                <p className="mt-1 text-xs text-gray-500">
                  유효기간: {est.issue_date} ~ {validUntil(est.issue_date, est.valid_days)}
                </p>
              </div>
            </section>
            <SharePanel estimateId={est.id} brokerId={brokerId!} />

            <InvoicesPanel estimate={{ ...est, ...totals }} brokerId={brokerId!} />
          </div>

          {/* ── 오른쪽: 실제 PDF 미리보기 ────────────────── */}
          <div className="xl:sticky xl:top-20 xl:self-start">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">미리보기</h2>
              <button
                onClick={renderPreview}
                disabled={previewing}
                className="flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-blue-600 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${previewing ? 'animate-spin' : ''}`} />
                {previewing ? '그리는 중…' : '새로고침'}
              </button>
            </div>
            {previewSrc ? (
              <iframe
                src={previewSrc}
                title="견적서 미리보기"
                className="h-[40rem] w-full rounded-xl border border-gray-200 bg-white dark:border-gray-800"
              />
            ) : (
              <div className="flex h-[40rem] w-full items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-500 dark:border-gray-800 dark:bg-gray-900">
                미리보기를 그리는 중…
              </div>
            )}
            <p className="mt-2 text-xs text-gray-500">
              실제로 발송될 PDF 그대로입니다. 입력을 멈추면 알아서 다시 그립니다.
            </p>

            {sends.length > 0 && (
              <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-2 text-sm font-bold text-gray-900 dark:text-white">발송 이력</h2>
                <ul className="space-y-2">
                  {sends.map(s => (
                    <li key={s.id} className="flex items-start gap-2 text-xs">
                      {s.ok
                        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-semibold text-gray-700 dark:text-gray-300">{s.to_email}</span>
                          <span className="text-gray-500">
                            {new Date(s.sent_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}
                          </span>
                        </div>
                        {!s.ok && s.error && (
                          <p className="mt-0.5 break-words text-red-500">{s.error}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {mailOpen && (
        <SendMailDialog
          estimate={{ ...est, ...totals }}
          onClose={() => setMailOpen(false)}
          onSent={() => {
            setMailOpen(false)
            // 수주·실주로 결론난 건은 다시 보내도 그대로 둔다 (서버도 같은 규칙)
            if (est.status !== 'won' && est.status !== 'lost') set('status', 'sent')
            load()
          }}
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
