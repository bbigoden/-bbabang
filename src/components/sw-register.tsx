'use client'

import { useEffect } from 'react'

/**
 * Service Worker 등록 컴포넌트.
 * 루트 layout에 한 번만 마운트하면 모든 페이지에서 SW가 활성화됨.
 * - production에서만 등록 (dev에선 HMR 충돌 방지)
 * - 새 SW로 갱신되면 자동 reload (배포 직후 옛 캐시로 인한 빈 화면 방지)
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
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

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        // 1시간마다 업데이트 체크 (PWA를 오래 띄워둔 경우)
        setInterval(() => { reg.update().catch(() => {}) }, 60 * 60 * 1000)
      } catch {
        // SW 등록 실패는 무시 (사용자에 영향 없음)
      }
    }
    register()
  }, [])

  return null
}
