'use client'

/**
 * 알림 권한 요청 프롬프트.
 * - 페이지 진입 시 자동 노출 X (거부 빈도 높음)
 * - 컴포넌트에 prop으로 표시 시점 제어
 * - 사용자가 클릭하면 브라우저 권한 요청 → 구독 → DB 저장
 */
import { useEffect, useState } from 'react'
import { Bell, BellOff, X } from 'lucide-react'
import { urlBase64ToUint8Array } from '@/lib/push'

interface Props {
  /** 트리거 메시지 (예: "새 제안 알림을 받아보세요") */
  message?: string
  /** 작게 보이는 인라인 버튼 모드 */
  inline?: boolean
  /** 닫혔는지 기억할 localStorage 키 */
  dismissKey?: string
}

type State = 'unsupported' | 'denied' | 'default' | 'granted' | 'subscribing'

export function PushPrompt({
  message = '새 메시지·제안 알림을 받으시려면 알림을 허용해주세요',
  inline = false,
  dismissKey = 'ppabang_push_dismissed',
}: Props) {
  const [state, setState] = useState<State>('default')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported'); return
    }
    setState(Notification.permission as State)
    if (localStorage.getItem(dismissKey) === '1') setDismissed(true)
  }, [dismissKey])

  const subscribe = async () => {
    setState('subscribing')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission as State)
        return
      }
      const reg = await navigator.serviceWorker.ready
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!publicKey) throw new Error('VAPID 공개키 누락')

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })

      const json = sub.toJSON()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      })
      if (!res.ok) throw new Error('서버 구독 등록 실패')
      setState('granted')
    } catch (e) {
      console.error('[push] subscribe failed', e)
      setState('default')
    }
  }

  const dismiss = () => {
    setDismissed(true)
    localStorage.setItem(dismissKey, '1')
  }

  if (state === 'unsupported') return null
  if (state === 'granted') return null
  if (dismissed) return null
  if (state === 'denied') return null  // 차단된 경우 브라우저 설정에서 해제해야 함

  if (inline) {
    return (
      <button onClick={subscribe} disabled={state === 'subscribing'}
        className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50">
        <Bell className="h-3.5 w-3.5" />
        {state === 'subscribing' ? '설정 중...' : '알림 받기'}
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-gray-200 bg-white shadow-xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
          <Bell className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 mb-0.5">알림 받기</p>
          <p className="text-xs text-gray-500 leading-relaxed">{message}</p>
          <div className="mt-3 flex gap-2">
            <button onClick={subscribe} disabled={state === 'subscribing'}
              className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold py-2 transition-colors disabled:opacity-50">
              {state === 'subscribing' ? '설정 중...' : '허용하기'}
            </button>
            <button onClick={dismiss}
              className="rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 text-xs font-semibold px-3 transition-colors">
              나중에
            </button>
          </div>
        </div>
        <button onClick={dismiss} className="text-gray-300 hover:text-gray-500 -mr-1 -mt-1">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** 현재 알림 권한 상태 (UI 헬퍼) */
export function NotificationStatusIcon() {
  const [granted, setGranted] = useState(false)
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setGranted(Notification.permission === 'granted')
    }
  }, [])
  return granted ? <Bell className="h-3.5 w-3.5 text-blue-500" /> : <BellOff className="h-3.5 w-3.5 text-gray-300" />
}
