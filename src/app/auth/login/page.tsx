'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Home, Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      setLoading(false)
      return
    }

    // role에 따라 리다이렉트
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', authData.user.id)
      .single()

    if (profile?.role === 'admin') {
      router.push('/admin')
    } else if (profile?.role === 'broker') {
      router.push('/dashboard/broker')
    } else {
      router.push('/dashboard/user')
    }
    router.refresh()
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
              <Home className="h-5 w-5 text-white" />
            </div>
            <span className="text-2xl font-bold text-gray-900">빠방</span>
          </Link>
          <h1 className="mt-6 text-2xl font-bold text-gray-900">다시 만나서 반가워요 👋</h1>
          <p className="mt-2 text-sm text-gray-500">로그인하고 내 방 찾기를 계속하세요</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
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
                className="absolute right-3 top-[38px] text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>

            {/* 비밀번호 찾기 */}
            <div className="text-right">
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

          {/* 구분선 */}
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="text-xs text-gray-400">또는</span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>

          <div className="text-center text-sm text-gray-500">
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
