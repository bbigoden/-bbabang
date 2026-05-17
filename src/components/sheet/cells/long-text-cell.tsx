'use client'

import { useEffect, useRef, useState } from 'react'
import { CellTooltip } from './cell-tooltip'

/**
 * 긴 텍스트(메모/설명) 셀.
 * - 한 줄로만 표시되고 ...으로 잘림 + hover 시 툴팁으로 전체 보임
 * - 편집은 textarea (여러 줄 입력 가능)
 * - Escape로 취소, blur로 저장
 */
export function LongTextCell({
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing) {
      textareaRef.current?.focus()
      textareaRef.current?.select()
    }
  }, [editing])

  const commit = () => {
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  if (readOnly) return (
    <>
      <div
        ref={cellRef}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className="w-full px-1 py-0.5 text-xs min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db' }}
      >
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )

  if (editing) return (
    <textarea
      ref={textareaRef}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
      }}
      rows={3}
      className="w-full rounded border border-blue-400 bg-white px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300 resize-none"
    />
  )

  return (
    <>
      <div
        ref={cellRef}
        onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className="w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-gray-100 min-h-[22px] overflow-hidden whitespace-nowrap text-ellipsis"
        style={{ color: value ? '#374151' : '#d1d5db' }}
      >
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}
