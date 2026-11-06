import { useEffect, useRef } from 'react'

/**
 * 창(모달)이 열려 있는 동안 Esc 로 닫는다. 2026-11-06 점검에서 고객 등록·예약 창이 Esc 로
 * 안 닫혀 '급한 사용자' 가 거기서 나갔다.
 */
export function useEscape(active: boolean, onClose: () => void) {
  const cb = useRef(onClose)
  useEffect(() => { cb.current = onClose })
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) cb.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}
