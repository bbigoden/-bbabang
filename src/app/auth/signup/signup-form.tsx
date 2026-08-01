'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { User, Building2, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { validatePhoneKR } from '@/lib/validation'
import { isPasswordPwned, pwnedMessage } from '@/lib/password-check'

export function SignupForm({ defaultRole = 'user' }: { defaultRole?: 'user' | 'broker' }) {
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
  const [success, setSuccess] = useState(false)

  const pwMatch = password === passwordConfirm
  const pwStrong = password.length >= 8

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pwMatch) { setError('비밀번호가 일치하지 않습니다.'); return }
    if (!pwStrong) { setError('비밀번호는 8자 이상이어야 합니다.'); return }
    if (!agreeTerms) { setError('이용약관에 동의해주세요.'); return }
    if (phone.trim()) {
      const phoneCheck = validatePhoneKR(phone)
      if (!phoneCheck.valid) { setError(phoneCheck.error); return }
    }

    setLoading(true)
    setError('')

    // 유출된 비밀번호 차단 (P1-5 — HaveIBeenPwned k-anonymity)
    const pwned = await isPasswordPwned(password)
    if (pwned.pwned) {
      setError(pwnedMessage(pwned.count ?? 0))
      setLoading(false)
      return
    }

    let data: any = null
    try {
      const result = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name, phone, role } },
      })
      if (result.error) {
        setError(result.error.message === 'User already registered'
          ? '이미 가입된 이메일입니다.'
          : result.error.message)
        setLoading(false)
        return
      }
      data = result.data
    } catch {
      setError('오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
      return
    }

    if (data.user) {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email,
        name,
        phone,
        role,
        // 마케팅 수신 분리 동의 — 별도 체크박스 결과만 반영, 나머지는 DB 기본값
        notification_preferences: {
          matches: true,
          messages: true,
          proposals: true,
          announcements: true,
          marketing: agreeMarketing,
        },
      })

      // 신규 가입 시 현재 유효한 모든 약관 버전 동의 기록
      await fetch('/api/consent/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: data.user.id, marketing: agreeMarketing }),
      })
    }

    if (role === 'broker') {
      router.push('/broker/register')
    } else {
      setSuccess(true)
    }
    setLoading(false)
  }

  if (success) {
    return (
      <div className="rounded-2xl bg-white dark:bg-gray-900 p-10 shadow-sm border border-gray-100 dark:border-gray-800 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <CheckCircle className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">가입 완료! 🎉</h2>
        <p className="text-gray-500 text-sm mb-6">
          입력하신 이메일로 인증 메일을 보냈어요.<br />
          이메일을 확인하고 인증을 완료해주세요.
        </p>
        <Link href="/auth/login">
          <Button variant="primary" size="lg" className="w-full">로그인하러 가기</Button>
        </Link>
      </div>
    )
  }

  return (
    <>
      <div className="mb-8 text-center">
        <Link href="/" className="inline-flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="부소장 로고" width={40} height={40} className="h-10 w-10 rounded-xl" />
          <span className="text-2xl font-bold text-gray-900 dark:text-white">부소장</span>
        </Link>
        <p className="mt-6 text-2xl font-bold text-gray-900 dark:text-white">부소장에 오신 걸 환영해요 🏠</p>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">무료로 시작하세요</p>
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
        <p className="mb-6 text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
          소속 직원도 <span className="font-semibold text-gray-900 dark:text-white">중개사·직원</span>을 선택하세요. 다음 단계에서 사장님께 받은 <span className="font-semibold text-gray-900 dark:text-white">6자리 사무소 코드</span>로 합류할 수 있어요.
        </p>

        <form onSubmit={handleSignup} className="space-y-4">
          <Input label="이름" placeholder="홍길동" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="이메일" type="email" placeholder="your@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />

          {/* 비밀번호 */}
          <div className="relative">
            <Input
              label="비밀번호"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="8자 이상"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="pr-11"
              hint={password && !pwStrong ? '8자 이상 입력해주세요' : undefined}
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
            <Input
              label="비밀번호 확인"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="비밀번호 재입력"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              required
              className="pr-11"
              error={passwordConfirm && !pwMatch ? '비밀번호가 일치하지 않습니다' : undefined}
            />
            {passwordConfirm && pwMatch && (
              <CheckCircle className="absolute right-3 top-[38px] h-5 w-5 text-green-500" />
            )}
          </div>

          <Input label="휴대폰 번호" type="tel" inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" value={phone} onChange={(e) => setPhone(e.target.value)} />

          {/* 약관 동의 — 필수 + 만 14세 이상 자기확인 */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreeTerms}
              onChange={(e) => setAgreeTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-700 accent-blue-600"
            />
            <span className="text-sm text-gray-600 dark:text-gray-500">
              <Link href="/terms" className="text-blue-600 underline">이용약관</Link>과{' '}
              <Link href="/privacy" className="text-blue-600 underline">개인정보처리방침</Link>에 동의하며, <span className="font-medium">만 14세 이상</span>입니다 <span className="text-red-500">*</span> <span className="text-gray-500">(필수)</span>
            </span>
          </label>

          {/* 마케팅 수신 동의 — 선택 (별도) */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={agreeMarketing}
              onChange={(e) => setAgreeMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-700 accent-blue-600"
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
            disabled={!agreeTerms}
          >
            {role === 'broker' ? '중개사·직원으로 가입하기' : '회원가입'}
          </Button>
        </form>

        <div className="mt-6 text-center text-sm text-gray-500">
          이미 계정이 있으신가요?{' '}
          <Link href="/auth/login" className="font-semibold text-blue-600 hover:underline">로그인</Link>
        </div>
      </div>
    </>
  )
}
