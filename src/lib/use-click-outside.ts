'use client'

import { useEffect } from 'react'

/**
 * ref가 가리키는 요소 바깥을 클릭하면 콜백 실행.
 * 시트형 페이지(매물·고객·일지)에서 드롭다운/팝오버 닫기에 사용.
 */
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  cb: () => void,
) {
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ref, cb])
}
