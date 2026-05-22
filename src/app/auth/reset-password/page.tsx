'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Home, CheckCircle, ArrowLeft } from 'lucide-react'

export default function ResetPasswordPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    })

    if (error) {
      setError('이메일 발송에 실패했습니다. 다시 시도해주세요.')
      setLoading(false)
      return
    }

    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
        <div className="w-full max-w-md text-center">
          <div className="rounded-2xl bg-white dark:bg-gray-900 p-10 shadow-sm border border-gray-100 dark:border-gray-800">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100">
              <CheckCircle className="h-8 w-8 text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">이메일을 확인하세요</h2>
            <p className="text-gray-500 text-sm mb-6">
              <span className="font-semibold text-gray-700 dark:text-gray-300">{email}</span>으로<br />
              비밀번호 재설정 링크를 보냈어요
            </p>
            <Link href="/auth/login">
              <Button variant="outline" className="w-full">
                <ArrowLeft className="mr-2 h-4 w-4" />
                로그인으로 돌아가기
              </Button>
            </Link>
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
          <h1 className="mt-6 text-2xl font-bold text-gray-900 dark:text-white">비밀번호 찾기</h1>
          <p className="mt-2 text-sm text-gray-500">가입한 이메일로 재설정 링크를 보내드려요</p>
        </div>

        <div className="rounded-2xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-gray-100 dark:border-gray-800">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="이메일"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />

            {error && (
              <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">⚠️ {error}</div>
            )}

            <Button type="submit" className="w-full" size="lg" loading={loading}>
              재설정 링크 보내기
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-gray-500">
            <Link href="/auth/login" className="flex items-center justify-center gap-1 text-blue-600 hover:underline">
              <ArrowLeft className="h-4 w-4" />
              로그인으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
