'use client'

import { useState, useRef, useId } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'
import { useToast } from '@/components/toast'
import { Bookmark, BookmarkCheck, X, Check } from 'lucide-react'

interface Props {
  target: 'broker' | 'request' | 'property'
  filters: Record<string, any>
  defaultLabel?: string
}

export function SaveSearchButton({ target, filters, defaultLabel = '' }: Props) {
  const router = useRouter()
  const supabaseRef = useRef(createClient())
  const supabase = supabaseRef.current
  const { user } = useAuthOptional()
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(defaultLabel)
  const labelId = useId()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  // 활성 필터가 없으면 버튼 숨김
  const hasFilters = Object.values(filters).some(v => v !== null && v !== undefined && v !== '' && v !== false)
  if (!hasFilters) return null

  const click = () => {
    if (!user) { router.push('/auth/login?redirect=/favorites'); return }
    setOpen(true)
    setLabel(defaultLabel)
    setDone(false)
  }

  const save = async () => {
    if (!user) return
    setBusy(true)
    const { error } = await supabase.from('saved_searches').insert({
      user_id: user.id,
      target,
      label: label.trim() || null,
      filters,
    })
    setBusy(false)
    if (error) { toast.error('저장 실패: ' + error.message); return }
    setDone(true)
    setTimeout(() => setOpen(false), 1500)
  }

  return (
    <>
      <button type="button" onClick={click}
        className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors">
        <Bookmark className="h-3.5 w-3.5" />
        조건 저장
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => !busy && setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
              <h3 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                <Bookmark className="h-4 w-4 text-blue-500" />
                검색 조건 저장
              </h3>
              <button onClick={() => setOpen(false)} disabled={busy}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            {done ? (
              <div className="px-5 py-8 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
                  <BookmarkCheck className="h-6 w-6 text-green-600" />
                </div>
                <p className="font-semibold text-gray-900 dark:text-white">저장됐어요!</p>
                <p className="mt-1 text-xs text-gray-500">이 조건에 맞는 새 항목이 등록되면 알림으로 알려드려요</p>
              </div>
            ) : (
              <>
                <div className="px-5 py-5">
                  <label htmlFor={labelId} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">이름 (선택)</label>
                  <input id={labelId} value={label} onChange={e => setLabel(e.target.value)} maxLength={50}
                    placeholder="예: 강남 원룸, 부산 매매"
                    className="w-full rounded-xl border border-gray-200 dark:border-gray-800 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                  <p className="mt-2 text-xs text-gray-500">저장한 조건은 [/favorites](/favorites)에서 모아볼 수 있어요</p>

                  <div className="mt-4 rounded-xl bg-gray-50 dark:bg-gray-950 px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">저장될 조건</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(filters).filter(([_, v]) => v !== null && v !== undefined && v !== '' && v !== false).map(([k, v]) => (
                        <span key={k} className="inline-flex items-center gap-1 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:text-gray-300">
                          <span className="text-gray-500">{k}:</span> {String(v)}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 border-t border-gray-100 dark:border-gray-800 px-5 py-4">
                  <button onClick={() => setOpen(false)} disabled={busy}
                    className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 disabled:opacity-50">
                    취소
                  </button>
                  <button onClick={save} disabled={busy}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                    <Check className="h-4 w-4" />
                    {busy ? '저장 중...' : '저장'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
