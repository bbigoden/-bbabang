'use client'

/**
 * 견적 거래처 관리.
 * 견적서 작성 중 "거래처 목록에 저장"으로도 쌓이지만, 오타를 고치거나
 * 지우려면 여기가 필요하다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAllPaged } from '@/lib/fetch-all-paged'
import { useToast } from '@/components/toast'
import { Plus, Trash2, X, Users, Search } from 'lucide-react'
import { calcStats, fmtComma, type EstimateClient, type Estimate } from '@/lib/estimate'

type ClientHistory = Pick<Estimate, 'status' | 'total'>

const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white'
const LABEL = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400'

export function ClientsTab({ brokerId }: { brokerId: string }) {
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<EstimateClient[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Partial<EstimateClient> | null>(null)
  const [saving, setSaving] = useState(false)
  // 거래처별 견적 이력 (client_id → 그 거래처로 나간 견적들)
  const [history, setHistory] = useState<Record<string, ClientHistory[]>>({})

  const load = useCallback(async () => {
    const [cl, es] = await Promise.all([
      supabase.from('estimate_clients').select('*').eq('owner_broker_id', brokerId).order('name'),
      // 이력 집계는 전건이 필요하다 (1000행 무음 절단 회피)
      fetchAllPaged<ClientHistory & { client_id: string | null }>((from, to) =>
        supabase.from('estimates').select('client_id,status,total')
          .eq('owner_broker_id', brokerId).order('id', { ascending: true }).range(from, to)
      ),
    ])
    setRows((cl.data as EstimateClient[]) ?? [])

    const map: Record<string, ClientHistory[]> = {}
    for (const e of es) {
      if (!e.client_id) continue
      ;(map[e.client_id] ??= []).push({ status: e.status, total: e.total })
    }
    setHistory(map)
    setLoading(false)
  }, [brokerId, supabase])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing?.name?.trim()) { toast.error('상호·고객명을 입력하세요'); return }
    setSaving(true)
    const { id, ...rest } = editing
    const payload = { ...rest, owner_broker_id: brokerId, name: editing.name.trim() }
    const res = id
      ? await supabase.from('estimate_clients').update(payload).eq('id', id)
      : await supabase.from('estimate_clients').insert(payload)
    setSaving(false)
    if (res.error) { toast.error('저장하지 못했습니다'); return }
    toast.success('저장했습니다')
    setEditing(null)
    load()
  }

  const remove = async (row: EstimateClient) => {
    if (!confirm(`"${row.name}" 거래처를 삭제할까요?\n이미 발행한 견적서의 거래처 정보는 그대로 남습니다.`)) return
    const { error } = await supabase.from('estimate_clients').delete().eq('id', row.id)
    if (error) { toast.error('삭제하지 못했습니다'); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return rows
    return rows.filter(r =>
      [r.name, r.contact_name, r.phone, r.email, r.address]
        .some(v => (v ?? '').toLowerCase().includes(kw))
    )
  }, [rows, q])

  if (loading) return <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="상호·담당자·연락처"
            aria-label="거래처 검색"
            className="w-60 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white" />
        </div>
        <button onClick={() => setEditing({})}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" />거래처 추가
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center dark:border-gray-800">
          <Users className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-700" />
          <p className="text-sm text-gray-500">
            {rows.length === 0 ? '등록된 거래처가 없습니다.' : '조건에 맞는 거래처가 없습니다.'}
          </p>
          {rows.length === 0 && (
            <p className="mt-1 text-xs text-gray-500">
              견적서를 쓰면서 &quot;거래처 목록에 저장&quot;을 눌러도 여기에 쌓입니다.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950/50">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">상호·고객명</th>
                <th className="px-3 py-2.5 text-left font-semibold">담당자</th>
                <th className="px-3 py-2.5 text-left font-semibold">연락처</th>
                <th className="px-3 py-2.5 text-left font-semibold">이메일</th>
                <th className="px-3 py-2.5 text-left font-semibold">현장 주소</th>
                <th className="px-3 py-2.5 text-right font-semibold">견적 이력</th>
                <th className="px-3 py-2.5 text-center font-semibold">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} onClick={() => setEditing(c)}
                  className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-800/40">
                  <td className="px-3 py-3 font-semibold text-gray-900 dark:text-white">{c.name}</td>
                  <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{c.contact_name || '—'}</td>
                  <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{c.phone || '—'}</td>
                  <td className="px-3 py-3 text-gray-600 dark:text-gray-400">{c.email || '—'}</td>
                  <td className="max-w-[12rem] truncate px-3 py-3 text-gray-500">{c.address || '—'}</td>
                  <td className="px-3 py-3 text-right"><HistoryCell rows={history[c.id]} /></td>
                  <td className="px-3 py-3 text-center">
                    <button onClick={e => { e.stopPropagation(); remove(c) }} title="삭제" aria-label="거래처 삭제"
                      className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => setEditing(null)}>
          <div onClick={e => e.stopPropagation()}
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 dark:bg-gray-900 sm:rounded-2xl">
            <div className="mb-4 flex items-center">
              <h2 className="text-base font-black text-gray-900 dark:text-white">
                {editing.id ? '거래처 수정' : '거래처 추가'}
              </h2>
              <button onClick={() => setEditing(null)} aria-label="닫기" className="ml-auto rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="cl-name">상호·고객명 *</label>
                <input id="cl-name" value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="cl-contact">담당자</label>
                <input id="cl-contact" value={editing.contact_name ?? ''} onChange={e => setEditing(p => ({ ...p, contact_name: e.target.value }))} className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="cl-phone">연락처</label>
                <input id="cl-phone" value={editing.phone ?? ''} onChange={e => setEditing(p => ({ ...p, phone: e.target.value }))} className={FIELD} />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="cl-email">이메일 (견적서 받을 주소)</label>
                <input id="cl-email" type="email" value={editing.email ?? ''} onChange={e => setEditing(p => ({ ...p, email: e.target.value }))} className={FIELD} />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="cl-addr">현장 주소</label>
                <input id="cl-addr" value={editing.address ?? ''} onChange={e => setEditing(p => ({ ...p, address: e.target.value }))} className={FIELD} />
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="cl-memo">메모</label>
                <textarea id="cl-memo" rows={3} value={editing.memo ?? ''} onChange={e => setEditing(p => ({ ...p, memo: e.target.value }))}
                  className={`${FIELD} resize-y`} />
              </div>
            </div>

            {editing.id && history[editing.id]?.length ? (
              <div className="mt-4 rounded-xl bg-gray-50 p-3 text-sm dark:bg-gray-950/50">
                <p className="mb-1 text-xs font-semibold text-gray-500">이 거래처 견적 이력</p>
                <HistoryDetail rows={history[editing.id]} />
              </div>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
                취소
              </button>
              <button onClick={save} disabled={saving}
                className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 목록용 한 줄 요약: "3건 · 수주 1" */
function HistoryCell({ rows }: { rows?: ClientHistory[] }) {
  if (!rows?.length) return <span className="text-gray-300 dark:text-gray-700">—</span>
  const s = calcStats(rows)
  return (
    <span className="whitespace-nowrap text-xs">
      <span className="font-semibold text-gray-700 dark:text-gray-300">{s.count}건</span>
      {s.wonCount > 0 && (
        <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">수주 {s.wonCount}</span>
      )}
    </span>
  )
}

/** 모달용 상세: 건수·총액·수주액·수주율 */
function HistoryDetail({ rows }: { rows: ClientHistory[] }) {
  const s = calcStats(rows)
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
      <Stat k="견적" v={`${s.count}건`} />
      <Stat k="견적 총액" v={`${fmtComma(s.amount)}원`} />
      <Stat k="수주" v={`${s.wonCount}건 · ${fmtComma(s.wonAmount)}원`} />
      <Stat k="수주율" v={s.winRate == null ? '—' : `${Math.round(s.winRate * 100)}%`} />
    </dl>
  )
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-gray-500">{k}</dt>
      <dd className="font-semibold text-gray-800 dark:text-gray-200">{v}</dd>
    </div>
  )
}
