'use client'

import { useEffect, useRef, useState } from 'react'
import { CellTooltip } from './cell-tooltip'

/**
 * 인라인 텍스트 편집 셀.
 * - 클릭: 편집 모드, Enter 또는 blur로 저장, Escape로 취소
 * - 빈 값: placeholder 표시 (회색)
 * - 칸 넘어가는 텍스트: `...`으로 잘림 + hover 시 툴팁으로 전체 보임
 * - readOnly: 편집 불가, 표시만
 */
export function TextCell({
  value,
  onSave,
  placeholder = '—',
  readOnly,
}: {
  value: string | null
  onSave: (v: string) => void
  placeholder?: string
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [hovered, setHovered] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  if (readOnly) return (
    <div
      className="w-full px-1 py-0.5 text-xs min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
      style={{ color: value ? '#374151' : '#d1d5db' }}
    >
      {value || placeholder}
    </div>
  )

  if (editing) return (
    <input
      ref={inputRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
      }}
      className="w-full rounded border border-blue-400 bg-white px-2 py-0.5 text-xs outline-none focus:ring-2 focus:ring-blue-300"
    />
  )

  return (
    <>
      <div
        ref={cellRef}
        onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-blue-50 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db' }}
      >
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}
