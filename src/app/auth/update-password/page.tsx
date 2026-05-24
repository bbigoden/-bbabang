'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Home, Eye, EyeOff, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { isPasswordPwned, pwnedMessage } from '@/lib/password-check'

export default function UpdatePasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const pwMatch = password === passwordConfirm
  const pwStrong = password.length >= 8

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!pwMatch) { setError('비밀번호가 일치하지 않습니다.'); return }
    if (!pwStrong) { setError('비밀번호는 8자 이상이어야 합니다.'); return }

    setLoading(true)
    setError('')

    // P1-5: 유출된 비밀번호 차단 (HaveIBeenPwned)
    const pwned = await isPasswordPwned(password)
    if (pwned.pwned) {
      setError(pwnedMessage(pwned.count ?? 0))
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError('비밀번호 변경에 실패했습니다. 링크가 만료됐을 수 있어요.')
      setLoading(false)
      return
    }

    setDone(true)
    setLoading(false)
    setTimeout(() => router.push('/auth/login'), 2000)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
        <div className="w-full max-w-md text-center">
          <div className="rounded-2xl bg-white dark:bg-gray-900 p-10 shadow-sm border border-gray-100 dark:border-gray-800">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">비밀번호 변경 완료!</h2>
            <p className="text-gray-500 text-sm">잠시 후 로그인 페이지로 이동합니다...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
              <Home className="h-5 w-5 text-white" />
            </div>
            <span className="text-2xl font-bold text-gray-900 dark:text-white">빠방</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-gray-900 dark:text-white">새 비밀번호 설정</h1>
          <p className="mt-2 text-sm text-gray-500">8자 이상의 새 비밀번호를 입력해주세요</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-100 dark:border-gray-800">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="relative">
              <Input
                label="새 비밀번호"
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
                className="absolute right-3 top-[38px] text-gray-400 hover:text-gray-600 dark:text-gray-400"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            <div className="relative">
              <Input
                label="새 비밀번호 확인"
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="비밀번호 재입력"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                required
                error={passwordConfirm && !pwMatch ? '비밀번호가 일치하지 않습니다' : undefined}
              />
              {passwordConfirm && pwMatch && (
                <CheckCircle className="absolute right-3 top-[38px] h-5 w-5 text-green-500" />
              )}
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              비밀번호 변경하기
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
