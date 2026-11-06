// Service Worker for 부소장 PWA
// 원칙: SW는 정적 자원·이미지 캐싱만 담당. API·DB 응답은 캐시하지 않는다.
// fetch 핸들러가 있는 한 모든 요청이 SW를 한 번 거친다 — 아래 '통과'는 respondWith를
// 안 불러 브라우저 기본 처리로 넘긴다는 뜻이지, SW를 건너뛴다는 뜻이 아니다.
// - /_next/static/* : CacheFirst (불변 해시)
// - 정적 자원(아이콘·manifest) : CacheFirst
// - Supabase 공개 버킷 이미지(/storage/v1/object/public/) : StaleWhileRevalidate
// - 그 외(/api/*, supabase rest 등) : respondWith 없이 통과 (브라우저 기본 처리)
// - navigate(HTML) : 내비게이션 프리로드 응답 우선, 실패 시에만 offline.html fallback
// - 푸시 알림 / 클릭 처리

const VERSION = 'busojang-v7'
const STATIC_CACHE = `${VERSION}-static`
const IMAGE_CACHE = `${VERSION}-images`
const OFFLINE_URL = '/offline.html'
// 앱 아이콘 숫자 배지 — src/lib/app-badge.ts 와 같은 이름. 버전과 무관하게 남긴다
const BADGE_CACHE = 'badge-count'
const BADGE_KEY = '/__badge'

const PRECACHE = [
  '/offline.html',
  '/icon-192.png',
  '/icon-512.png',
  '/badge-96.png',
  '/favicon.ico',
  '/manifest.webmanifest',
]

// ── 설치: 사전 캐시 ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    // 하나씩 담는다. addAll 은 한 파일만 실패해도 통째로 안 담기는데, 그러면 activate 가
    // 옛 캐시를 지운 뒤라 오프라인 페이지가 다음 버전까지 사라진다.
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))))
  )
  self.skipWaiting()
})

// ── 활성화: 내비게이션 프리로드 켜기 + 옛 버전 캐시 정리 ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 잠든 SW가 깨어나는 동안 페이지 요청을 브라우저가 미리 보내 둔다.
      // 안 켜면 폰에서 앱을 열 때마다 SW 기동 시간만큼 첫 화면이 늦는다.
      // 켜기 실패가 캐시 정리까지 막지 않게 삼킨다.
      // **되돌릴 때 주의** — 이 설정은 파일이 아니라 등록에 남는다. 이 줄을 지운 sw.js 로
      // 되돌리면 프리로드가 켜진 채 옛 fetch(request) 가 또 나가 페이지 요청이 두 번 간다.
      // 끄려면 navigationPreload.disable() 을 activate 에서 불러야 한다.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => {})
      }
      const keys = await caches.keys()
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION) && k !== BADGE_CACHE).map((k) => caches.delete(k))
      )
    })()
  )
  self.clients.claim()
})

// ── fetch 처리 (respondWith는 최소화) ─────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  // 1) Supabase 공개 버킷 이미지만 캐시 (다른 supabase 호출은 통과)
  //    비공개 버킷의 서명 URL(/object/sign/ — DM·채팅 사진, 직인)은 캐시하지 않는다. URL 마다
  //    새 항목이 생겨 끝없이 쌓이고, 로그아웃·퇴사 뒤에도 기기에 남았다.
  if (url.hostname.includes('supabase.co')) {
    if (url.pathname.includes('/storage/v1/object/public/')) {
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

  // 5) navigate(HTML) 요청: 프리로드 응답 우선 → 없으면 정상 fetch → 실패 시 오프라인 fallback
  //    프리로드를 지원 안 하는 브라우저는 preloadResponse가 undefined라 바로 fetch로 간다.
  //    프리로드가 실패하면 다시 보내지 않는다 — 로그인 콜백처럼 한 번만 쓰는 코드를 서버가
  //    이미 써 버렸을 수 있다. 전처럼 바로 오프라인 안내로 간다.
  if (request.mode === 'navigate') {
    event.respondWith(
      Promise.resolve(event.preloadResponse)
        .then((preloaded) => preloaded || fetch(request))
        .catch(() => caches.match(OFFLINE_URL).then(r => r || new Response('Offline', { status: 503 })))
    )
    return
  }

  // 6) 그 외 (페이지 chunk, /api/*, 동적 자원): respondWith 없이 통과 (브라우저 기본)
})

// ── 캐시 크기 상한 ───────────────────────────────────────
// 배포마다 _next/static 에 새 해시 파일이 생기는데 VERSION 은 손으로만 올려서, 그 사이 옛 파일이
// 폰 저장소에 끝없이 쌓였다(11-06 점검). 넣은 순서(오래된 것부터)로 상한을 넘는 만큼 지운다.
// 사전 캐시(오프라인 화면·아이콘)는 지우지 않는다.
const CACHE_MAX = { [STATIC_CACHE]: 400, [IMAGE_CACHE]: 300 }
const trimming = new Set()
async function trimCache(cacheName) {
  const max = CACHE_MAX[cacheName]
  if (!max || trimming.has(cacheName)) return
  trimming.add(cacheName)
  try {
    const cache = await caches.open(cacheName)
    const keys = (await cache.keys()).filter((r) => !PRECACHE.includes(new URL(r.url).pathname))
    const extra = keys.length - max
    for (let i = 0; i < extra; i++) await cache.delete(keys[i])
  } catch {} finally { trimming.delete(cacheName) }
}

// ── 캐시 전략 ────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) return cached
  try {
    const res = await fetch(request)
    if (res.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, res.clone()).then(() => trimCache(cacheName)).catch(() => {})
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
    .then((res) => { if (res.ok) cache.put(request, res.clone()).then(() => trimCache(cacheName)).catch(() => {}); return res })
    .catch(() => cached)
  return cached || fetchPromise
}

// ── 푸시 알림 수신 ───────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: '부소장', body: '새 알림이 있어요', url: '/' }
  try { if (event.data) data = { ...data, ...event.data.json() } } catch {}

  event.waitUntil(Promise.all([
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      // 안드로이드 상단바 작은 아이콘은 투명 배경 흰 모양만 쓴다 — 꽉 찬 아이콘을 주면 흰 네모가 된다
      badge: '/badge-96.png',
      data: { url: data.url },
      tag: data.tag,
      // 같은 방(tag)의 다음 메시지는 앞 알림을 갈아 끼우기만 하고 소리·진동 없이 조용히 지나갔다
      renotify: !!data.tag,
      requireInteraction: false,
    }),
    String(data.tag || '').startsWith('office-chat-') ? bumpBadge() : null,
  ]))
})

// 앱이 닫혀 있을 때 메시지 푸시마다 아이콘 숫자를 하나씩 올린다.
// 앱을 열면 useOfficeChatUnread 가 실제 안 읽은 수로 다시 맞춘다. 화면을 보고 있으면 그쪽이 세므로 건너뛴다.
async function bumpBadge() {
  if (!self.navigator.setAppBadge) return
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (wins.some((c) => c.visibilityState === 'visible')) return
  const cache = await caches.open(BADGE_CACHE)
  const prev = Number(await (await cache.match(BADGE_KEY))?.text()) || 0
  const next = prev + 1
  await cache.put(BADGE_KEY, new Response(String(next)))
  await self.navigator.setAppBadge(next).catch(() => {})
}

// ── 알림 클릭 시 페이지 열기 ──────────────────────────────
// 앱이 떠 있으면 새로 고치지 않고 그 창에 '이 주소로 가라'고만 알린다(sw-register 가 받아 화면을 옮긴다).
// 예전엔 메세지 화면이 떠 있으면 그 창을 앞으로만 꺼내 방이 열리지 않았고,
// 다른 화면이면 navigate 로 통째로 다시 불러 느렸다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (cs) => {
      const mine = cs.filter((c) => new URL(c.url).origin === self.location.origin)
      const win = mine.find((c) => c.focused) || mine.find((c) => c.visibilityState === 'visible') || mine[0]
      if (win) {
        const w = await win.focus().catch(() => win)
        ;(w || win).postMessage({ type: 'open-url', url })
        return
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
