'use client'

import { useEffect, useState } from 'react'
import { Download, X, Smartphone, Share } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'ppabang_install_dismissed_at'
const DISMISS_DAYS = 7

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // 이미 설치되어 standalone으로 실행 중이면 숨김
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true
    if (isStandalone) return

    // 최근에 닫혔으면 숨김
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt) {
      const daysSince = (Date.now() - Number(dismissedAt)) / (24 * 60 * 60 * 1000)
      if (daysSince < DISMISS_DAYS) return
    }

    // iOS Safari 감지 (beforeinstallprompt 미지원, 별도 안내 필요)
    const ua = navigator.userAgent
    const iOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
    if (iOS && isSafari) {
      setIsIOS(true)
      // iOS는 일정 지연 후 표시 (페이지 진입 즉시 X)
      const t = setTimeout(() => setShow(true), 8000)
      return () => clearTimeout(t)
    }

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      // 페이지 진입 즉시가 아니라 약간의 지연 후 표시
      setTimeout(() => setShow(true), 5000)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const installedHandler = () => {
      setShow(false)
      setDeferred(null)
    }
    window.addEventListener('appinstalled', installedHandler)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
      window.removeEventListener('appinstalled', installedHandler)
    }
  }, [])

  const install = async () => {
    if (!deferred) return
    setInstalling(true)
    await deferred.prompt()
    const choice = await deferred.userChoice
    setInstalling(false)
    setShow(false)
    setDeferred(null)
    if (choice.outcome === 'dismissed') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    }
  }

  const dismiss = () => {
    setShow(false)
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  if (!show) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md rounded-2xl border border-blue-200 bg-white dark:bg-gray-900 shadow-2xl p-4 md:bottom-6"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white">빠방 앱으로 설치하기</p>
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
            {isIOS
              ? <>홈 화면에 추가하면 빠르게 접속할 수 있어요</>
              : <>한 번 설치하면 앱처럼 빠르게 열고 푸시 알림도 받을 수 있어요</>
            }
          </p>

          {isIOS ? (
            <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-950 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                <Share className="h-3.5 w-3.5 text-blue-500" /> 아래 공유 버튼
                <span className="text-gray-400">→</span>
                "홈 화면에 추가"
              </p>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button onClick={install} disabled={installing}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 transition-colors disabled:opacity-50">
                <Download className="h-3.5 w-3.5" />
                {installing ? '설치 중...' : '설치하기'}
              </button>
              <button onClick={dismiss}
                className="rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 text-gray-600 dark:text-gray-400 text-xs font-semibold px-3 transition-colors">
                나중에
              </button>
            </div>
          )}
        </div>
        <button onClick={dismiss} className="text-gray-300 hover:text-gray-500 -mr-1 -mt-1" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
