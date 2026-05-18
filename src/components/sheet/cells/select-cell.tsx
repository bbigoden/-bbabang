'use client'

import { useRef, useState } from 'react'
import { useClickOutside } from '@/lib/use-click-outside'

/**
 * 옵션 선택 셀.
 * - 단일 모드(default): 클릭 → 드롭다운 → 선택 시 즉시 저장 + 닫힘
 * - 다중 모드(multi=true): 한 셀에 칩 여러 개. 칩 ✕ 또는 옵션 클릭으로 토글.
 *   값은 ", " 구분 CSV로 저장(예: "김가주, 권세현"). 빈 값/빈 배열은 '' 저장.
 */
function parseCsv(v: string | null): string[] {
  if (!v) return []
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

export function SelectCell(props: {
  value: string | null
  options: string[]
  onSave: (v: string) => void
  colorMap?: Record<string, string>
  readOnly?: boolean
  placeholder?: string
  multi?: boolean
}) {
  if (props.multi) return <MultiSelectCell {...props} />
  return <SingleSelectCell {...props} />
}

function SingleSelectCell({
  value,
  options,
  onSave,
  colorMap,
  readOnly,
  placeholder,
}: {
  value: string | null
  options: string[]
  onSave: (v: string) => void
  colorMap?: Record<string, string>
  readOnly?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  if (readOnly) return (
    <div
      className={`rounded px-2 py-0.5 text-xs font-semibold inline-flex items-center ${
        value ? (colorMap?.[value] ?? 'bg-gray-100 text-gray-600') : 'bg-gray-50 text-gray-300'
      }`}
    >
      {value || placeholder || '—'}
    </div>
  )

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: r.left }
      if (window.innerHeight - r.bottom < 200) s.bottom = window.innerHeight - r.top + 4
      else s.top = r.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v)
  }

  return (
    <div ref={ref} className="relative">
      <div
        ref={btnRef}
        onClick={handleOpen}
        className={`cursor-pointer rounded px-2 py-0.5 text-xs font-semibold inline-flex items-center gap-1 hover:opacity-80 ${
          value ? (colorMap?.[value] ?? 'bg-gray-100 text-gray-600') : 'text-gray-300'
        }`}
      >
        {value || placeholder || '—'}
      </div>
      {open && (
        <div
          className={`rounded-xl border border-gray-200 bg-white shadow-lg py-1 ${
            options.length > 5 ? 'grid grid-cols-2 min-w-[200px]' : 'flex flex-col min-w-[120px]'
          }`}
          style={popupStyle}
        >
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => { onSave(opt); setOpen(false) }}
              className={`px-3 py-1.5 text-left text-xs hover:bg-gray-50 font-medium ${
                opt === value ? 'text-blue-600' : 'text-gray-700'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 다중 선택 모드 ─────────────────────────────────────
function MultiSelectCell({
  value,
  options,
  onSave,
  colorMap,
  readOnly,
  placeholder,
}: {
  value: string | null
  options: string[]
  onSave: (v: string) => void
  colorMap?: Record<string, string>
  readOnly?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({})
  const ref = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const selected = parseCsv(value)
  const commit = (next: string[]) => onSave(next.join(', '))

  const renderChips = (chips: string[], small?: boolean, allowRemove?: boolean) => (
    <>
      {chips.map(v => (
        <span key={v}
          className={`inline-flex items-center gap-1 rounded ${small ? 'px-1.5 py-0' : 'px-2 py-0.5'} text-xs font-semibold ${colorMap?.[v] ?? 'bg-gray-100 text-gray-600'}`}>
          {v}
          {allowRemove && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); commit(selected.filter(s => s !== v)) }}
              className="hover:bg-black/10 rounded-full leading-none"
              aria-label={`${v} 제거`}
            >
              <span className="inline-block px-0.5">×</span>
            </button>
          )}
        </span>
      ))}
    </>
  )

  if (readOnly) return (
    <div className="flex flex-wrap items-center gap-1">
      {selected.length > 0
        ? renderChips(selected)
        : <div className="rounded px-2 py-0.5 text-xs font-semibold bg-gray-50 text-gray-300">{placeholder || '—'}</div>
      }
    </div>
  )

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      const s: React.CSSProperties = { position: 'fixed', zIndex: 9999, left: r.left }
      if (window.innerHeight - r.bottom < 240) s.bottom = window.innerHeight - r.top + 4
      else s.top = r.bottom + 4
      setPopupStyle(s)
    }
    setOpen(v => !v)
  }

  return (
    <div ref={ref} className="relative">
      <div
        ref={btnRef}
        onClick={handleOpen}
        className="cursor-pointer min-h-[20px] flex flex-wrap items-center gap-1 hover:opacity-80"
      >
        {selected.length > 0
          ? renderChips(selected, false, true)
          : <span className="text-xs font-semibold text-gray-300">{placeholder || '—'}</span>
        }
      </div>
      {open && (
        <div
          className={`rounded-xl border border-gray-200 bg-white shadow-lg py-1 ${
            options.length > 5 ? 'grid grid-cols-2 min-w-[200px]' : 'flex flex-col min-w-[140px]'
          }`}
          style={popupStyle}
        >
          {options.map(opt => {
            const checked = selected.includes(opt)
            return (
              <button
                key={opt}
                onClick={() => {
                  const next = checked ? selected.filter(s => s !== opt) : [...selected, opt]
                  commit(next)
                  // 다중 모드는 닫지 않음 — 연달아 토글 가능
                }}
                className={`px-3 py-1.5 text-left text-xs hover:bg-gray-50 font-medium flex items-center gap-2 ${
                  checked ? 'text-blue-600' : 'text-gray-700'
                }`}
              >
                <span className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded border ${checked ? 'border-blue-500 bg-blue-500 text-white' : 'border-gray-300 bg-white'}`}>
                  {checked && <span className="text-[10px] leading-none">✓</span>}
                </span>
                {opt}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
