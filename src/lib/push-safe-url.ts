// 푸시 알림을 눌렀을 때 열 주소 — 같은 사이트 안의 경로만 허용하고 나머지는 '/'.
// 푸시 보내는 두 경로(/api/push/notify, /api/internal/send-push)가 같이 쓴다.
export function safeUrl(raw: unknown, origin: string): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/'
  try {
    const u = new URL(raw, origin)
    return u.origin === origin ? u.pathname + u.search + u.hash : '/'
  } catch {
    return '/'
  }
}
