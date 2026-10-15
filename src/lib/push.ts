/**
 * Web Push 공통 유틸 (클라이언트·서버 공용).
 */

/** base64 URL → Uint8Array (PushManager.subscribe에 필요한 형식) */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

// ── 아래는 브라우저 전용 ─────────────────────────────

/**
 * 이 기기의 브라우저 푸시 구독. 서비스워커가 없거나 푸시를 지원하지 않으면 null.
 * serviceWorker.ready 는 등록된 SW 가 없으면 영영 끝나지 않아 getRegistration 을 쓴다.
 */
async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

/**
 * 로그아웃 직전에(세션이 살아 있을 때) 이 기기 구독 행을 내 계정에서 뗀다.
 * 안 떼면 같은 기기에서 다른 사람이 로그인해도 이전 사람의 알림(채팅 미리보기 등)이 계속 떴다.
 * 브라우저 구독은 그대로 둔다 — 해제하면 권한은 granted 로 남아 알림 프롬프트가 숨은 채
 * 다시 구독할 길이 없어진다. 다음 로그인 때 claimPushSubscription 이 같은 구독을 다시 붙인다.
 * keepalive: 곧바로 페이지를 떠나도 요청이 끊기지 않게.
 */
export async function releasePushSubscription(): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: 'DELETE', keepalive: true })
}

/**
 * 로그인한 사람에게 이 기기의 기존 구독을 다시 붙인다.
 * 로그아웃 때 DB 행만 떼므로, 이게 없으면 다시 로그인해도 설정 화면은 '켜짐'인데 알림은 안 왔다.
 */
export async function claimPushSubscription(): Promise<void> {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const sub = await currentSubscription()
  if (!sub) return
  const json = sub.toJSON()
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent }),
    keepalive: true,
  })
}
