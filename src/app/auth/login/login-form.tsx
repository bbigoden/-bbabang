'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Home, Eye, EyeOff, Check } from 'lucide-react'

const STORAGE_KEY = 'bbabang_saved_email'

export function LoginForm({ redirectTo }: { redirectTo: string | null }) {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rememberEmail, setRememberEmail] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      const dest = redirectTo
        ?? (profile?.role === 'admin' ? '/admin'
          : profile?.role === 'broker' ? '/dashboard/broker'
          : '/dashboard/user')
      router.replace(dest)
    })

    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      setEmail(saved)
      setRememberEmail(true)
    }
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (rememberEmail) {
      localStorage.setItem(STORAGE_KEY, email)
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }

    let authData: any = null
    try {
      const result = await supabase.auth.signInWithPassword({ email, password })
      if (result.error) {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.')
        setLoading(false)
        return
      }
      authData = result.data
    } catch {
      setError('오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      setLoading(false)
      return
    }

    // role에 따라 리다이렉트
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .single()

    const dest = redirectTo
      ?? (profile?.role === 'admin' ? '/admin'
        : profile?.role === 'broker' ? '/dashboard/broker'
        : '/dashboard/user')

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
          <p className="mt-6 text-2xl font-bold text-gray-900 dark:text-white">다시 만나서 반가워요 👋</p>
          <p className="mt-2 text-sm text-gray-500">로그인하고 내 방 찾기를 계속하세요</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-100 dark:border-gray-800">
          <form onSubmit={handleLogin} className="space-y-4">
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
                className="absolute right-3 top-[38px] text-gray-400 hover:text-gray-600 dark:text-gray-400"
                tabIndex={-1}
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
              <Link href="/auth/reset-password" className="text-xs text-gray-400 hover:text-blue-600">
                비밀번호를 잊으셨나요?
              </Link>
            </div>

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 flex items-center gap-2">
                <span>⚠️</span> {error}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              로그인
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            아직 계정이 없으신가요?{' '}
            <Link href="/auth/signup" className="font-semibold text-blue-600 hover:underline">
              무료로 시작하기
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          로그인하면 빠방의{' '}
          <Link href="/terms" className="underline">이용약관</Link>과{' '}
          <Link href="/privacy" className="underline">개인정보처리방침</Link>에 동의합니다
        </p>
      </div>
    </div>
  )
}

