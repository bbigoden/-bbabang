'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { captureInstallPrompt } from '@/lib/pwa-install'

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? ''
/** 앱으로 돌아올 때마다 묻되, 너무 잦지 않게 */
const CHECK_GAP_MS = 60 * 1000

/**
 * Service Worker 등록 컴포넌트.
 * 루트 layout에 한 번만 마운트하면 모든 페이지에서 SW가 활성화됨.
 * - production에서만 등록 (dev에선 HMR 충돌 방지)
 * - 새 SW로 갱신되면 자동 reload (배포 직후 옛 캐시로 인한 빈 화면 방지)
 * - 새 배포가 나오면 '새 버전' 안내 — 폰 앱은 닫지 않고 바탕에 두었다 다시 꺼내 쓰므로
 *   새로 고칠 일이 없어 며칠씩 옛 화면이 남았다. sw.js 는 배포마다 바뀌지 않아 SW 갱신으로는 못 잡는다.
 */
export function ServiceWorkerRegister() {
  const [updateReady, setUpdateReady] = useState(false)
  const router = useRouter()

  // 알림을 눌렀을 때 SW 가 보내는 주소로 옮긴다. 같은 화면(메세지)이면 화면에 알려 방만 바꾼다
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
        if (id && id !== BUILD_ID) setUpdateReady(true)
      } catch { /* 오프라인 등 — 다음에 다시 */ }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
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

  if (!updateReady) return null
  return (
    <div className="fixed left-1/2 top-3 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2"
      style={{ marginTop: 'env(safe-area-inset-top)' }} role="status">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="flex w-full items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 text-left text-white shadow-2xl dark:bg-white dark:text-gray-900"
      >
        <RefreshCw className="h-5 w-5 flex-shrink-0" />
        <span className="flex-1 text-sm font-semibold">새 버전이 나왔어요</span>
        <span className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">업데이트</span>
      </button>
    </div>
  )
}
