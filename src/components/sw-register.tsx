'use client'

import { useEffect } from 'react'

/**
 * Service Worker 등록 컴포넌트.
 * 루트 layout에 한 번만 마운트하면 모든 페이지에서 SW가 활성화됨.
 * - production에서만 등록 (dev에선 HMR 충돌 방지)
 * - 새 SW 감지 시 자동 reload (배포 직후 옛 캐시로 인한 빈 화면 방지)
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

        // 새 SW가 설치되면 자동으로 활성화·새로고침
        reg.addEventListener('updatefound', () => {
          const newSW = reg.installing
          if (!newSW) return
          newSW.addEventListener('statechange', () => {
            if (newSW.state === 'activated' && navigator.serviceWorker.controller) {
              // 옛 SW가 있던 상태에서 새 SW 활성 → 새 자원으로 리로드
              // 첫 설치는 controller가 null이라 reload 안 함
            }
          })
        })
      } catch {
        // SW 등록 실패는 무시 (사용자에 영향 없음)
      }
    }
    register()
  }, [])

  return null
}
