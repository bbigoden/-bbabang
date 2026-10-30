'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { isProtectedPath } from '@/lib/protected-paths'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eye, EyeOff, Check } from 'lucide-react'
import { homePath } from '@/lib/home-path'

const STORAGE_KEY = 'bbabang_saved_email'

/** 인증 메일을 연달아 보내면 Supabase 가 429 로 막는다 — 다시 보내기 버튼을 1분 쉬게 한다. */
const RESEND_COOLDOWN_SEC = 60

/**
 * 로그인 화면에 온 까닭별 인사.
 * - 로그인이 풀려 돌아옴(expired) → 그 까닭을 여기서만 말한다. 아래 빨간 오류 상자에도 같은 말을 띄웠더니 두 번 읽혔다.
 * - 로그인 전용 화면으로 가던 길 → 로그인하면 이어진다고만
 * - 헤더 [로그인]은 보던 공개 화면도 redirect 로 싣는다 — 보호 경로일 때만 '필요해요'
 */
function loginIntro(redirectTo: string | null, expired: boolean) {
  if (expired) return { title: '다시 로그인해 주세요', sub: '로그인 상태가 끝났어요. 다시 로그인하면 보던 화면으로 이어져요' }
  if (redirectTo && isProtectedPath(redirectTo.split(/[?#]/)[0])) {
    return { title: '로그인이 필요한 화면이에요', sub: '로그인하면 보던 화면으로 바로 이어져요' }
  }
  return { title: '다시 만나서 반가워요 👋', sub: '부소장과 함께 좋은 하루 보내세요' }
}

/** 가입 화면에도 redirect 를 실어 보낸다 — 가입 화면의 [로그인] 링크가 그걸 이어 받는다 */
function signupHref(redirectTo: string | null) {
  if (!redirectTo) return '/auth/signup'
  return `/auth/signup?${new URLSearchParams({ redirect: redirectTo })}`
}

/**
 * 로그인 실패를 까닭별로. 예전엔 모두 '이메일 또는 비밀번호가 올바르지 않습니다'라, 인증 메일을
 * 아직 안 누른 사람·요청이 몰려 잠시 막힌 사람·망이 끊긴 사람도 비밀번호를 의심하다 떠났다.
 */
function loginErrorKind(err: AuthError): 'unconfirmed' | 'rate' | 'network' | 'credentials' {
  if (err.code === 'email_not_confirmed' || /email not confirmed/i.test(err.message)) return 'unconfirmed'
  if (err.status === 429 || err.code === 'over_request_rate_limit') return 'rate'
  if (isAuthRetryableFetchError(err)) return 'network'
  return 'credentials'
}

const LOGIN_ERROR_TEXT = {
  unconfirmed: '이메일 인증이 아직 안 됐어요. 가입 때 받은 메일의 인증 링크를 눌러 주세요.',
  rate: '로그인 시도가 너무 많아요. 잠시 후 다시 시도해주세요.',
  network: '연결이 불안정해요. 잠시 후 다시 시도해주세요.',
  credentials: '이메일 또는 비밀번호가 올바르지 않습니다.',
} as const

export function LoginForm({ redirectTo, expired }: { redirectTo: string | null; expired?: boolean }) {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  // 느린 망에선 화면이 스크립트보다 4~5초 먼저 보인다. 그 사이 누르면 폼이 그냥 GET 으로 가 화면이 다시
  // 열리고 적은 것이 날아간다(칸에 name 이 없어 비밀번호가 주소에 실리진 않는다) — 붙을 때까지 잠근다.
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const [error, setError] = useState('')
  const [rememberEmail, setRememberEmail] = useState(false)
  // 인증 전 로그인 — 재발송 버튼을 띄운다
  const [unconfirmed, setUnconfirmed] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const intro = loginIntro(redirectTo, !!expired)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      const dest = redirectTo
        ?? homePath(profile?.role)
      router.replace(dest)
    })

    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      setEmail(saved)
      setRememberEmail(true)
    }
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const resendConfirm = async () => {
    if (cooldown > 0 || resending || !email.trim()) return
    setResending(true)
    setResendMsg(null)
    try {
      // 인증 링크를 누르면 로그인되어 원래 가려던 곳으로 — 콜백이 next 로 보낸다(없으면 고객 첫 화면)
      const next = redirectTo ? `?next=${encodeURIComponent(redirectTo)}` : ''
      const { error: err } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback${next}` },
      })
      if (err) {
        setResendMsg({ ok: false, text: err.status === 429 ? '방금 보냈어요. 잠시 후 다시 눌러 주세요.' : '메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.' })
        return
      }
      // 조사 없이 '주소로' — '으로'를 붙이면 .kr 처럼 받침 없는 끝은 어색했다
      setResendMsg({ ok: true, text: `${email.trim()} 주소로 인증 메일을 다시 보냈어요.` })
      setCooldown(RESEND_COOLDOWN_SEC)
    } catch {
      setResendMsg({ ok: false, text: '메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.' })
    } finally {
      setResending(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setUnconfirmed(false)
    setResendMsg(null)

    if (rememberEmail) {
      localStorage.setItem(STORAGE_KEY, email)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }

    let userId: string
    try {
      const result = await supabase.auth.signInWithPassword({ email, password })
      if (result.error) {
        const kind = loginErrorKind(result.error)
        setError(LOGIN_ERROR_TEXT[kind])
        setUnconfirmed(kind === 'unconfirmed')
        setLoading(false)
        return
      }
      userId = result.data.user.id
    } catch {
      setError('오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
      return
    }

    // 2FA: AAL2가 필요하면 MFA 검증 페이지로 이동
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal?.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
      const dest = redirectTo
        ? `/auth/mfa?next=${encodeURIComponent(redirectTo)}`
        : '/auth/mfa'
      router.replace(dest)
      return
    }

    // role에 따라 리다이렉트
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single()

    const dest = redirectTo
      ?? homePath(profile?.role)

    router.replace(dest)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="부소장 로고" width={40} height={40} className="h-10 w-10 rounded-xl" />
            <span className="text-2xl font-bold text-gray-900 dark:text-white">부소장</span>
          </Link>
          <p className="mt-6 text-2xl font-bold text-gray-900 dark:text-white">{intro.title}</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{intro.sub}</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-100 dark:border-gray-800">
          <form onSubmit={handleLogin} className="space-y-4">
            {/* JS 가 붙기 전(느린 망)에 누르면 브라우저가 폼을 GET 으로 보내 이 화면을 다시 연다 — 칸들은 name 이
                없어 주소에 실리지 않고, 돌아갈 곳만 실려 남는다 */}
            {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}
            <Input
              label="이메일"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />

            {/* 비밀번호 + 표시 토글 */}
            <div className="relative">
              <Input
                label="비밀번호"
                type={showPw ? 'text' : 'password'}
                placeholder="비밀번호 입력"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-[38px] text-gray-500 hover:text-gray-600 dark:text-gray-500"
                tabIndex={-1}
                aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보이기'}
              >
                {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            {/* 아이디 저장 + 비밀번호 찾기 */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setRememberEmail(v => !v)}
                className="flex items-center gap-2 group"
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-md border-2 transition-all ${
                  rememberEmail
                    ? 'border-blue-500 bg-blue-500'
                    : 'border-gray-300 bg-white group-hover:border-blue-400'
                }`}>
                  {rememberEmail && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                </span>
                <span className="text-xs text-gray-500 select-none group-hover:text-gray-700 dark:text-gray-300">아이디 저장</span>
              </button>
              <Link href="/auth/reset-password" className="text-xs text-gray-500 hover:text-blue-600">
                비밀번호를 잊으셨나요?
              </Link>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 flex items-center gap-2">
                <span>⚠️</span> {error}
              </div>
            )}

            {unconfirmed && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  loading={resending}
                  disabled={cooldown > 0}
                  onClick={resendConfirm}
                >
                  {cooldown > 0 ? `인증 메일 다시 보내기 (${cooldown}초)` : '인증 메일 다시 보내기'}
                </Button>
                {resendMsg && (
                  <p role="status" className={cn('mt-2 text-center text-xs', resendMsg.ok ? 'text-green-600' : 'text-red-600')}>{resendMsg.text}</p>
                )}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loading} disabled={!ready}>
              {ready ? '로그인' : '불러오는 중…'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            아직 계정이 없으신가요?{' '}
            <Link href={signupHref(redirectTo)} className="font-semibold text-blue-600 hover:underline">
              무료로 시작하기
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-500">
          로그인하면 부소장의{' '}
          <Link href="/terms" className="underline">이용약관</Link>과{' '}
          <Link href="/privacy" className="underline">개인정보처리방침</Link>에 동의합니다
        </p>
      </div>
    </div>
  )
}

