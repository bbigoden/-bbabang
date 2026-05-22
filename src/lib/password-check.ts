/**
 * 유출된 비밀번호 차단 (HaveIBeenPwned k-anonymity).
 *
 * 비밀번호 SHA-1 → 앞 5자리만 API에 전송 (전체 해시는 절대 외부 노출 X).
 * API는 그 5자리로 시작하는 모든 해시 목록 반환 → 클라이언트가 본인 해시 확인.
 *
 * Supabase Auth "Leaked Password Protection"이 활성화돼 있지 않을 때도
 * 이 함수로 동일한 보호 효과.
 *
 * 회원가입·비밀번호 변경 시 호출.
 */
export async function isPasswordPwned(password: string): Promise<{ pwned: boolean; count?: number; error?: string }> {
  if (!password || password.length < 1) return { pwned: false }

  try {
    // SHA-1 해시
    const encoder = new TextEncoder()
    const data = encoder.encode(password)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()

    const prefix = hashHex.slice(0, 5)
    const suffix = hashHex.slice(5)

    // HaveIBeenPwned k-anonymity API — 앞 5자리만 전송
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' }, // 응답 크기 정규화 (트래픽 분석 방지)
    })
    if (!res.ok) {
      return { pwned: false, error: 'service_unavailable' }
    }

    const text = await res.text()
    // 응답 형식: "HASH_SUFFIX:COUNT\r\n..."
    for (const line of text.split('\n')) {
      const [s, c] = line.trim().split(':')
      if (s === suffix) {
        const count = parseInt(c, 10) || 0
        return { pwned: true, count }
      }
    }
    return { pwned: false }
  } catch {
    // 네트워크 오류 등은 통과 (fail-open) — 가용성 우선
    return { pwned: false, error: 'check_failed' }
  }
}

/** 사용자에게 보여줄 한국어 메시지 */
export function pwnedMessage(count: number): string {
  if (count >= 1000) {
    return `이 비밀번호는 데이터 유출로 ${count.toLocaleString()}회 노출됐어요. 다른 비밀번호를 사용해주세요.`
  }
  return `이 비밀번호는 외부 유출 사례가 ${count}회 있어요. 다른 비밀번호를 사용해주세요.`
}
