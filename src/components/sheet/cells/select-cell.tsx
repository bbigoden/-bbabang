'use client'

import { useRef, useState } from 'react'
import { useClickOutside } from '@/lib/use-click-outside'

/**
 * 옵션 선택 셀.
 * - 클릭: 옵션 드롭다운 열기, 옵션 선택 시 즉시 저장 + 닫힘
 * - 옵션 6개 이상: 자동 2열 그리드
 * - colorMap: 옵션별 배경/글자 색 매핑 (예: 매매=파랑, 전세=보라)
 * - placeholder: 빈 값일 때 표시할 라벨 (회색)
 * - readOnly: 편집 불가, 표시만
 */
export function SelectCell({
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
