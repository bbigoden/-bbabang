/**
 * 클라이언트에서 다른 사용자에게 이메일 알림 발송 트리거.
 * 인증된 사용자만, 실패는 조용히 (UX 안 막음).
 */
interface EmailNotifyParams {
  targetUserId: string
  category: string  // 'proposal' | 'matching' | 'message' | ...
  title: string
  body: string
  ctaUrl?: string
  ctaLabel?: string
}

export async function sendEmailNotification(params: EmailNotifyParams): Promise<void> {
  try {
    await fetch('/api/email/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  } catch { /* 이메일 발송 실패는 무시 */ }
}

/**
 * 절대 URL로 변환 (Resend는 절대 URL 필요).
 */
export function absoluteUrl(path: string): string {
  if (path.startsWith('http')) return path
  return `https://bbabang.vercel.app${path.startsWith('/') ? path : '/' + path}`
}
