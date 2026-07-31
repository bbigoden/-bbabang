'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { FileText, X, Copy, Check, Eye, Clock3 } from 'lucide-react'

/**
 * 추천 매물 보고서 만들기 — 매물 검색·선택 → 공유 링크 생성 → 카톡 붙여넣기.
 * 고객이 여는 페이지는 /r/[id] (내부 정보 제외, 읽음 확인 기록).
 * 검색 UI는 일지 PropertyPicker와 같은 패턴 (office 스코프 서버 검색, 30건 상한).
 */

interface PickProperty {
  id: string
  seq_no: number | null
  address: string | null
  deal_type: string | null
  room_type: string | null
  price: number | null
  monthly_rent: number | null
}

interface RecentReport {
  id: string
  title: string
  created_at: string
  viewed_at: string | null
  view_count: number
  property_ids: string[]
}

const PICK_LIMIT = 30
const PICK_COLS = 'id, seq_no, address, deal_type, room_type, price, monthly_rent'

const fmtPrice = (p: PickProperty) => {
  if ((p.deal_type ?? '').includes('월세')) {
    return `${p.price != null ? p.price.toLocaleString() : '—'}/${p.monthly_rent != null ? p.monthly_rent.toLocaleString() : '—'}만`
  }
  return p.price != null ? `${p.price.toLocaleString()}만` : '—'
}

export function PropertyReportButton({ officeId, brokerId }: { officeId: string | null; brokerId: string | null }) {
  const [open, setOpen] = useState(false)
  if (!officeId || !brokerId) return null
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3.5 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <FileText className="h-4 w-4" />보고서
      </button>
      {open && <ReportModal officeId={officeId} brokerId={brokerId} onClose={() => setOpen(false)} />}
    </>
  )
}

function ReportModal({ officeId, brokerId, onClose }: { officeId: string; brokerId: string; onClose: () => void }) {
  const supabase = createClient()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<PickProperty[]>([])
  const [selected, setSelected] = useState<Map<string, PickProperty>>(new Map())
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdLink, setCreatedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [recent, setRecent] = useState<RecentReport[]>([])

  // 매물 서버 검색 (입력 멎고 250ms) — 일지 피커와 동일 패턴
  useEffect(() => {
    let alive = true
    const timer = setTimeout(async () => {
      let q = supabase.from('broker_properties').select(PICK_COLS).eq('office_broker_id', officeId)
      const term = search.trim()
      if (term) {
        const digits = term.replace(/[^0-9]/g, '')
        const conds = [`address.ilike.%${term}%`, `deal_type.ilike.%${term}%`, `room_type.ilike.%${term}%`]
        if (digits && digits.length <= 9) conds.push(`seq_no.eq.${digits}`)
        q = q.or(conds.join(','))
      }
      const { data } = await q.order('created_at', { ascending: false }).limit(PICK_LIMIT)
      if (alive) setRows((data ?? []) as PickProperty[])
    }, search ? 250 : 0)
    return () => { alive = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, officeId])

  // 최근 보낸 보고서 (읽음 확인)
  const loadRecent = async () => {
    const { data } = await supabase.from('shared_reports')
      .select('id, title, created_at, viewed_at, view_count, property_ids')
      .eq('office_broker_id', officeId)
      .order('created_at', { ascending: false }).limit(5)
    setRecent((data ?? []) as RecentReport[])
  }
  useEffect(() => { void loadRecent() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p: PickProperty) => {
    setSelected(prev => {
      const m = new Map(prev)
      if (m.has(p.id)) m.delete(p.id)
      else m.set(p.id, p)
      return m
    })
  }

  const linkFor = (id: string) => `${window.location.origin}/r/${id}`

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      toast.success('링크를 복사했어요. 카톡에 붙여넣으세요!')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('복사에 실패했어요. 링크를 길게 눌러 복사해주세요.')
    }
  }

  const create = async () => {
    if (selected.size === 0) { toast.error('매물을 먼저 선택해주세요.'); return }
    setCreating(true)
    const { data, error } = await supabase.from('shared_reports').insert({
      office_broker_id: officeId,
      created_by: brokerId,
      title: title.trim() || '추천 매물',
      property_ids: Array.from(selected.keys()),
    }).select('id').single()
    setCreating(false)
    if (error || !data) { toast.error(`생성 실패: ${error?.message ?? '알 수 없는 오류'}`); return }
    setCreatedLink(linkFor(data.id))
    void loadRecent()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 shadow-xl mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">추천 매물 보고서</h3>
          <button onClick={onClose} aria-label="닫기" className="text-gray-500 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>

        {createdLink ? (
          /* ── 생성 완료: 링크 복사 화면 ── */
          <div className="p-5">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">링크가 만들어졌어요 🎉</p>
            <p className="mt-1 text-xs text-gray-500">카톡·문자에 붙여넣으면 고객이 바로 볼 수 있어요. 링크는 14일간 유효하고, 고객이 열면 아래 목록에 &quot;열람됨&quot;으로 표시돼요.</p>
            <div className="mt-3 flex gap-2">
              <input readOnly value={createdLink} className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-950" />
              <button onClick={() => copy(createdLink)}
                className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}복사
              </button>
            </div>
            <button onClick={() => { setCreatedLink(null); setSelected(new Map()); setTitle('') }}
              className="mt-3 w-full rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
              새 보고서 만들기
            </button>
          </div>
        ) : (
          /* ── 생성 화면: 검색·선택·제목 ── */
          <>
            <div className="px-3 py-2.5 border-b border-gray-100 dark:border-gray-800 space-y-2">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="보고서 제목 (예: 김OO님 추천 매물)"
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="매물번호, 주소, 유형 검색..."
                className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20" />
              {rows.length >= PICK_LIMIT && (
                <p className="text-xs text-gray-500">최근 {PICK_LIMIT}건만 표시 중이에요. 주소나 매물번호로 검색해 보세요.</p>
              )}
            </div>
            <div className="max-h-60 overflow-y-auto">
              {rows.length === 0
                ? <p className="py-8 text-center text-sm text-gray-400">매물 없음</p>
                : rows.map(p => (
                  <div key={p.id} onClick={() => toggle(p)}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-500/10 cursor-pointer border-b border-gray-50 dark:border-gray-800 last:border-0">
                    <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border-2 transition-colors ${selected.has(p.id) ? 'bg-blue-600 border-blue-600' : 'border-gray-300 dark:border-gray-700'}`}>
                      {selected.has(p.id) && <Check className="h-3 w-3 text-white" />}
                    </div>
                    {p.seq_no != null && (
                      <span className="flex-shrink-0 rounded-md bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[11px] font-semibold text-gray-500 tabular-nums">{p.seq_no}</span>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">{p.address ?? '주소 미입력'}</div>
                      <div className="text-xs text-gray-500">{p.deal_type} · {p.room_type} · {fmtPrice(p)}</div>
                    </div>
                  </div>
                ))
              }
            </div>
            <div className="p-3 border-t border-gray-100 dark:border-gray-800">
              <button onClick={create} disabled={creating || selected.size === 0}
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">
                {creating ? '만드는 중...' : `링크 만들기 (${selected.size}개 매물)`}
              </button>
            </div>
          </>
        )}

        {/* 최근 보낸 보고서 — 읽음 확인 */}
        {recent.length > 0 && (
          <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3">
            <p className="mb-2 text-xs font-semibold text-gray-500">최근 보낸 보고서</p>
            <div className="space-y-1.5">
              {recent.map(r => (
                <div key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{r.title} <span className="text-gray-400">· {r.property_ids.length}건</span></span>
                  {r.viewed_at
                    ? <span className="flex items-center gap-1 text-green-600 font-medium flex-shrink-0"><Eye className="h-3 w-3" />열람됨</span>
                    : <span className="flex items-center gap-1 text-gray-400 flex-shrink-0"><Clock3 className="h-3 w-3" />아직 안 봄</span>}
                  <button onClick={() => copy(linkFor(r.id))} aria-label="링크 복사"
                    className="text-gray-400 hover:text-blue-600 flex-shrink-0"><Copy className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
