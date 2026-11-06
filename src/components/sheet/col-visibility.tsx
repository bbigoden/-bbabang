'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, MoreHorizontal } from 'lucide-react'
import { SearchClear } from '@/components/ui/search-clear'

export interface ColChoice {
  key: string
  label: string
  /** 늘 보이는 칸 — 눌러도 숨겨지지 않는다 */
  fixed?: boolean
}

/**
 * 시트 머리줄 끝의 […] — 칸을 찾아 보이기·숨기기.
 * 고객·업무일지·매물 화면에 따로 있던 것을 하나로 모았다(2026-11-06).
 * 창은 body 에 띄운다 — 넘침을 자르는 칸 안에 있어도 잘리지 않게.
 */
export function ColVisibility({ cols, visible, onToggle }: {
  cols: ColChoice[]
  visible: string[]
  onToggle: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const handleOpen = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPopStyle({ position: 'fixed', top: r.bottom + 4, left: Math.max(8, r.right - 260), zIndex: 9999, width: 260 })
    }
    setOpen(v => !v)
  }

  const rows = search ? cols.filter(c => c.label.includes(search)) : cols

  return (
    <div className="relative">
      <button ref={btnRef} onClick={handleOpen} aria-label="더보기"
        className="flex h-5 w-5 items-center justify-center rounded text-gray-300 hover:bg-gray-200 hover:text-gray-500 cursor-pointer transition-colors">
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && createPortal(
        <div ref={popupRef} className="rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl overflow-hidden" style={popStyle}>
          <div className="relative p-2 border-b border-gray-100 dark:border-gray-800">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="속성을 검색하세요" autoFocus
              className="w-full rounded-lg border border-gray-200 dark:border-gray-800 pl-3 pr-8 py-1.5 text-xs focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20" />
            {search && <SearchClear onClick={() => setSearch('')} />}
          </div>
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <span className="text-xs font-medium text-gray-500">표에 표시하기</span>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {rows.map(c => {
              const shown = c.fixed || visible.includes(c.key)
              return (
                <div key={c.key}
                  className={`flex items-center justify-between px-3 py-1.5 bg-white hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800 ${c.fixed ? 'cursor-default' : 'cursor-pointer'}`}
                  onClick={() => !c.fixed && onToggle(c.key)}>
                  <span className={`text-xs font-medium ${shown ? 'text-gray-700 dark:text-gray-300' : 'text-gray-500'}`}>{c.label}</span>
                  <Eye className={`h-3.5 w-3.5 flex-shrink-0 ${shown ? 'text-gray-500' : 'text-gray-200'}`} />
                </div>
              )
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
