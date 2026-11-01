'use client'

import Link from 'next/link'
import { useAuthOptional } from '@/lib/auth-context'

/** 약관·방침 맨 아래 '로그인으로 돌아가기' — 이미 로그인한 사람에겐 숨긴다(위 '홈으로'가 있다). */
export function LegalLoginLink() {
  const { user, loading } = useAuthOptional()
  if (loading || user) return null
  return (
    <div className="mt-6 text-center">
      <Link href="/auth/login" className="text-sm text-blue-600 hover:underline">
        ← 로그인으로 돌아가기
      </Link>
    </div>
  )
}
