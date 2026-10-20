'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { isAuthRetryableFetchError, isAuthWeakPasswordError, type AuthError, type Session, type User as AuthUser } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { User, Building2, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPhoneKR, validateSignup, SIGNUP_PASSWORD_MIN, NAME_MAX, type SignupErrors, type SignupField } from '@/lib/validation'
import { isPasswordPwned, pwnedMessage } from '@/lib/password-check'

/** 인증 메일을 연달아 보내면 Supabase 가 429 로 막는다 — 다시 보내기 버튼을 1분 쉬게 한다. */
const RESEND_COOLDOWN_SEC = 60

/**
 * 칸 이름 + 필수(*)·선택 표시. 휴대폰은 비워도 가입되는데 어느 칸에도 표시가 없어 다 채워야 하는 줄 알았다(p4).
 * Input 의 label 은 글자만 받아 표시를 붙일 수 없어, 같은 모양의 label 을 따로 그리고 id 로 잇는다.
 */
function FieldLabel({ htmlFor, optional, children }: { htmlFor: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
      {children}{' '}
      {optional
        ? <span className="font-normal text-gray-500">(선택)</span>
        : <span className="text-red-500" aria-hidden="true">*</span>}
    </label>
  )
}

const ALREADY_REGISTERED = '이미 가입된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해주세요.'

/**
 * 중개사·관리자 전용 경로. 고객으로 가입하는 사람은 이런 redirect 를 따라가지 않는다 —
 * /broker/properties 에서 튕겨 온 사람이 역할을 '고객'으로 바꿔 가입하면 고객인 채 중개사 화면에 떨어졌다.
 */
const STAFF_PATH = /^\/(?:broker|dashboard\/broker|admin)(?:[/?#]|$)/

/** 가입 실패를 칸·까닭별로. 모르는 오류는 서버 문구를 그대로 둔다(예전 동작). */
function signupErrorMessage(err: AuthError): { field?: SignupField; text: string } {
  if (err.code === 'user_already_exists' || err.code === 'email_exists' || err.message === 'User already registered') {
    return { field: 'email', text: ALREADY_REGISTERED }
  }
  if (err.code === 'email_address_invalid') return { field: 'email', text: '올바른 이메일 주소를 입력해주세요 (예: name@example.com)' }
  if (err.code === 'weak_password') {
    // 서버가 왜 약하다는지(reasons)를 보내 준다 — 규칙을 짐작해 적으면 유출 비밀번호를 막은 때도 '기호 섞기'라고 엉뚱하게 안내했다
    const reasons = isAuthWeakPasswordError(err) ? err.reasons : []
    if (reasons.includes('pwned')) return { field: 'password', text: '유출된 적 있는 비밀번호예요. 다른 비밀번호를 사용해주세요.' }
    if (reasons.includes('characters')) return { field: 'password', text: '영문·숫자·기호를 섞은 비밀번호로 해주세요' }
    return { field: 'password', text: '더 안전한 비밀번호로 바꿔주세요' }
  }
  if (err.status === 429 || err.code === 'over_request_rate_limit' || err.code === 'over_email_send_rate_limit') {
    return { text: '요청이 많아 잠시 막혔어요. 잠시 후 다시 시도해주세요.' }
  }
  if (isAuthRetryableFetchError(err)) return { text: '연결이 불안정해요. 잠시 후 다시 시도해주세요.' }
  return { text: err.message }
}

export function SignupForm({
  defaultRole = 'user',
  redirectTo = null,
}: {
  defaultRole?: 'user' | 'broker'
  redirectTo?: string | null
}) {
  const router = useRouter()
  const supabase = createClient()

  const [role, setRole] = useState<'user' | 'broker'>(defaultRole)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [phone, setPhone] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreeMarketing, setAgreeMarketing] = useState(false) // 신규 #3: 마케팅 분리 동의 (선택)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<SignupErrors>({})
  // 인증 메일을 보낸 주소 — 세션 없이 가입이 끝났을 때(이메일 인증을 켠 서버)만 채워진다
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [resending, setResending] = useState(false)
  const [resendMsg, setResendMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const passwordConfirmRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const termsRef = useRef<HTMLInputElement>(null)
  const pwnedRef = useRef<{ pw: string; result: ReturnType<typeof isPasswordPwned> } | null>(null)

  const pwMatch = password === passwordConfirm
  const pwStrong = password.length >= SIGNUP_PASSWORD_MIN

  // 가입 뒤 갈 곳. 중개사는 사무소를 등록(대표)하거나 코드로 합류(직원)해야 나머지 화면이 열려 늘 등록 화면.
  // 고객은 들고 온 redirect(홈 [무료로 조건 등록하기] → /request/new), 없거나 중개사 전용이면 고객 첫 화면.
  const destination = role === 'broker'
    ? '/broker/register'
    : (redirectTo && !STAFF_PATH.test(redirectTo) ? redirectTo : '/dashboard/user')
  // 인증 메일 링크도 같은 곳으로 — 예전엔 돌아올 주소를 안 넘겨 메일 링크가 홈으로 떨어졌다
  const emailRedirectTo = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(destination)}`

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const clearError = (field: SignupField) =>
    setFieldErrors(prev => (prev[field] ? { ...prev, [field]: undefined } : prev))

  const focusField = (field: SignupField) => {
    const refs = { name: nameRef, email: emailRef, password: passwordRef, passwordConfirm: passwordConfirmRef, phone: phoneRef, terms: termsRef }
    const el = refs[field].current
    if (!el) return
    // 동의 칸은 폼 맨 아래라 첫 화면 밖이다 — 가운데로 끌어올린 뒤 포커스
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.focus({ preventScroll: true })
  }

  // 유출 비밀번호 확인(외부 호출)을 비밀번호 칸을 떠날 때 미리 걸어 둔다. 가입을 누른 뒤에야 시작하면
  // 느린 망에서 그만큼 기다림이 길어졌다(p3 — 누르고 6초). 같은 비밀번호면 그 결과를 그대로 쓴다.
  // 다만 확인 자체가 실패한 결과(망 끊김·서비스 장애)는 남겨 두지 않는다 — 가입을 누를 때 한 번 더 해 보도록.
  const checkPwned = (pw: string) => {
    if (pwnedRef.current?.pw !== pw) {
      const result = isPasswordPwned(pw).then(r => {
        if (r.error && pwnedRef.current?.pw === pw) pwnedRef.current = null
        return r
      })
      pwnedRef.current = { pw, result }
    }
    return pwnedRef.current.result
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    // 칸을 한꺼번에 보고 칸마다 띄운다. 버튼을 약관 미동의로 꺼 두면 이유를 알 길이 없어(p1),
    // 버튼은 늘 켜 두고 여기서 '이용약관에 동의해주세요'를 동의 칸 아래에 띄운다.
    const errors = validateSignup({ name, email, password, passwordConfirm, phone, agreeTerms })
    setFieldErrors(errors)
    const first = (Object.keys(errors) as SignupField[])[0]
    if (first) { focusField(first); return }

    setLoading(true)

    // 유출된 비밀번호 차단 (P1-5 — HaveIBeenPwned k-anonymity)
    const pwned = await checkPwned(password)
    if (pwned.pwned) {
      setFieldErrors({ password: pwnedMessage(pwned.count ?? 0) })
      focusField('password')
      setLoading(false)
      return
    }

    // 이름은 앞뒤 공백을 지워 저장(공백만이면 위에서 막힌다). 휴대폰은 하이픈 없이 넣어도 받으니 모양만 맞춘다.
    const cleanEmail = email.trim()
    const cleanPhone = phone.trim() ? formatPhoneKR(phone.trim()) : ''

    let user: AuthUser | null = null
    let session: Session | null = null
    try {
      const result = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { name: name.trim(), phone: cleanPhone, role },
          emailRedirectTo: emailRedirectTo(),
        },
      })
      if (result.error) {
        const msg = signupErrorMessage(result.error)
        if (msg.field) { setFieldErrors({ [msg.field]: msg.text }); focusField(msg.field) }
        else setError(msg.text)
        setLoading(false)
        return
      }
      user = result.data.user
      session = result.data.session
    } catch {
      setError('오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
      return
    }

    // 이메일 인증을 켠 서버는 이미 가입된 주소에도 계정 유무를 숨기려고 '성공'처럼 답한다 — 대신 identities 가
    // 빈 채로 온다. 그대로 두면 그 주소로 '인증 메일을 보냈어요'가 떠서(#52) 이미 가입된 쪽으로 안내한다.
    if (user && user.identities?.length === 0) {
      setFieldErrors({ email: ALREADY_REGISTERED })
      focusField('email')
      setLoading(false)
      return
    }

    if (!session || !user) {
      // 이메일 인증을 켠 서버 — 가입은 됐지만 로그인 전이다. 세션이 없어 프로필 수정·동의 기록은
      // 어차피 막히므로(consent/signup 은 세션 주인만 받는다) 인증 안내 화면만 보여 준다.
      // 운영은 가입 즉시 인증(세션이 바로 온다)이라 이 화면을 보지 않는다.
      setSentTo(cleanEmail)
      setCooldown(RESEND_COOLDOWN_SEC)
      setLoading(false)
      return
    }

    // 프로필 행·이름·휴대폰·역할은 가입 트리거(handle_new_user)가 메타데이터로 이미 만든다.
    // 여기선 마케팅 수신 동의만 얹는다. upsert 로 email·phone 까지 보내면 그 칸들의 읽기 권한이
    // 없어(ON CONFLICT 의 EXCLUDED 를 읽어야 한다) 통째로 실패해, 동의가 저장되지 않았다.
    // 동의 기록과는 서로 기다릴 이유가 없어 함께 보낸다 — 차례로 기다리면 느린 망에서 그만큼 늦었다.
    await Promise.all([
      supabase.from('profiles').update({
        // 마케팅 수신 분리 동의 — 별도 체크박스 결과만 반영, 나머지는 DB 기본값
        notification_preferences: {
          matches: true,
          messages: true,
          proposals: true,
          announcements: true,
          marketing: agreeMarketing,
        },
      }).eq('id', user.id),
      // 신규 가입 시 현재 유효한 모든 약관 버전 동의 기록. 망 오류로 던져도 가입은 끝났으니 화면은 넘긴다.
      fetch('/api/consent/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, marketing: agreeMarketing }),
      }).catch(() => null),
    ])

    // 세션이 있으니 인증 메일 안내 없이 바로 원래 가려던 곳으로. 이동하는 동안 버튼을 다시 켜지 않는다 —
    // 느린 망에선 이동이 몇 초 걸리는데 다시 눌리는 폼이 보이면 가입이 실패한 줄 알았다(p3).
    router.replace(destination)
  }

  const resend = async () => {
    if (!sentTo || cooldown > 0 || resending) return
    setResending(true)
    setResendMsg(null)
    try {
      const { error: err } = await supabase.auth.resend({ type: 'signup', email: sentTo, options: { emailRedirectTo: emailRedirectTo() } })
      if (err) {
        setResendMsg({ ok: false, text: err.status === 429 ? '방금 보냈어요. 잠시 후 다시 눌러 주세요.' : '메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.' })
        return
      }
      setResendMsg({ ok: true, text: '인증 메일을 다시 보냈어요.' })
      setCooldown(RESEND_COOLDOWN_SEC)
    } catch {
      setResendMsg({ ok: false, text: '메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.' })
    } finally {
      setResending(false)
    }
  }

  const loginHref = (dest: string | null) => (dest ? `/auth/login?redirect=${encodeURIComponent(dest)}` : '/auth/login')

  if (sentTo) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-900 p-10 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">인증 메일을 보냈어요</h2>
        <p className="text-gray-500 text-sm mb-2">
          {/* 조사 없이 '주소로' — '으로'를 붙이면 .kr 처럼 받침 없는 끝은 어색했다 */}
          <span className="font-semibold text-gray-700 dark:text-gray-300 break-all">{sentTo}</span> 주소로<br />
          보낸 메일의 링크를 누르면 가입이 끝나요.
        </p>
        <p className="text-gray-500 text-xs mb-6">메일이 안 보이면 스팸함도 확인해 주세요.</p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          loading={resending}
          disabled={cooldown > 0}
          onClick={resend}
        >
          {cooldown > 0 ? `인증 메일 다시 보내기 (${cooldown}초)` : '인증 메일 다시 보내기'}
        </Button>
        {resendMsg && (
          <p role="status" className={cn('mt-2 text-xs', resendMsg.ok ? 'text-green-600' : 'text-red-600')}>{resendMsg.text}</p>
        )}
        {/* 고객의 기본 목적지(/dashboard/user)는 싣지 않는다 — 로그인 화면이 '로그인이 필요한 화면이에요'라
            막 가입한 사람에게 엉뚱한 인사를 했다. 역할별 첫 화면은 /auth/login 이 알아서 간다. */}
        <Link href={loginHref(role === 'broker' ? '/broker/register' : redirectTo)} className="mt-3 block">
          <Button variant="primary" size="lg" className="w-full">인증했어요 · 로그인하기</Button>
        </Link>
      </div>
    )
  }

  const toRequest = role === 'user' && !!redirectTo && /^\/request\/new(?:[/?#]|$)/.test(redirectTo)

  return (
    <>
      <div className="mb-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="부소장 로고" width={40} height={40} className="h-10 w-10 rounded-xl" />
          <span className="text-2xl font-bold text-gray-900 dark:text-white">부소장</span>
        </Link>
        <p className="mt-6 text-2xl font-bold text-gray-900 dark:text-white">부소장에 오신 걸 환영해요 🏠</p>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          {toRequest ? '가입하면 바로 조건 등록으로 이어져요' : '무료로 시작하세요'}
        </p>
      </div>

      <div className="rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-100 dark:border-gray-800">
        {/* 역할 선택 */}
        <div className="mb-2 grid grid-cols-2 gap-3">
          {[
            { value: 'user', label: '고객', icon: User, desc: '주거·상가·토지·공장 등 · 무료' },
            { value: 'broker', label: '중개사 · 직원', icon: Building2, desc: '매물 제안·관리 · 등록 인증' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setRole(option.value as 'user' | 'broker')}
              className={cn(
                'rounded-xl border-2 p-4 text-left transition-all',
                role === option.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
              )}
            >
              <option.icon className={cn('mb-2 h-5 w-5', role === option.value ? 'text-blue-600' : 'text-gray-500')} />
              <div className={cn('font-semibold text-sm', role === option.value ? 'text-blue-700' : 'text-gray-700')}>
                {option.label}
              </div>
              <div className="text-xs text-gray-600 mt-0.5">{option.desc}</div>
            </button>
          ))}
        </div>
        {/* 중개사를 고르면 대표 본인의 다음 단계부터 — 직원 합류 이야기만 있어 대표는 다음에 뭘 하는지 몰랐다(p4) */}
        <p className="mb-6 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
          {role === 'broker' ? (
            <>
              <span className="font-semibold text-gray-900 dark:text-white">대표님</span>은 다음 단계에서 사무소를 등록해요. 소속 직원은 대표님께 받은 <span className="font-semibold text-gray-900 dark:text-white">6자리 사무소 코드</span>로 합류해요.
            </>
          ) : (
            <>
              소속 직원도 <span className="font-semibold text-gray-900 dark:text-white">중개사·직원</span>을 선택하세요. 다음 단계에서 대표님께 받은 <span className="font-semibold text-gray-900 dark:text-white">6자리 사무소 코드</span>로 합류할 수 있어요.
            </>
          )}
        </p>

        {/* noValidate — 브라우저 말풍선은 한 칸씩만 알려 줘서, 칸마다 아래에 한꺼번에 띄우는 쪽으로 */}
        <form onSubmit={handleSignup} noValidate className="space-y-4">
          {/* JS 가 붙기 전(느린 망)에 누르면 브라우저가 폼을 GET 으로 보내 이 화면을 다시 연다. 칸들은 name 이
              없어 주소에 실리지 않고(비밀번호 노출 없음), 이 둘만 실려 돌아갈 곳·역할을 잃지 않는다. */}
          {redirectTo && <input type="hidden" name="redirect" value={redirectTo} />}
          <input type="hidden" name="role" value={role} />
          <p className="text-right text-xs text-gray-500">
            <span className="text-red-500">*</span> 표시는 꼭 입력해야 해요
          </p>

          <div>
            <FieldLabel htmlFor="signup-name">이름</FieldLabel>
            <Input
              ref={nameRef}
              id="signup-name"
              placeholder="홍길동"
              autoComplete="name"
              value={name}
              onChange={(e) => { setName(e.target.value); clearError('name') }}
              required
              maxLength={NAME_MAX} // 설정>내 계정과 같은 상한 — 붙여넣기는 validateSignup 이 다시 거른다
              error={fieldErrors.name}
            />
          </div>
          <div>
            <FieldLabel htmlFor="signup-email">이메일</FieldLabel>
            <Input
              ref={emailRef}
              id="signup-email"
              type="email"
              placeholder="your@email.com"
              autoComplete="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearError('email') }}
              required
              error={fieldErrors.email}
            />
          </div>

          {/* 비밀번호 */}
          <div className="relative">
            <FieldLabel htmlFor="signup-password">비밀번호</FieldLabel>
            <Input
              ref={passwordRef}
              id="signup-password"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder={`${SIGNUP_PASSWORD_MIN}자 이상`}
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearError('password') }}
              onBlur={() => { if (password.length >= SIGNUP_PASSWORD_MIN) void checkPwned(password) }}
              required
              className="pr-11"
              error={fieldErrors.password}
              hint={password && !pwStrong ? `${SIGNUP_PASSWORD_MIN}자 이상 입력해주세요` : undefined}
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

          {/* 비밀번호 확인 */}
          <div className="relative">
            <FieldLabel htmlFor="signup-password-confirm">비밀번호 확인</FieldLabel>
            <Input
              ref={passwordConfirmRef}
              id="signup-password-confirm"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="비밀번호 재입력"
              value={passwordConfirm}
              onChange={(e) => { setPasswordConfirm(e.target.value); clearError('passwordConfirm') }}
              required
              className="pr-11"
              error={fieldErrors.passwordConfirm ?? (passwordConfirm && !pwMatch ? '비밀번호가 일치하지 않습니다' : undefined)}
            />
            {passwordConfirm && pwMatch && (
              <CheckCircle className="absolute right-3 top-[38px] h-5 w-5 text-green-500" />
            )}
          </div>

          {/* 휴대폰 — 선택. 하이픈 없이 넣어도 받고, 칸을 떠나면 010-1234-5678 모양으로 맞춘다 */}
          <div>
            <FieldLabel htmlFor="signup-phone" optional>휴대폰 번호</FieldLabel>
            <Input
              ref={phoneRef}
              id="signup-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="010-1234-5678"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); clearError('phone') }}
              onBlur={() => setPhone(v => formatPhoneKR(v))}
              hint="하이픈(-) 없이 숫자만 넣어도 돼요"
              error={fieldErrors.phone}
            />
          </div>

          {/* 약관 동의 — 필수 + 만 14세 이상 자기확인.
              체크박스가 13~16px 에 바로 옆이 밑줄 링크라, 손가락으로 체크하려다 약관 페이지로 넘어갔다(p3).
              줄 전체(최소 44px)를 누르는 칸으로 넓히고, 약관 링크는 줄 밖(아래)으로 뺐다.
              링크는 새 탭 — 같은 탭으로 넘어가면 채운 칸이 다 사라졌다. */}
          <div>
            <label
              className={cn(
                '-mx-3 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5',
                fieldErrors.terms && 'bg-red-50 ring-1 ring-red-300 dark:bg-red-950/30 dark:ring-red-800'
              )}
            >
              <input
                ref={termsRef}
                type="checkbox"
                checked={agreeTerms}
                onChange={(e) => { setAgreeTerms(e.target.checked); clearError('terms') }}
                required
                aria-invalid={fieldErrors.terms ? true : undefined}
                aria-describedby={fieldErrors.terms ? 'signup-terms-error' : undefined}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 dark:border-gray-700 accent-blue-600"
              />
              <span className="text-sm text-gray-600 dark:text-gray-500">
                이용약관과 개인정보처리방침에 동의하며, <span className="font-medium">만 14세 이상</span>입니다 <span className="text-red-500">*</span> <span className="text-gray-500">(필수)</span>
              </span>
            </label>
            {/* mt-1 — 동의 줄과 바로 붙어 있으면 줄 아래쪽을 살짝 빗나간 손가락이 약관 새 탭을 열었다 */}
            <div className="mt-1 flex gap-4 pl-8 text-xs">
              <Link href="/terms" target="_blank" rel="noopener noreferrer" className="py-1 text-blue-600 underline">이용약관 보기</Link>
              <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="py-1 text-blue-600 underline">개인정보처리방침 보기</Link>
            </div>
            {fieldErrors.terms && (
              <p id="signup-terms-error" className="mt-1 pl-8 text-xs text-red-600">{fieldErrors.terms}</p>
            )}
          </div>

          {/* 마케팅 수신 동의 — 선택 (별도). 누르는 칸은 필수 동의와 같은 크기 */}
          <label className="-mx-3 flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5">
            <input
              type="checkbox"
              checked={agreeMarketing}
              onChange={(e) => setAgreeMarketing(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 dark:border-gray-700 accent-blue-600"
            />
            <span className="text-sm text-gray-600 dark:text-gray-500">
              마케팅 알림 수신에 동의합니다 <span className="text-gray-500">(선택)</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                할인·이벤트·신규 기능 소식 등을 이메일·푸시로 받아요. 설정에서 언제든 변경 가능.
              </span>
            </span>
          </label>

          {error && (
            <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            loading={loading}
          >
            {role === 'broker' ? '중개사·직원으로 가입하기' : '회원가입'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          이미 계정이 있으신가요?{' '}
          <Link href={loginHref(redirectTo)} className="font-semibold text-blue-600 hover:underline">로그인</Link>
        </div>
      </div>
    </>
  )
}
