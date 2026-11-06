'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { captureInstallPrompt } from '@/lib/pwa-install'

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? ''
/** 앱으로 돌아올 때마다 묻되, 너무 잦지 않게 */
const CHECK_GAP_MS = 60 * 1000

/**
 * Service Worker 등록 컴포넌트.
 * 루트 layout에 한 번만 마운트하면 모든 페이지에서 SW가 활성화됨.
 * - production에서만 등록 (dev에선 HMR 충돌 방지)
 * - 새 SW로 갱신되면 자동 reload (배포 직후 옛 캐시로 인한 빈 화면 방지)
 * - 새 배포가 나오면 알아서 새로 고친다(11-06 사장님 — '업데이트' 버튼을 누르게 하던 것을 없앰).
 *   폰 앱은 닫지 않고 바탕에 두었다 다시 꺼내 쓰므로 새로 고칠 일이 없어 며칠씩 옛 화면이 남았다.
 *   sw.js 는 배포마다 바뀌지 않아 SW 갱신으로는 못 잡고 /api/version 을 묻는다.
 *   쓰던 글이 날아가면 안 되므로 새로 고치는 때는 둘뿐이다:
 *     · 다른 화면으로 넘어갈 때 — 어차피 지금 화면을 떠나는 순간
 *     · 앱을 다시 꺼냈을 때, 이 화면에서 아무것도 입력하지 않았다면
 *   입력한 적이 있으면(모달에 쓰다 만 매물 등록 등) 다음 화면 이동까지 기다린다.
 */
export function ServiceWorkerRegister() {
  const router = useRouter()
  const pathname = usePathname()
  const pendingRef = useRef(false)
  /** 이 화면에 들어온 뒤 뭔가 입력했는지 — 했으면 바탕에서 돌아와도 바로 새로 고치지 않는다 */
  const typedRef = useRef(false)

  // 화면 이동 = 새로 고쳐도 잃을 게 없는 때. 새 버전이 기다리고 있으면 새 화면을 처음부터 받는다
  const firstPathRef = useRef(true)
  useEffect(() => {
    if (firstPathRef.current) { firstPathRef.current = false; return }
    typedRef.current = false
    if (pendingRef.current) window.location.reload()
  }, [pathname])

  useEffect(() => {
    const onInput = () => { typedRef.current = true }
    document.addEventListener('input', onInput, true)
    return () => document.removeEventListener('input', onInput, true)
  }, [])

  // 알림을 눌렀을 때 SW 가 보내는 주소로 옮긴다. 같은 화면(메시지)이면 화면에 알려 방만 바꾼다
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null
      if (d?.type !== 'open-url' || !d.url) return
      const to = new URL(d.url, location.origin)
      if (to.origin !== location.origin) return
      if (to.pathname === location.pathname) window.dispatchEvent(new CustomEvent('push-open', { detail: to.search }))
      else router.push(to.pathname + to.search)
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [router])

  useEffect(() => {
    if (typeof window === 'undefined') return
    // 설치창 이벤트는 첫 화면에 바로 오므로 늦게 붙는 설치 안내 대신 여기서 잡아 둔다
    captureInstallPrompt()
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    // 리로드는 '옛 SW가 이 탭을 쥐고 있다가 새 SW로 바뀔 때'만 한다.
    // 첫 방문엔 controller가 없는데, activate의 clients.claim()이 이때도 controllerchange를
    // 일으킨다. 그걸 갱신으로 보고 리로드하면 가입·요청 폼을 쓰던 중에 입력이 날아가고
    // 첫 화면을 두 번 받는다. 첫 claim은 '이제 SW가 붙었다'로만 기록하고 넘긴다.
    // (옛 SW가 붙은 탭은 새 SW가 활성화되는 순간 claim 없이도 controllerchange가 오므로
    //  updatefound 쪽을 따로 볼 필요가 없다)
    let controlled = !!navigator.serviceWorker.controller
    let reloaded = false
    const onControllerChange = () => {
      if (!controlled) { controlled = true; return }
      if (reloaded) return
      reloaded = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    let reg: ServiceWorkerRegistration | null = null
    let lastCheck = 0
    const check = async () => {
      if (Date.now() - lastCheck < CHECK_GAP_MS) return
      lastCheck = Date.now()
      reg?.update().catch(() => {})
      if (!BUILD_ID) return
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        const { id } = await res.json() as { id?: string }
        if (!id || id === BUILD_ID) return
        pendingRef.current = true
        if (canReloadNow()) window.location.reload()
      } catch { /* 오프라인 등 — 다음에 다시 */ }
    }
    // 지금 새로 고쳐도 되나 — 보고 있고, 입력 중이 아니고, 이 화면에서 입력한 적도 없을 때
    const canReloadNow = () => {
      if (document.visibilityState !== 'visible' || typedRef.current) return false
      const a = document.activeElement as HTMLElement | null
      return !(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)))
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (pendingRef.current && canReloadNow()) { window.location.reload(); return }
      check()
    }
    document.addEventListener('visibilitychange', onVisible)
    // 바탕에 안 가고 계속 켜 둔 PC 화면을 위해 30분마다도
    const timer = setInterval(check, 30 * 60 * 1000)

    const register = async () => {
      try {
        reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      } catch {
        // SW 등록 실패는 무시 (사용자에 영향 없음)
      }
    }
    register()

    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [])

  return null
}
