import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Supabase 메일 링크(비밀번호 재설정 등) 전용 콜백 — 코드 안에 호출처가 없어도 지우면 안 된다.
 *
 * next 는 같은 사이트 경로만 받는다. 예전엔 `${origin}${next}` 로 이어 붙여
 * next='@evil.example'(→ 사용자정보@외부호스트)이나 '.evil.example'(→ 호스트 접미사)이
 * 외부로 나갔다. '//', '/\' 로 시작하는 것도 브라우저가 외부 주소로 읽는다.
 *
 * 풀어 본 결과도 '//' 로 시작하면 거절한다(login·MFA 의 safeRedirect 와 같은 구멍).
 * '/.//evil.example'·'/a/..//evil.example' 은 앞 검사를 지나고 출처도 그대로인데, 점 구간이
 * 정리되며 경로가 '//evil.example' 이 된다. 그걸 new URL(next, origin) 에 다시 넣으면
 * 프로토콜 상대 주소로 읽혀 https://evil.example 로 나간다.
 */
function safeNext(raw: string | null, origin: string): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  try {
    const u = new URL(raw, origin)
    const path = u.pathname + u.search + u.hash
    return u.origin === origin && !path.startsWith('//') ? path : null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'), origin) ?? '/dashboard/broker'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }
  }

  return NextResponse.redirect(new URL('/auth/login?error=auth_failed', origin))
}
