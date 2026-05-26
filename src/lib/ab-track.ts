/**
 * A/B 전환 이벤트 기록 유틸.
 * fire-and-forget — 실패해도 UX에 영향 없음.
 *
 * @example
 * // 버튼 클릭 전환 이벤트
 * await trackAb({ experimentId: 'home_cta_v1', variantId: variant, eventName: 'cta_click' })
 */
export async function trackAb(opts: {
  experimentId: string
  variantId: string
  eventName: string          // 'impression' | 'click' | 'conversion' | 자유 문자열
  userId?: string | null
  sessionId?: string | null
  properties?: Record<string, unknown>
}): Promise<void> {
  try {
    await fetch('/api/ab/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
      keepalive: true,       // 페이지 이탈 직전에도 전송 보장
    })
  } catch {
    // 무시 — analytics는 non-critical
  }
}
