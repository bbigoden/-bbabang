'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Download, X, Smartphone, Share, ExternalLink } from 'lucide-react'
import { useInstallPath, promptInstall, openInExternalBrowser, isAndroid } from '@/lib/pwa-install'

const DISMISS_KEY = 'ppabang_install_dismissed_at'
const DISMISS_DAYS = 7

export function InstallPrompt() {
  const path = useInstallPath()
  const pathname = usePathname()
  const [show, setShow] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (!path || path === 'installed' || path === 'manual') { setShow(false); return }

    // 최근에 닫혔으면 숨김
    const dismissedAt = localStorage.getItem(DISMISS_KEY)
    if (dismissedAt) {
      const daysSince = (Date.now() - Number(dismissedAt)) / (24 * 60 * 60 * 1000)
      if (daysSince < DISMISS_DAYS) return
    }

    // 페이지 진입 즉시가 아니라 약간의 지연 후 표시
    const t = setTimeout(() => setShow(true), path === 'prompt' ? 5000 : 8000)
    return () => clearTimeout(t)
  }, [path])

  const install = async () => {
    setInstalling(true)
    const outcome = await promptInstall()
    setInstalling(false)
    setShow(false)
    if (outcome === 'dismissed') localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  const dismiss = () => {
    setShow(false)
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  }

  // /install 화면은 같은 안내를 크게 보여 준다
  // 손님용 예약 페이지(/b/)엔 '부소장 앱 설치'를 띄우지 않는다
  if (!show || !path || pathname === '/install' || pathname?.startsWith('/b/')) return null
  const inApp = path === 'kakao' || path === 'inapp'
  // iOS 의 카톡 밖 앱 안 브라우저는 밖으로 여는 길이 없어 안내만 한다
  const canOpenOut = path === 'kakao' || (path === 'inapp' && isAndroid())

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-md rounded-2xl border border-blue-200 bg-white dark:bg-gray-900 shadow-2xl p-4 md:bottom-6"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
          <Smartphone className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-white">부소장 앱으로 설치하기</p>
          <p className="mt-0.5 text-xs text-gray-500 leading-relaxed">
            {inApp
              ? <>{path === 'kakao' ? '카카오톡' : '이 앱'} 안에서는 설치가 안 돼요. {canOpenOut ? '브라우저로 열어 설치해 주세요' : '오른쪽 아래 … → "Safari로 열기" 후 설치해 주세요'}</>
              : path === 'ios'
                ? <>홈 화면에 추가하면 앱처럼 열리고 메세지 알림도 받아요</>
                : <>한 번 설치하면 앱처럼 빠르게 열고 메세지 알림도 받을 수 있어요</>
            }
          </p>

          {path === 'ios' ? (
            <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-950 p-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
                주소창 옆 … <span className="text-gray-500">→</span> <Share className="h-3.5 w-3.5 text-blue-500" /> 공유
                <span className="text-gray-500">→</span>
                &quot;홈 화면에 추가&quot;
              </p>
              <Link href="/install" className="mt-1 inline-block text-[11px] font-semibold text-blue-600 underline">그림으로 보기</Link>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              {inApp ? (
                canOpenOut && (
                  <button onClick={() => openInExternalBrowser()}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 transition-colors">
                    <ExternalLink className="h-3.5 w-3.5" />
                    브라우저로 열기
                  </button>
                )
              ) : (
                <button onClick={install} disabled={installing}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 transition-colors disabled:opacity-50">
                  <Download className="h-3.5 w-3.5" />
                  {installing ? '설치 중...' : '설치하기'}
                </button>
              )}
              <button onClick={dismiss}
                className="rounded-lg border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950 text-gray-600 dark:text-gray-500 text-xs font-semibold px-3 transition-colors">
                나중에
              </button>
            </div>
          )}
        </div>
        <button onClick={dismiss} className="-mr-3.5 -mt-3.5 flex h-11 w-11 flex-shrink-0 items-center justify-center text-gray-300 hover:text-gray-500" aria-label="닫기">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
