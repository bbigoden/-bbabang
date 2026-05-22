import { createClient } from '@/lib/supabase/server'

/**
 * 슬라이딩 윈도우 rate limit. DB(api_rate_limit 테이블) 기반.
 *
 * @param bucket   식별자 (예: `user:${userId}:auto-fill`)
 * @param max      허용 호출 수
 * @param windowSeconds 윈도우 길이(초)
 * @returns true=허용, false=제한 초과
 *
 * 정책(P1-8 검토 결과):
 *  - DB 오류 시 기본 동작은 fail-open (서비스 가용성 우선).
 *  - 고위험 엔드포인트(이메일·푸시 발송 등)는 strict=true로 호출 → fail-closed.
 *  - Supabase 가동률(자체 SLA 99.9%)을 신뢰하되, 보안 엔드포인트는 안전 우선.
 */
export async function checkRateLimit(
  bucket: string,
  max: number,
  windowSeconds: number,
  strict: boolean = false,
): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('rate_limit_check', {
      p_bucket: bucket,
      p_max: max,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      console.error('[rate-limit] rpc error', error)
      return !strict  // 비-strict면 허용, strict면 차단
    }
    return data === true
  } catch (e) {
    console.error('[rate-limit] unexpected', e)
    return !strict
  }
}
