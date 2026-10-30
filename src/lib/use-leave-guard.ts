'use client'

import { useEffect, useRef } from 'react'

export const LEAVE_MESSAGE = '저장하지 않은 내용이 있어요. 지금 나가면 사라집니다. 나갈까요?'

/**
 * 저장 안 한 변경이 있을 때 화면을 떠나기 전에 묻는다.
 *
 * beforeunload 는 새로고침·창 닫기만 잡는다. 앱 안 '뒤로 가기'와 사이드바 링크는 페이지가
 * 바뀌지 않아 그냥 지나가, 견적서에 쓰던 내용이 경고 없이 통째로 사라졌다(2026-10-30 점검).
 *  - 뒤로 가기: 같은 주소로 기록을 한 칸 쌓아 두고, 그 칸이 빠지면(popstate) 묻는다
 *  - 앱 안 링크: 누르는 순간(capture) 묻고, 머물기면 이동을 막는다
 */
export function useLeaveGuard(active: boolean, message = LEAVE_MESSAGE) {
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!active) return
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.history.pushState({ ...window.history.state, __leaveGuard: true }, '')
    const onPop = () => {
      if (!activeRef.current) return
      if (window.confirm(message)) { activeRef.current = false; window.history.back() }
      else window.history.pushState({ ...window.history.state, __leaveGuard: true }, '')
    }
    const onClick = (e: MouseEvent) => {
      if (!activeRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      if (window.confirm(message)) activeRef.current = false
      else { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('popstate', onPop)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('click', onClick, true)
    }
  }, [active, message])

  // 저장해서 변경이 없어지면 쌓아 둔 한 칸을 걷는다 — 남겨 두면 다음 뒤로 가기 한 번이 헛돈다.
  // (화면을 떠나며 언마운트될 때는 이 effect 가 돌지 않는다)
  useEffect(() => {
    if (!active && window.history.state?.__leaveGuard) window.history.back()
  }, [active])
}
