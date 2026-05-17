// Service Worker for 빠방 PWA
// - 정적 자원 (JS/CSS/이미지): CacheFirst
// - 매물 사진 (Supabase Storage): StaleWhileRevalidate
// - 페이지/API: NetworkFirst (실패 시 캐시·오프라인 페이지)
// - 푸시 알림 처리

const VERSION = 'ppabang-v1'
const STATIC_CACHE = `${VERSION}-static`
const RUNTIME_CACHE = `${VERSION}-runtime`
const IMAGE_CACHE = `${VERSION}-images`
const OFFLINE_URL = '/offline.html'

const PRECACHE = [
  '/',
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

// ── fetch 가로채기 ──────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // 외부 도메인은 그냥 통과 (카카오 API, 세움터 API 등)
  if (url.origin !== self.location.origin && !url.hostname.includes('supabase.co')) {
    return
  }

  // 1) Supabase 매물 이미지: StaleWhileRevalidate (캐시 즉시 + 백그라운드 업데이트)
  if (url.hostname.includes('supabase.co') && url.pathname.includes('/storage/')) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE))
    return
  }

  // 2) /_next/static (해시 포함 자원): CacheFirst (불변)
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // 3) 정적 자원 (icon, favicon, manifest): CacheFirst
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE))
    return
  }

  // 4) API 호출: NetworkFirst
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE))
    return
  }

  // 5) HTML 페이지: NetworkFirst (실패 시 오프라인 페이지)
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirstWithOffline(request))
    return
  }

  // 그 외: NetworkFirst
  event.respondWith(networkFirst(request, RUNTIME_CACHE))
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

async function networkFirst(request, cacheName) {
  try {
    const res = await fetch(request)
    if (res.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, res.clone())
    }
    return res
  } catch {
    const cached = await caches.match(request)
    return cached || new Response('', { status: 504 })
  }
}

async function networkFirstWithOffline(request) {
  try {
    const res = await fetch(request)
    if (res.ok) {
      const cache = await caches.open(RUNTIME_CACHE)
      cache.put(request, res.clone())
    }
    return res
  } catch {
    const cached = await caches.match(request)
    if (cached) return cached
    return caches.match(OFFLINE_URL)
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
  let data = { title: '빠방', body: '새 알림이 있어요', url: '/' }
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
      // 이미 열린 탭이 있으면 그쪽으로 포커스
      for (const c of cs) {
        if (c.url.includes(url) && 'focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
