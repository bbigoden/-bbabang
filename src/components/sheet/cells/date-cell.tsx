'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { todayKST, addDays } from '@/lib/date-kst'

/**
 * 날짜 고르는 칸 — 한 날(`DateCell`)과 기간(`DateRangeCell`) 두 가지.
 *
 * **달력은 한 벌만 둔다**(`CalendarPanel`). 화면마다 다른 달력이 뜨면 같은
 * 프로그램으로 보이지 않는다. 매물목록·고객목록이 쓰는 그 달력을 매물수집의
 * 기간 고르기도 그대로 쓴다 — 기간이라 두 날을 누르는 것만 다르다.
 */

const 요일 = ['일', '월', '화', '수', '목', '금', '토']

/** 6자리(YYMMDD) / 8자리(YYYYMMDD) 숫자 입력을 ISO(YYYY-MM-DD)로 정규화 */
function normalize(raw: string): string {
  const t = raw.trim()
  if (/^\d{6}$/.test(t)) return `20${t.slice(0, 2)}-${t.slice(2, 4)}-${t.slice(4, 6)}`
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  return t
}

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** 화면 밖으로 나가지 않게 팝업 자리를 잡는다. */
function popupStyle(el: HTMLElement | null): React.CSSProperties {
  if (!el) return {}
  const r = el.getBoundingClientRect()
  const top = r.bottom + 4
  return {
    position: 'fixed', zIndex: 9999,
    top: top + 300 > window.innerHeight ? Math.max(8, r.top - 304) : top,
    left: r.left + 240 > window.innerWidth ? window.innerWidth - 248 : r.left,
  }
}

/**
 * 달력 한 장. 고른 날·기간 안쪽·못 고르는 날을 부르는 쪽이 정한다.
 */
function CalendarPanel({
  viewYear, viewMonth, onPrev, onNext, onPick, selected, inRange, disabled,
}: {
  viewYear: number
  viewMonth: number
  onPrev: () => void
  onNext: () => void
  onPick: (day: string) => void
  selected: (day: string) => boolean
  inRange?: (day: string) => boolean
  disabled?: (day: string) => boolean
}) {
  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  const 오늘 = todayKST()

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2">
        <button onClick={onPrev} className="flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700">‹</button>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{viewYear}년 {viewMonth + 1}월</span>
        <button onClick={onNext} className="flex h-6 w-6 items-center justify-center rounded text-xs font-bold text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700">›</button>
      </div>
      <div className="grid grid-cols-7 px-2 pb-1">
        {요일.map((d, i) => (
          <div key={d} className={`pb-1 text-center text-[10px] font-medium ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500'}`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 px-2 pb-2">
        {cells.map((day, i) => {
          if (!day) return <div key={i} />
          const str = ymd(viewYear, viewMonth, day)
          const col = i % 7
          const 못고름 = disabled?.(str) ?? false
          const 고름 = selected(str)
          const 사이 = !고름 && (inRange?.(str) ?? false)
          return (
            <button
              key={i}
              disabled={못고름}
              onClick={() => onPick(str)}
              className={cn(
                'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors',
                못고름 ? 'cursor-not-allowed text-gray-300 dark:text-gray-700'
                  : 고름 ? 'bg-blue-600 font-bold text-white'
                  : 사이 ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300'
                  : str === 오늘 ? 'border border-blue-400 font-semibold text-blue-600 hover:bg-blue-50'
                  : col === 0 ? 'text-red-400 hover:bg-red-50'
                  : col === 6 ? 'text-blue-400 hover:bg-blue-50'
                  : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
              )}
            >
              {day}
            </button>
          )
        })}
      </div>
    </>
  )
}

/**
 * 날짜 입력 셀.
 * - 클릭: 달력 + 직접 입력 두 가지 방식 제공
 * - 달력에서 날짜 클릭하면 즉시 저장 + 닫힘
 * - 빈 값: "날짜" placeholder (회색)
 * - readOnly: 편집 불가, 표시만
 * - onClear 전달 시: 팝업에 '지우기' 버튼 표시 + 입력값을 비우고 엔터 쳐도 지워짐
 */
export function DateCell({
  value,
  onSave,
  onClear,
  readOnly,
}: {
  value: string | null
  onSave: (v: string) => void
  onClear?: () => void
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

  const commit = () => {
    const v = normalize(draft)
    if (!v) {
      // 입력값을 다 지우고 확정하면 날짜 제거 (onClear 지원 셀 한정)
      if (value && onClear) onClear()
      setOpen(false)
      return
    }
    if (v !== (value ?? '')) onSave(v)
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
    setPopStyle(popupStyle(btnRef.current))
    setOpen(true)
  }

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) } else setViewMonth(m => m - 1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) } else setViewMonth(m => m + 1) }

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
            <div className="relative">
              <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setOpen(false) }}
                placeholder="2026-05-13"
                className={cn(
                  "w-full rounded-lg border border-gray-200 dark:border-gray-800 py-1.5 pl-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20",
                  onClear && value ? "pr-7" : "pr-2",
                )} />
              {onClear && value && (
                <button
                  onClick={() => { onClear(); setOpen(false) }}
                  aria-label="날짜 지우기" title="날짜 지우기"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600 dark:text-gray-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <CalendarPanel
            viewYear={viewYear} viewMonth={viewMonth}
            onPrev={prevMonth} onNext={nextMonth}
            onPick={str => { setDraft(str); onSave(str); setOpen(false) }}
            selected={str => str === (value ?? '')}
          />
        </div>
      )}
    </div>
  )
}

/**
 * 기간 고르는 칸 — 같은 달력에서 **두 날을 눌러** 시작과 끝을 정한다.
 *
 * 칸을 두 개 두는 것보다 이쪽이 낫다. 기간은 하나인데 칸이 둘이면 어느 쪽을
 * 먼저 고칠지 매번 생각해야 하고, 한쪽만 옮겼을 때 다른 쪽이 따라 움직이는 것도
 * 눈에 잘 안 띈다. 한 칸을 누르고 달력에서 시작·끝을 차례로 찍는 편이 하려던
 * 일에 가깝다.
 *
 * **`maxDays` 를 넘기면 막지 않고 당긴다.** "안 됩니다" 하고 되돌리는 것보다
 * 방금 누른 날을 살리고 반대쪽을 당기는 편이 낫다.
 */
export function DateRangeCell({
  from, to, onSave, maxDays, min, max,
}: {
  from: string
  to: string
  onSave: (from: string, to: string) => void
  /** 한 번에 고를 수 있는 최대 날수 (양 끝 포함) */
  maxDays?: number
  /** 고를 수 있는 맨 앞날 / 맨 뒷날 */
  min?: string
  max?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [고르는중, set고르는중] = useState<string | null>(null)
  const [viewYear, setViewYear] = useState(() => Number(to.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number(to.slice(5, 7)) - 1)
  const btnRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [popStyle, setPopStyle] = useState<React.CSSProperties>({})

  const 보임 = from === to ? from : `${from} ~ ${to}`

  const 자르기 = (day: string) => (max && day > max ? max : min && day < min ? min : day)

  /** 두 날을 받아 앞뒤를 바로잡고 최대 날수 안으로 당긴다. */
  const 확정 = (a: string, b: string) => {
    let [첫, 끝] = a <= b ? [a, b] : [b, a]
    첫 = 자르기(첫); 끝 = 자르기(끝)
    if (maxDays) {
      const 날수 = Math.round((Date.parse(`${끝}T00:00:00Z`) - Date.parse(`${첫}T00:00:00Z`)) / 86_400_000) + 1
      // 나중에 누른 쪽을 살린다 — 방금 고른 날이 사라지면 고른 것 같지가 않다.
      if (날수 > maxDays) {
        if (b >= a) 첫 = addDays(끝, -(maxDays - 1))
        else 끝 = addDays(첫, maxDays - 1)
        첫 = 자르기(첫); 끝 = 자르기(끝)
      }
    }
    set고르는중(null)
    setOpen(false)
    if (첫 !== from || 끝 !== to) onSave(첫, 끝)
  }

  /** 직접 친 글자를 읽는다. '2026-09-01 ~ 2026-09-05' 도 되고 한 날만 쳐도 된다. */
  const commit = () => {
    const 조각 = draft.split('~').map(s => normalize(s)).filter(Boolean)
    const 날 = 조각.filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`)))
    if (!날.length) { setOpen(false); return }
    확정(날[0], 날[1] ?? 날[0])
  }

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (!btnRef.current?.contains(e.target as Node) && !popupRef.current?.contains(e.target as Node)) {
        set고르는중(null); setOpen(false)
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.select(), 50) }, [open])

  const handleOpen = () => {
    if (open) return
    setDraft(보임)
    set고르는중(null)
    setViewYear(Number(to.slice(0, 4)))
    setViewMonth(Number(to.slice(5, 7)) - 1)
    setPopStyle(popupStyle(btnRef.current))
    setOpen(true)
  }

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11) } else setViewMonth(m => m - 1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0) } else setViewMonth(m => m + 1) }

  const 누름 = (day: string) => {
    if (고르는중 === null) { set고르는중(day); setDraft(day); return }
    확정(고르는중, day)
  }

  return (
    <div className="relative">
      <div
        ref={btnRef}
        onClick={handleOpen}
        className="cursor-pointer whitespace-nowrap rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-sm
                   text-gray-700 hover:bg-blue-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300
                   dark:hover:bg-gray-800"
      >
        {보임}
      </div>
      {open && (
        <div ref={popupRef} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900" style={{ ...popStyle, width: 240 }}>
          <div className="border-b border-gray-100 p-2 dark:border-gray-800">
            <input
              ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { set고르는중(null); setOpen(false) } }}
              placeholder="2026-09-01 ~ 2026-09-05"
              className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none
                         focus:border-blue-400 focus:ring-1 focus:ring-blue-400/20 dark:border-gray-800 dark:bg-gray-950"
            />
            <p className="mt-1 px-0.5 text-[10px] text-gray-400">
              {고르는중 ? '끝나는 날을 누르세요' : `시작하는 날을 누르세요${maxDays ? ` · 최대 ${maxDays}일` : ''}`}
            </p>
          </div>
          <CalendarPanel
            viewYear={viewYear} viewMonth={viewMonth}
            onPrev={prevMonth} onNext={nextMonth}
            onPick={누름}
            selected={str => (고르는중 ? str === 고르는중 : str === from || str === to)}
            inRange={str => !고르는중 && str > from && str < to}
            disabled={str => (!!max && str > max) || (!!min && str < min)}
          />
        </div>
      )}
    </div>
  )
}
