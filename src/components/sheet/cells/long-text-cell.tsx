'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
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
    // 편집을 시작하면 글 전체가 선택된다 — 그 상태에서 키 하나만 눌러도 메모가 통째로 지워져 저장됐다.
    // 내용이 있던 칸을 비워서 저장하려 하면 한 번 묻고, 아니라고 하면 원래 글로 되돌린다.
    if (draft.trim() === '' && (value ?? '').trim() !== '') {
      if (!window.confirm('내용을 모두 지울까요? (지우면 되돌릴 수 없어요)')) {
        setDraft(value ?? '')
        setEditing(false)
        return
      }
    }
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  // 쓰다가 다른 화면으로 가 버리면(주소창 이동·탭 닫기) blur 가 안 와서 글이 소리 없이 사라졌다.
  // 편집 중에 칸이 사라지거나 창이 닫히면 그때까지 쓴 것을 저장한다.
  const latest = useRef({ editing, draft, value, onSave })
  latest.current = { editing, draft, value, onSave }
  useEffect(() => {
    const flush = () => {
      const { editing, draft, value, onSave } = latest.current
      if (editing && draft !== (value ?? '')) onSave(draft)
    }
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); flush() }
  }, [])

  if (readOnly) return (
    <>
      <div
        ref={cellRef}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className={cn("w-full px-1 py-0.5 text-xs min-h-[22px] overflow-hidden text-ellipsis line-clamp-2 whitespace-pre-wrap break-words leading-snug", value ? "text-gray-700 dark:text-gray-200" : "text-gray-500 dark:text-gray-400")}
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
      className="w-full rounded border border-blue-400 bg-white dark:bg-gray-900 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-blue-300 resize-none"
    />
  )

  return (
    <>
      <div
        ref={cellRef}
        onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className={cn("w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 min-h-[22px] overflow-hidden text-ellipsis line-clamp-2 whitespace-pre-wrap break-words leading-snug", value ? "text-gray-700 dark:text-gray-200" : "text-gray-500 dark:text-gray-400")}
      >
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}
