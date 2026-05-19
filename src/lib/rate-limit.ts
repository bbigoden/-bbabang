import { createClient } from '@/lib/supabase/server'

/**
 * 슬라이딩 윈도우 rate limit. DB(api_rate_limit 테이블) 기반.
 *
 * @param bucket   식별자 (예: `user:${userId}:auto-fill`)
 * @param max      허용 호출 수
 * @param windowSeconds 윈도우 길이(초)
 * @returns true=허용, false=제한 초과
 */
export async function checkRateLimit(
  bucket: string,
  max: number,
  windowSeconds: number,
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
      return true  // DB 오류 시 fail-open (서비스 가용성 우선)
    }
    return data === true
  } catch (e) {
    console.error('[rate-limit] unexpected', e)
    return true
  }
}
