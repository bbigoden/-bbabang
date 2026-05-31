'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Shield, Home } from 'lucide-react'
import Link from 'next/link'

/**
 * 로그인 후 AAL2가 필요할 때 TOTP 코드를 입력받는 페이지.
 * login-form.tsx가 nextLevel==='aal2'를 감지하면 /auth/mfa?next=<dest> 로 보낸다.
 */
export function MfaForm() {
  const router = useRouter()
  const supabase = createClient()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [factorId, setFactorId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    ;(async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error || !data?.totp?.length) {
        // 2FA 미등록 or 세션 없음 → 로그인으로
        router.replace('/auth/login')
        return
      }
      setFactorId(data.totp[0].id)
    })()
  }, [])

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!factorId) return
    setLoading(true)
    setError('')

    const { data: challenge, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeErr || !challenge) {
      setError('인증 요청에 실패했어요. 다시 시도해주세요.')
      setLoading(false)
      return
    }

    const { error: verifyErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.replace(/\s/g, ''),
    })

    if (verifyErr) {
      setError('코드가 올바르지 않아요. 앱에서 현재 코드를 다시 확인해주세요.')
      setLoading(false)
      setCode('')
      inputRef.current?.focus()
      return
    }

    // 인증 성공 → role 기반 리다이렉트
    const params = new URLSearchParams(window.location.search)
    const next = params.get('next')
    if (next) {
      router.replace(next)
      return
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', (await supabase.auth.getUser()).data.user!.id)
      .single()
    const dest =
      profile?.role === 'admin' ? '/admin'
      : profile?.role === 'broker' ? '/dashboard/broker'
      : '/dashboard/user'
    router.replace(dest)
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
          <div className="mt-6 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
              <Shield className="h-7 w-7 text-blue-600" />
            </div>
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">2단계 인증</h1>
          <p className="mt-2 text-sm text-gray-500">인증 앱에 표시된 6자리 코드를 입력해주세요</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-100 dark:border-gray-800">
          <form onSubmit={verify} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                인증 코드
              </label>
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-center text-2xl font-mono tracking-[0.4em] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:text-white"
              />
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                <span>⚠️</span> {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || code.length !== 6 || !factorId}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? '확인 중...' : '확인'}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-gray-500">
            인증 앱이 없거나 코드를 받을 수 없으면{' '}
            <Link href={`${process.env.NEXT_PUBLIC_CONTACT_EMAIL ? `mailto:${process.env.NEXT_PUBLIC_CONTACT_EMAIL}` : '/support'}`}
              className="underline hover:text-blue-600">
              운영팀에 문의
            </Link>
            해주세요.
          </p>
        </div>
      </div>
    </div>
  )
}
