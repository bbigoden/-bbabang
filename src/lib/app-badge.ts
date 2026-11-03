/**
 * 홈 화면 앱 아이콘의 숫자 배지(안 읽은 메시지 수).
 *
 * 앱이 떠 있을 때는 useOfficeChatUnread 가 실제 수를 여기로 넘기고,
 * 앱이 닫혀 있을 때는 sw.js 가 메시지 푸시를 받을 때마다 같은 칸의 수에 1을 더해 배지를 단다.
 * 그래서 마지막으로 센 수를 SW 도 읽을 수 있는 캐시 칸에 같이 적어 둔다.
 * 캐시 이름·주소는 sw.js 의 BADGE_CACHE·BADGE_KEY 와 같아야 한다.
 */
const BADGE_CACHE = 'badge-count'
const BADGE_KEY = '/__badge'

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export function setAppBadgeCount(n: number) {
  if (typeof window === 'undefined') return
  const nav = navigator as BadgeNavigator
  // 지원 안 하는 브라우저(데스크톱 일부·iOS 홈 화면 밖)에서는 조용히 넘어간다
  if (n > 0) nav.setAppBadge?.(n).catch(() => {})
  else nav.clearAppBadge?.().catch(() => {})
  if ('caches' in window) {
    caches.open(BADGE_CACHE)
      .then(c => c.put(BADGE_KEY, new Response(String(n))))
      .catch(() => {})
  }
}
