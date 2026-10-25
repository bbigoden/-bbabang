'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { History, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ymdKST, hmKST } from '@/lib/date-kst'

/**
 * 매물 글 칸(중개사메모·간단메모) 수정 이력 버튼.
 * 칸을 고치거나 지울 때마다 DB 트리거가 '바뀌기 전 값'을 property_text_history 에 남긴다.
 * 여기서 그 목록을 보고 [이 내용으로 되돌리기] 로 되살린다 — 되돌리는 것도 또 하나의 수정이라
 * 되돌리기 전 값도 이력에 남아 다시 되돌릴 수 있다.
 */
type Row = { id: number; old_value: string | null; new_value: string | null; changed_at: string }

export function PropertyTextHistoryButton({ propertyId, field, label, onRestore }: {
  propertyId: string
  field: 'memo' | 'brief_memo' | 'description'
  label: string
  onRestore: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let alive = true
    setRows(null); setFailed(false)
    createClient().from('property_text_history')
      .select('id, old_value, new_value, changed_at')
      .eq('property_id', propertyId).eq('field', field)
      .order('changed_at', { ascending: false }).limit(30)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { setFailed(true); return }
        // 비어 있던 값으로 돌아가는 건 의미가 없으니 내용이 있던 것만 보인다
        setRows((data ?? []).filter(r => (r.old_value ?? '').trim() !== ''))
      })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => { alive = false; window.removeEventListener('keydown', onKey) }
  }, [open, propertyId, field])

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={`${label} 이전 내용 보기 · 되돌리기`}
        aria-label={`${label} 이전 내용 보기`}
        className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-300 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
        <History className="h-3.5 w-3.5" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
          role="dialog" aria-modal="true" onClick={() => setOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-md flex-col rounded-2xl bg-white p-5 shadow-xl dark:bg-gray-900"
            onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-gray-900 dark:text-white">{label} 이전 내용</h3>
              <button type="button" onClick={() => setOpen(false)} aria-label="닫기"
                className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
              {failed ? <p className="py-6 text-center text-sm text-red-500">이력을 불러오지 못했어요.</p>
                : rows == null ? <p className="py-6 text-center text-sm text-gray-500">불러오는 중...</p>
                : rows.length === 0 ? <p className="py-6 text-center text-sm text-gray-500">되돌릴 이전 내용이 없어요. (이력은 2026-10-25 부터 쌓입니다)</p>
                : rows.map(r => (
                  <div key={r.id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                    <div className="mb-1 text-[11px] text-gray-500">{ymdKST(r.changed_at)} {hmKST(r.changed_at)} 에 바뀌기 전 내용</div>
                    <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-xs text-gray-800 dark:text-gray-200">{r.old_value}</p>
                    <button type="button"
                      onClick={() => { onRestore(r.old_value ?? ''); setOpen(false) }}
                      className="mt-2 w-full rounded-lg bg-gray-700 py-2 text-xs font-semibold text-white hover:bg-gray-800">
                      이 내용으로 되돌리기
                    </button>
                  </div>
                ))}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
