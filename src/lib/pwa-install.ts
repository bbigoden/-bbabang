'use client'

import { useEffect, useState } from 'react'

/**
 * 홈 화면 앱(PWA) 설치 도우미 — 설치 안내 창과 /install 화면이 같이 쓴다.
 *
 * 크롬은 'beforeinstallprompt' 를 페이지가 열리자마자 한 번만 던진다. 설치 안내 창은 늦게
 * 받아 오는 덩어리(LazyOverlays)라 그때 붙이면 이미 지나가 버려 [설치하기]가 안 떴다.
 * 그래서 첫 화면에 바로 붙는 ServiceWorkerRegister 가 captureInstallPrompt() 로 일찍 잡아 둔다.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

export function captureInstallPrompt() {
  if (typeof window === 'undefined' || (window as { __bspInstall?: boolean }).__bspInstall) return
  ;(window as { __bspInstall?: boolean }).__bspInstall = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    notify()
  })
}

export function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches
    || (window.navigator as { standalone?: boolean }).standalone === true
}

/**
 * 지금 브라우저에서 설치하는 길.
 * - installed: 이미 홈 화면 앱으로 열림
 * - kakao / inapp: 카톡·네이버앱 등 앱 안 브라우저 — 여기서는 설치가 안 돼 바깥 브라우저로 내보내야 한다
 * - ios: 사파리 공유 버튼 → 홈 화면에 추가 (자동 설치창이 없다)
 * - prompt: 크롬·삼성인터넷 — 버튼 한 번으로 설치창
 * - manual: 설치창이 아직 안 온 안드로이드·PC — 브라우저 메뉴에서 '앱 설치'
 */
export type InstallPath = 'installed' | 'kakao' | 'inapp' | 'ios' | 'prompt' | 'manual'

export function detectInstallPath(): InstallPath {
  if (installed || isStandaloneApp()) return 'installed'
  const ua = navigator.userAgent
  if (/KAKAOTALK/i.test(ua)) return 'kakao'
  if (/NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|BAND\//i.test(ua)) return 'inapp'
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  if (deferred) return 'prompt'
  return 'manual'
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
}

/** 앱 안 브라우저에서 지금 주소를 바깥 브라우저(크롬·사파리)로 연다 */
export function openInExternalBrowser(url = window.location.href) {
  if (/KAKAOTALK/i.test(navigator.userAgent)) {
    // 카카오가 공식으로 열어 둔 '기본 브라우저로 열기' 주소
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`
    return
  }
  if (isAndroid()) {
    const u = new URL(url)
    window.location.href = `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=https;package=com.android.chrome;end`
  }
  // iOS 의 다른 앱 안 브라우저는 밖으로 여는 길이 없다 — 화면 안내(… → Safari로 열기)를 따른다
}

/** 설치창 띄우기. 띄울 수 없으면 false */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | false> {
  if (!deferred) return false
  const ev = deferred
  await ev.prompt()
  const choice = await ev.userChoice
  deferred = null
  notify()
  return choice.outcome
}

/** 설치 길이 바뀌면(설치창 도착·설치 완료) 다시 그린다 */
export function useInstallPath(): InstallPath | null {
  const [path, setPath] = useState<InstallPath | null>(null)
  useEffect(() => {
    captureInstallPrompt()
    const update = () => setPath(detectInstallPath())
    update()
    listeners.add(update)
    return () => { listeners.delete(update) }
  }, [])
  return path
}
