'use client'

/**
 * 견적 내역 편집 테이블.
 * 공종 구분줄(is_header)은 제목만 보여주고 금액 칸을 비운다.
 */

import { GripVertical, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { fmtComma, lineAmount, type EstimateItem } from '@/lib/estimate'

const CELL = 'w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-blue-50 dark:text-white dark:focus:bg-blue-500/10 rounded'
const UNITS = ['식', '㎡', 'M', 'EA', '개', '대', '조', '본', '통', '일']

interface Props {
  items: EstimateItem[]
  onChange: (items: EstimateItem[]) => void
}

export function ItemsEditor({ items, onChange }: Props) {
  const patch = (idx: number, p: Partial<EstimateItem>) => {
    const next = items.map((it, i) => {
      if (i !== idx) return it
      const merged = { ...it, ...p }
      if ('qty' in p || 'unit_price' in p) merged.amount = lineAmount(merged.qty, merged.unit_price)
      return merged
    })
    onChange(next)
  }

  const reindex = (list: EstimateItem[]) => list.map((it, i) => ({ ...it, sort_order: i }))

  const addRow = (isHeader: boolean, at?: number) => {
    const blank: EstimateItem = {
      sort_order: 0, is_header: isHeader,
      category: null, name: null, spec: null, unit: isHeader ? null : '식',
      qty: isHeader ? 0 : 1, unit_price: 0, amount: 0, remark: null,
    }
    const pos = at ?? items.length
    onChange(reindex([...items.slice(0, pos), blank, ...items.slice(pos)]))
  }

  const removeRow = (idx: number) => onChange(reindex(items.filter((_, i) => i !== idx)))

  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir
    if (to < 0 || to >= items.length) return
    const next = [...items]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    onChange(reindex(next))
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-950/50">
            <tr>
              <th className="w-8 px-1 py-2"></th>
              <th className="w-40 px-2 py-2 text-left font-semibold">공종</th>
              <th className="px-2 py-2 text-left font-semibold">품명</th>
              <th className="w-32 px-2 py-2 text-left font-semibold">규격</th>
              <th className="w-16 px-2 py-2 text-left font-semibold">단위</th>
              <th className="w-20 px-2 py-2 text-right font-semibold">수량</th>
              <th className="w-28 px-2 py-2 text-right font-semibold">단가</th>
              <th className="w-28 px-2 py-2 text-right font-semibold">금액</th>
              <th className="w-28 px-2 py-2 text-left font-semibold">비고</th>
              <th className="w-20 px-1 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-gray-400">
                  내역이 없습니다. 아래 버튼으로 줄을 추가하거나 프리셋을 불러오세요.
                </td>
              </tr>
            )}

            {items.map((it, idx) => it.is_header ? (
              <tr key={idx} className="border-t border-gray-100 bg-gray-50/70 dark:border-gray-800 dark:bg-gray-800/40">
                <td className="px-1 text-center text-gray-300"><GripVertical className="mx-auto h-3.5 w-3.5" /></td>
                <td colSpan={8} className="px-2 py-1">
                  <input
                    value={it.name ?? ''}
                    onChange={e => patch(idx, { name: e.target.value, category: e.target.value })}
                    placeholder="공종 구분 (예: 목공사)"
                    aria-label="공종 구분"
                    className={`${CELL} font-bold text-gray-800`}
                  />
                </td>
                <td className="px-1">
                  <RowActions idx={idx} last={items.length - 1} onMove={move} onRemove={removeRow} />
                </td>
              </tr>
            ) : (
              <tr key={idx} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-1 text-center text-xs text-gray-400">{idx + 1}</td>
                <td className="px-1">
                  <input value={it.category ?? ''} onChange={e => patch(idx, { category: e.target.value })}
                    aria-label="공종" className={CELL} />
                </td>
                <td className="px-1">
                  <input value={it.name ?? ''} onChange={e => patch(idx, { name: e.target.value })}
                    placeholder="품명" aria-label="품명" className={CELL} />
                </td>
                <td className="px-1">
                  <input value={it.spec ?? ''} onChange={e => patch(idx, { spec: e.target.value })}
                    aria-label="규격" className={CELL} />
                </td>
                <td className="px-1">
                  <input value={it.unit ?? ''} onChange={e => patch(idx, { unit: e.target.value })}
                    list="estimate-units" aria-label="단위" className={CELL} />
                </td>
                <td className="px-1">
                  <input type="number" step="0.01" value={it.qty || ''} onChange={e => patch(idx, { qty: Number(e.target.value) })}
                    aria-label="수량" className={`${CELL} text-right`} />
                </td>
                <td className="px-1">
                  <input type="number" value={it.unit_price || ''} onChange={e => patch(idx, { unit_price: Number(e.target.value) })}
                    aria-label="단가" className={`${CELL} text-right`} />
                </td>
                <td className="px-2 py-1.5 text-right font-semibold text-gray-900 dark:text-white">
                  {fmtComma(it.amount)}
                </td>
                <td className="px-1">
                  <input value={it.remark ?? ''} onChange={e => patch(idx, { remark: e.target.value })}
                    aria-label="비고" className={CELL} />
                </td>
                <td className="px-1">
                  <RowActions idx={idx} last={items.length - 1} onMove={move} onRemove={removeRow} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="estimate-units">
          {UNITS.map(u => <option key={u} value={u} />)}
        </datalist>
      </div>

      <div className="mt-2 flex gap-2">
        <button onClick={() => addRow(false)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <Plus className="h-4 w-4" />품목 추가
        </button>
        <button onClick={() => addRow(true)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
          <Plus className="h-4 w-4" />공종 구분줄 추가
        </button>
      </div>
    </div>
  )
}

function RowActions({ idx, last, onMove, onRemove }: {
  idx: number
  last: number
  onMove: (idx: number, dir: -1 | 1) => void
  onRemove: (idx: number) => void
}) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <button onClick={() => onMove(idx, -1)} disabled={idx === 0} title="위로" aria-label="위로 이동"
        className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800">
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => onMove(idx, 1)} disabled={idx === last} title="아래로" aria-label="아래로 이동"
        className="rounded p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-30 dark:hover:bg-gray-800">
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button onClick={() => onRemove(idx)} title="줄 삭제" aria-label="줄 삭제"
        className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
