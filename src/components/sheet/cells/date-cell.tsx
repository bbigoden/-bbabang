'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * 날짜 입력 셀.
 * - 클릭: 달력 + 직접 입력 두 가지 방식 제공
 * - 달력에서 날짜 클릭하면 즉시 저장 + 닫힘
 * - 빈 값: "날짜" placeholder (회색)
 * - readOnly: 편집 불가, 표시만
 */
export function DateCell({
  value,
  onSave,
  readOnly,
}: {
  value: string | null
  onSave: (v: string) => void
  readOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [viewYear, setViewYear] = useState(() => {
    const d = value ? new Date(value) : new Date()
    return isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear()
  })
  const [viewMonth, setViewMonth] = useState(() => {
    const d = value ? new Date(value) : new Date()
    return isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth()
  })
  const btnRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  // 6자리(YYMMDD) / 8자리(YYYYMMDD) 숫자 입력을 ISO(YYYY-MM-DD)로 정규화
  const normalize = (raw: string): string => {
    const t = raw.trim()
    if (/^\d{6}$/.test(t)) return `20${t.slice(0, 2)}-${t.slice(2, 4)}-${t.slice(4, 6)}`
    if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
    return t
  }
  const commit = () => {
    const v = normalize(draft)
    if (v && v !== (value ?? '')) onSave(v)
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) {
        commit(); setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50) }, [open])

  if (readOnly) return (
    <div className={cn("w-full px-1 py-0.5 text-xs min-h-[22px]", value ? "text-gray-700 dark:text-gray-200" : "text-gray-500 dark:text-gray-400")}>
      {value || '—'}
    </div>
  )

  const handleOpen = () => {
    if (open) return
    setDraft(value ?? '')
    const d = value ? new Date(value) : new Date()
    const base = isNaN(d.getTime()) ? new Date() : d
    setViewYear(base.getFullYear()); setViewMonth(base.getMonth())
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const top = r.bottom + 4; const left = r.left
      setPopStyle({
        position: 'fixed', zIndex: 9999,
        top: top + 260 > window.innerHeight ? r.top - 264 : top,
        left: left + 240 > window.innerWidth ? window.innerWidth - 248 : left,
      })
    }
    setOpen(true)
  }

  const selectDate = (y: number, m: number, d: number) => {
    const str = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    setDraft(str); onSave(str); setOpen(false)
  }

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) } else setViewMonth(m => m - 1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) } else setViewMonth(m => m + 1) }

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
  const selectedStr = value ?? ''

  return (
    <div className="relative w-full">
      <div ref={btnRef} onClick={handleOpen}
        className={cn("w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis", value ? "text-gray-700 dark:text-gray-200" : "text-gray-500 dark:text-gray-400")}
       >
        {value || '날짜'}
      </div>
      {open && (
        <div ref={popupRef} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-xl overflow-hidden" style={{ ...popStyle, width: 240 }}>
          <div className="p-2 border-b border-gray-100 dark:border-gray-800">
            <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setOpen(false) }}
              placeholder="2026-05-13"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-800 px-2 py-1.5 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20" />
          </div>
          <div className="flex items-center justify-between px-3 py-2">
            <button onClick={prevMonth} className="flex h-6 w-6 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 text-gray-500 text-xs font-bold">‹</button>
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{viewYear}년 {viewMonth + 1}월</span>
            <button onClick={nextMonth} className="flex h-6 w-6 items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 text-gray-500 text-xs font-bold">›</button>
          </div>
          <div className="grid grid-cols-7 px-2 pb-1">
            {['일','월','화','수','목','금','토'].map((d, i) => (
              <div key={d} className={`text-center text-[10px] font-medium pb-1 ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 px-2 pb-2 gap-y-0.5">
            {cells.map((day, i) => {
              if (!day) return <div key={i} />
              const str = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
              const isSelected = str === selectedStr
              const isToday = str === todayStr
              const col = i % 7
              return (
                <button key={i} onClick={() => selectDate(viewYear, viewMonth, day)}
                  className={`flex h-7 w-7 mx-auto items-center justify-center rounded-full text-xs transition-colors
                    ${isSelected ? 'bg-blue-600 text-white font-bold' :
                      isToday ? 'border border-blue-400 text-blue-600 font-semibold hover:bg-blue-50' :
                      col === 0 ? 'text-red-400 hover:bg-red-50' :
                      col === 6 ? 'text-blue-400 hover:bg-blue-50' :
                      'text-gray-700 hover:bg-gray-100'}`}>
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
