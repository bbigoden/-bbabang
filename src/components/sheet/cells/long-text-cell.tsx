'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { CellTooltip } from './cell-tooltip'

/**
 * 긴 텍스트(메모/설명) 셀.
 * - 한 줄로만 표시되고 ...으로 잘림 + hover 시 툴팁으로 전체 보임
 * - 편집은 칸 위에 넓게 띄운 textarea — 글 길이만큼 늘어나 스크롤 없이 한눈에 보인다
 * - Escape로 취소, blur로 저장
 */
export function LongTextCell({
  value,
  onSave,
  placeholder = '—',
  readOnly,
  maxLength = 2000,
}: {
  value: string | null
  onSave: (v: string) => void
  placeholder?: string
  readOnly?: boolean
  /**
   * 칸에 들어가는 최대 글자 수(저장하는 쪽 검사와 같은 값). 넘겨 쓴 뒤 저장이 거절되면 편집칸이 이미 닫혀
   * 쓴 글이 통째로 사라졌다(10-30 점검: 메모 2,811자) — 애초에 넘겨 쓰지 못하게 막고 남은 글자 수를 보여 준다.
   */
  maxLength?: number
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

  // 편집창은 글 길이만큼 늘린다 — 세 줄 칸에서 위아래로 굴려 가며 고치기 불편했다(11-06).
  // 화면 높이의 70% 를 넘을 만큼 길면 그때만 창 안에서 스크롤.
  useLayoutEffect(() => {
    if (editing && textareaRef.current) fitTextarea(textareaRef.current)
  }, [editing, draft])

  const commit = () => {
    // 편집을 시작하면 글 전체가 선택된다 — 그 상태에서 키 하나만 눌러도 메모가 통째로 지워져 저장됐다.
    // 내용이 있던 칸을 비워서 저장하려 하면 한 번 묻고, 아니라고 하면 원래 글로 되돌린다.
    if (draft.trim() === '' && (value ?? '').trim() !== '') {
      if (!window.confirm('내용을 모두 삭제할까요? (삭제하면 되돌릴 수 없어요)')) {
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
      if (!editing || draft === (value ?? '')) return
      // 내용이 있던 칸을 전부 지운 채 떠나는 경우는 저장하지 않는다 — 여기서는 확인창을 띄울 수 없어
      // 그대로 저장하면 삭제 확인을 건너뛰고 메모가 지워진다. 원래 글이 남는다.
      if (draft.trim() === '' && (value ?? '').trim() !== '') return
      onSave(draft)
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
        className={cn("w-full px-1 py-0.5 text-xs min-h-[22px] overflow-hidden text-ellipsis line-clamp-2 whitespace-pre-wrap break-words leading-snug", value ? "text-gray-700 dark:text-gray-200" : "text-gray-400 dark:text-gray-500")}
      >
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )

  if (editing) return (
    <>
      {/* 칸은 그대로 두고(표 줄 높이가 출렁이지 않게) 편집창은 칸 위에 넓게 띄운다 */}
      <div
        ref={cellRef}
        className="w-full rounded px-1 py-0.5 text-xs min-h-[22px] overflow-hidden line-clamp-2 whitespace-pre-wrap break-words leading-snug text-gray-300 dark:text-gray-600"
      >
        {value || placeholder}
      </div>
      <FloatingEditor anchorRef={cellRef}>
        <textarea
          ref={textareaRef}
          value={draft}
          maxLength={maxLength}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false) }
          }}
          className="block w-full rounded-lg border border-blue-400 bg-white dark:bg-gray-900 px-2.5 py-2 text-xs leading-relaxed text-gray-800 dark:text-gray-100 shadow-xl outline-none focus:ring-2 focus:ring-blue-300 resize-none overflow-y-auto"
        />
        {draft.length > maxLength * 0.8 && (
          <p className={cn('mt-0.5 rounded bg-white/90 px-1 text-right text-[10px] dark:bg-gray-900/90', draft.length >= maxLength ? 'font-semibold text-red-500' : 'text-gray-400')}>
            {draft.length.toLocaleString('ko-KR')}/{maxLength.toLocaleString('ko-KR')}자
          </p>
        )}
      </FloatingEditor>
    </>
  )

  return (
    <>
      <div
        ref={cellRef}
        onClick={() => { setDraft(value ?? ''); setEditing(true); setHovered(false) }}
        onMouseEnter={() => { if (value) setHovered(true) }}
        onMouseLeave={() => setHovered(false)}
        className={cn("w-full cursor-pointer rounded px-1 py-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800 min-h-[22px] overflow-hidden text-ellipsis line-clamp-2 whitespace-pre-wrap break-words leading-snug", value ? "text-gray-700 dark:text-gray-200" : "text-gray-400 dark:text-gray-500")}
      >
        {value || placeholder}
      </div>
      {hovered && value && <CellTooltip text={value} anchorRef={cellRef} />}
    </>
  )
}

/** 글 높이에 맞춘다. 화면 높이의 70% 까지만 — 그보다 길면 창 안에서 굴린다. */
function fitTextarea(t: HTMLTextAreaElement) {
  t.style.height = 'auto'
  t.style.height = `${Math.min(Math.max(t.scrollHeight + 2, 60), Math.round(window.innerHeight * 0.7))}px`
}

/**
 * 편집창을 칸 위에 띄운다. 칸 너비가 좁아도(메모 240px) 최소 400px 로 넓히고,
 * 화면 아래로 넘치면 위로 올린다. 표를 굴리면 칸을 따라간다.
 */
function FloatingEditor({ anchorRef, children }: { anchorRef: React.RefObject<HTMLElement | null>; children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null)
  // 자리 잡기 전엔 투명하게만 둔다 — visibility:hidden 이면 focus 가 안 들어가 Esc·입력이 먹지 않았다
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', zIndex: 9999, top: 0, left: 0, width: 400, opacity: 0 })

  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current, box = boxRef.current
      if (!a || !box) return
      const r = a.getBoundingClientRect()
      const vw = Math.min(window.innerWidth, document.documentElement.clientWidth)
      const vh = window.innerHeight
      const width = Math.min(Math.max(r.width + 8, 400), vw - 16)
      const left = Math.max(8, Math.min(r.left - 4, vw - width - 8))
      // 너비가 정해진 뒤에 높이를 다시 잰다(좁을 때 잰 높이는 줄바꿈이 많아 너무 컸다)
      box.style.width = `${width}px`
      const t = box.querySelector('textarea')
      if (t) fitTextarea(t)
      const h = box.offsetHeight
      const top = Math.max(8, Math.min(r.top - 4, vh - h - 8))
      setStyle({ position: 'fixed', zIndex: 9999, left, top, width })
    }
    place()
    const ro = new ResizeObserver(place)
    if (boxRef.current) ro.observe(boxRef.current)
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { ro.disconnect(); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [anchorRef])

  return createPortal(<div ref={boxRef} style={style}>{children}</div>, document.body)
}
