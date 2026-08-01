// Service Worker for 부소장 PWA
// 원칙: SW는 정적 자원·이미지 캐싱만 담당. 페이지·API·DB 호출은 가로채지 않는다.
// - /_next/static/* : CacheFirst (불변 해시)
// - 정적 자원(아이콘·manifest) : CacheFirst
// - Supabase /storage/ 이미지 : StaleWhileRevalidate
// - 그 외(HTML, /api/*, supabase rest) : SW 패스스루 (브라우저 기본 처리)
// - navigate 요청 실패 시에만 offline.html fallback
// - 푸시 알림 / 클릭 처리

const VERSION = 'busojang-v2'
const STATIC_CACHE = `${VERSION}-static`
const IMAGE_CACHE = `${VERSION}-images`
const OFFLINE_URL = '/offline.html'

const PRECACHE = [
  '/offline.html',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.ico',
  '/manifest.webmanifest',
]

// ── 설치: 사전 캐시 ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  )
  self.skipWaiting()
})

// ── 활성화: 옛 버전 캐시 정리 ────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

// ── fetch 가로채기 (최소화) ───────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  // 1) Supabase Storage 이미지만 캐시 (다른 supabase 호출은 통과)
  if (url.hostname.includes('supabase.co')) {
    if (url.pathname.includes('/storage/')) {
      event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    }
    return
  }

  // 2) 그 외 외부 도메인 (Kakao API 등): 통과
  if (!sameOrigin) return

  // 3) Next.js 해시 정적 자원: CacheFirst
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // 4) 사전 캐시 정적 자원: CacheFirst
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // 5) navigate(HTML) 요청은 정상 fetch + 실패 시 오프라인 fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then(r => r || new Response('Offline', { status: 503 })))
    )
    return
  }

  // 6) 그 외 (페이지 chunk, /api/*, 동적 자원): SW 미관여 (브라우저 기본)
})

// ── 캐시 전략 ────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const res = await fetch(request)
    if (res.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, res.clone())
    }
    return res
  } catch {
    return new Response('', { status: 504 })
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request)
    .then((res) => { if (res.ok) cache.put(request, res.clone()); return res })
    .catch(() => cached)
  return cached || fetchPromise
}

// ── 푸시 알림 수신 ───────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: '부소장', body: '새 알림이 있어요', url: '/' }
  try { if (event.data) data = { ...data, ...event.data.json() } } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
      tag: data.tag,
      requireInteraction: false,
    })
  )
})

// ── 알림 클릭 시 페이지 열기 ──────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      for (const c of cs) {
        if (c.url.includes(url) && 'focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
