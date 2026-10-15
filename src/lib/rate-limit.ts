import { createClient as createServerClient } from '@supabase/supabase-js'

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
 *
 * 서버 전용 키(service_role)로 부른다. rate_limit_check 는 버킷 이름·횟수·창을 인자로 받으므로
 * 로그인 사용자에게 열어 두면 남의 버킷(`ip:<남의 IP>:...`)을 채워 그 사람을 막을 수 있었다.
 * 그래서 함수 실행 권한은 service_role 에만 둔다(security_hardening_20261015).
 */
export async function checkRateLimit(
  bucket: string,
  max: number,
  windowSeconds: number,
  strict: boolean = false,
): Promise<boolean> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      console.error('[rate-limit] SUPABASE_SERVICE_ROLE_KEY 미설정')
      return !strict
    }
    const supabase = createServerClient(url, serviceKey, { auth: { persistSession: false } })
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
