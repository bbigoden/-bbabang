'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  label?: string
}

export function KakaoLoginButton({ label = '카카오로 시작하기' }: Props) {
  const supabase = createClient()
  const sp = useSearchParams()
  const redirectParam = sp.get('redirect')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const click = async () => {
    setLoading(true); setErr(null)
    const next = redirectParam && redirectParam.startsWith('/') ? `?next=${encodeURIComponent(redirectParam)}` : ''
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: `${window.location.origin}/auth/callback${next}`,
      },
    })
    if (error) {
      setErr('카카오 로그인을 사용할 수 없어요. 잠시 후 다시 시도해주세요.')
      setLoading(false)
    }
    // 성공 시 카카오 페이지로 리다이렉트되므로 setLoading(false) 불필요
  }

  return (
    <div>
      <button
        type="button"
        onClick={click}
        disabled={loading}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#FEE500] hover:bg-[#FDD835] text-[#191919] font-bold text-sm py-3 transition-colors disabled:opacity-60"
        aria-label={label}
      >
        {/* 카카오 심볼 */}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3C6.48 3 2 6.58 2 11c0 2.84 1.86 5.33 4.66 6.74-.2.7-.71 2.52-.81 2.92-.13.5.18.5.39.36.16-.11 2.55-1.73 3.59-2.43.71.1 1.43.16 2.17.16 5.52 0 10-3.58 10-8s-4.48-8-10-8z"/>
        </svg>
        {loading ? '이동 중...' : label}
      </button>
      {err && (
        <p className="mt-2 text-center text-xs text-red-500">{err}</p>
      )}
    </div>
  )
}
