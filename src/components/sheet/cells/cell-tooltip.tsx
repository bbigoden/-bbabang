'use client'

import { useEffect, useState } from 'react'

/**
 * 셀에 마우스를 올렸을 때 전체 내용을 보여주는 툴팁.
 * 잘린 텍스트(...)를 hover 시 확인할 수 있게 한다.
 */
export function CellTooltip({
  text,
  anchorRef,
}: {
  text: string
  anchorRef: React.RefObject<HTMLElement | null>
}) {
  const [style, setStyle] = useState<React.CSSProperties>({})

  useEffect(() => {
    if (!anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    const s: React.CSSProperties = {
      position: 'fixed',
      zIndex: 9999,
      top: r.bottom + 4,
      maxWidth: 320,
      minWidth: 120,
    }
    if (r.left + 320 > window.innerWidth) s.right = window.innerWidth - r.right
    else s.left = r.left
    setStyle(s)
  }, [anchorRef])

  return (
    <div
      className="pointer-events-none rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 py-2 text-xs text-gray-700 dark:text-gray-300 shadow-xl leading-relaxed whitespace-pre-wrap"
      style={style}
    >
      {text}
    </div>
  )
}
