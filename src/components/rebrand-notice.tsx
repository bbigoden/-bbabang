'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X, Share } from 'lucide-react'

const DISMISS_KEY = 'busojang_rebrand_dismissed'

/**
 * 빠방 → 부소장 리브랜딩 안내 (2026-08).
 * 홈 화면 아이콘·이름은 재설치해야 바뀌므로, 이미 설치된 PWA(standalone)
 * 사용자에게만 1회 안내한다. 브라우저 사용자는 새 이름이 그냥 보이므로 대상 아님.
 * 전환기가 지나면 컴포넌트째 제거할 것.
 */
export function RebrandNotice() {
  const [show, setShow] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true
    if (!isStandalone) return
    if (localStorage.getItem(DISMISS_KEY)) return
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream)
    const t = setTimeout(() => setShow(true), 3000)
    return () => clearTimeout(t)
  }, [])

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
          <Sparkles className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white">빠방이 &lsquo;부소장&rsquo;이 됐어요</p>
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
            이름과 아이콘이 새로 바뀌었어요. 기능과 데이터는 그대로예요.
          </p>
          <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-950 p-2.5">
            {isIOS ? (
              <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 leading-relaxed">
                홈 화면의 새 이름·아이콘은 재설치가 필요해요:<br />
                기존 앱 삭제 → Safari로 재접속 →{' '}
                <Share className="inline h-3.5 w-3.5 text-blue-500 align-[-2px]" /> 공유 → &quot;홈 화면에 추가&quot;
              </p>
            ) : (
              <p className="text-[11px] font-semibold text-gray-700 dark:text-gray-300 leading-relaxed">
                홈 화면 이름·아이콘은 시간이 지나면 자동으로 바뀌어요.
                바로 바꾸려면 앱을 삭제 후 다시 설치해 주세요.
              </p>
            )}
          </div>
          <button onClick={dismiss}
            className="mt-3 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 transition-colors">
            확인했어요
          </button>
        </div>
        <button onClick={dismiss} className="text-gray-300 hover:text-gray-500 -mr-1 -mt-1" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
