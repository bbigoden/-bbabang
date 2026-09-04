'use client'

/**
 * 공사 프리셋 관리.
 * 내용(품목·단가) 수정은 견적서 작성 화면에서 하고, 거기서 "프리셋으로 저장"으로 덮어쓴다.
 * 여기서는 목록·이름변경·삭제와 기본 프리셋 설치만 다룬다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/components/toast'
import { Trash2, Download, Layers, Pencil } from 'lucide-react'
import { DEFAULT_PRESETS, calcTotals, fmtComma, type EstimateItem } from '@/lib/estimate'

interface TemplateRow {
  id: string
  name: string
  items: EstimateItem[]
  sort_order: number
}

export function TemplatesTab({ brokerId }: { brokerId: string }) {
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<TemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('estimate_templates')
      .select('*').eq('owner_broker_id', brokerId).order('sort_order')
    setRows((data as TemplateRow[]) ?? [])
    setLoading(false)
  }, [brokerId, supabase])

  useEffect(() => { load() }, [load])

  const installDefaults = async () => {
    setInstalling(true)
    const existing = new Set(rows.map(r => r.name))
    const toAdd = DEFAULT_PRESETS.filter(p => !existing.has(p.name))
    if (toAdd.length === 0) {
      toast.info('기본 프리셋이 이미 모두 있습니다')
      setInstalling(false)
      return
    }
    const { error } = await supabase.from('estimate_templates').insert(
      toAdd.map((p, i) => ({
        owner_broker_id: brokerId,
        name: p.name,
        items: p.items,
        sort_order: rows.length + i,
      }))
    )
    setInstalling(false)
    if (error) { toast.error('설치하지 못했습니다'); return }
    toast.success(`${toAdd.length}개 프리셋을 추가했습니다`)
    load()
  }

  const rename = async (row: TemplateRow) => {
    const name = prompt('프리셋 이름', row.name)?.trim()
    if (!name || name === row.name) return
    const { error } = await supabase.from('estimate_templates').update({ name }).eq('id', row.id)
    if (error) { toast.error('이름을 바꾸지 못했습니다'); return }
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, name } : r))
  }

  const remove = async (row: TemplateRow) => {
    if (!confirm(`"${row.name}" 프리셋을 삭제할까요?`)) return
    const { error } = await supabase.from('estimate_templates').delete().eq('id', row.id)
    if (error) { toast.error('삭제하지 못했습니다'); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  if (loading) return <p className="py-8 text-center text-sm text-gray-500">불러오는 중…</p>

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">
          자주 하는 공사를 프리셋으로 저장해두면, 새 견적에서 불러와 수량·단가만 고치면 됩니다.
        </p>
        <button onClick={installDefaults} disabled={installing}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <Download className="h-4 w-4" />기본 프리셋 설치
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 py-12 text-center dark:border-gray-800">
          <Layers className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-700" />
          <p className="mb-1 text-sm text-gray-500">프리셋이 없습니다.</p>
          <p className="text-xs text-gray-400">
            &quot;기본 프리셋 설치&quot;를 누르면 원룸 올수리·상가 인테리어·사무실 부분수리가 들어옵니다.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(t => {
            const lines = (t.items ?? []).filter(i => !i.is_header)
            const total = calcTotals(t.items ?? [], { vat_mode: 'add' })
            return (
              <div key={t.id} className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="font-bold text-gray-900 dark:text-white">{t.name}</h3>
                  <div className="ml-auto flex items-center gap-1">
                    <button onClick={() => rename(t)} title="이름 변경" aria-label="이름 변경"
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800">
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => remove(t)} title="삭제" aria-label="프리셋 삭제"
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  품목 {lines.length}개 · 소계 {fmtComma(total.subtotal)}원
                </p>
                <p className="mt-2 line-clamp-2 text-xs text-gray-400">
                  {lines.slice(0, 6).map(i => i.name).filter(Boolean).join(' · ')}
                  {lines.length > 6 ? ' …' : ''}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
