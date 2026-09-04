'use client'

/**
 * 품목 사전 관리.
 * 견적서를 저장할 때마다 자동으로 쌓이므로 여기서는 손보고 지우는 일만 한다.
 * 원가는 내부용이라 견적서에는 나가지 않는다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { Trash2, Search, Package, Plus, X } from 'lucide-react'
import { fmtComma, type CatalogItem } from '@/lib/estimate'

const FIELD = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white'
const LABEL = 'mb-1 block text-xs font-semibold text-gray-500 dark:text-gray-400'

export function CatalogTab({ brokerId }: { brokerId: string }) {
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Partial<CatalogItem> | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('estimate_item_catalog')
      .select('id,category,name,spec,unit,unit_price,cost_price,use_count')
      .eq('owner_broker_id', brokerId)
      .order('use_count', { ascending: false }).order('name')
    setRows((data as CatalogItem[]) ?? [])
    setLoading(false)
  }, [brokerId, supabase])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!editing?.name?.trim()) { toast.error('품명을 입력하세요'); return }
    setSaving(true)
    const { id, use_count: _u, ...rest } = editing
    const payload = {
      ...rest,
      owner_broker_id: brokerId,
      name: editing.name.trim(),
      spec: editing.spec?.trim() || null,
      unit: editing.unit?.trim() || null,
      category: editing.category?.trim() || null,
      unit_price: editing.unit_price ?? 0,
      cost_price: editing.cost_price ?? 0,
    }
    const res = id
      ? await supabase.from('estimate_item_catalog').update(payload).eq('id', id)
      : await supabase.from('estimate_item_catalog').insert(payload)
    setSaving(false)
    if (res.error) {
      toast.error(res.error.code === '23505' ? '같은 품명·규격·단위가 이미 있습니다' : '저장하지 못했습니다')
      return
    }
    toast.success('저장했습니다')
    setEditing(null)
    load()
  }

  const remove = async (row: CatalogItem) => {
    if (!confirm(`"${row.name}" 을(를) 품목 사전에서 지울까요?\n이미 만든 견적서의 내용은 그대로 남습니다.`)) return
    const { error } = await supabase.from('estimate_item_catalog').delete().eq('id', row.id)
    if (error) { toast.error('삭제하지 못했습니다'); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    if (!kw) return rows
    return rows.filter(r => [r.name, r.spec, r.category, r.unit]
      .some(v => (v ?? '').toLowerCase().includes(kw)))
  }, [rows, q])

  if (loading) return <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="품명·규격·공종"
            aria-label="품목 검색"
            className="w-60 rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-200 dark:border-gray-800 dark:bg-gray-900 dark:text-white" />
        </div>
        <button onClick={() => setEditing({ unit_price: 0, cost_price: 0 })}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white hover:bg-blue-700">
          <Plus className="h-4 w-4" />품목 추가
        </button>
      </div>

      <p className="mb-3 text-sm text-gray-500">
        견적서를 저장할 때마다 쓴 품목이 자동으로 쌓입니다. 내역의 품명 칸에 입력하면 여기서 찾아 채워줍니다.
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center dark:border-gray-800">
          <Package className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-700" />
          <p className="text-sm text-gray-500">
            {rows.length === 0 ? '아직 쌓인 품목이 없습니다.' : '조건에 맞는 품목이 없습니다.'}
          </p>
          {rows.length === 0 && (
            <p className="mt-1 text-xs text-gray-500">견적서를 한 번 저장하면 그 품목들이 여기 들어옵니다.</p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full min-w-[48rem] text-sm">
            <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-950/50">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold">공종</th>
                <th className="px-3 py-2.5 text-left font-semibold">품명</th>
                <th className="px-3 py-2.5 text-left font-semibold">규격</th>
                <th className="px-3 py-2.5 text-center font-semibold">단위</th>
                <th className="px-3 py-2.5 text-right font-semibold">단가</th>
                <th className="px-3 py-2.5 text-right font-semibold text-amber-700 dark:text-amber-500">원가</th>
                <th className="px-3 py-2.5 text-right font-semibold">쓴 횟수</th>
                <th className="px-3 py-2.5 text-center font-semibold">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} onClick={() => setEditing(c)}
                  className="cursor-pointer border-b border-gray-50 last:border-0 hover:bg-gray-50 dark:border-gray-800/50 dark:hover:bg-gray-800/40">
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{c.category || '—'}</td>
                  <td className="px-3 py-2.5 font-semibold text-gray-900 dark:text-white">{c.name}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{c.spec || '—'}</td>
                  <td className="px-3 py-2.5 text-center text-gray-600 dark:text-gray-400">{c.unit || '—'}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-gray-900 dark:text-white">{fmtComma(c.unit_price)}</td>
                  <td className="px-3 py-2.5 text-right text-amber-800 dark:text-amber-500">
                    {c.cost_price ? fmtComma(c.cost_price) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-gray-500">{c.use_count}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button onClick={e => { e.stopPropagation(); remove(c) }} title="삭제" aria-label="품목 삭제"
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
                {editing.id ? '품목 수정' : '품목 추가'}
              </h2>
              <button onClick={() => setEditing(null)} aria-label="닫기" className="ml-auto rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL} htmlFor="ct-cat">공종</label>
                <input id="ct-cat" value={editing.category ?? ''} onChange={e => setEditing(p => ({ ...p, category: e.target.value }))}
                  placeholder="목공사" className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="ct-name">품명 *</label>
                <input id="ct-name" value={editing.name ?? ''} onChange={e => setEditing(p => ({ ...p, name: e.target.value }))} className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="ct-spec">규격</label>
                <input id="ct-spec" value={editing.spec ?? ''} onChange={e => setEditing(p => ({ ...p, spec: e.target.value }))} className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="ct-unit">단위</label>
                <input id="ct-unit" value={editing.unit ?? ''} onChange={e => setEditing(p => ({ ...p, unit: e.target.value }))}
                  placeholder="㎡" className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="ct-price">단가</label>
                <input id="ct-price" type="number" value={editing.unit_price || ''} onChange={e => setEditing(p => ({ ...p, unit_price: Number(e.target.value) }))} className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="ct-cost">원가 (내부용)</label>
                <input id="ct-cost" type="number" value={editing.cost_price || ''} onChange={e => setEditing(p => ({ ...p, cost_price: Number(e.target.value) }))} className={FIELD} />
              </div>
            </div>
            <p className="mt-2 text-xs text-gray-500">원가는 화면에서만 보이고 견적서 PDF에는 나가지 않습니다.</p>

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
