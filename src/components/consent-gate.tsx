'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { FileText, Check, AlertCircle } from 'lucide-react'
import Link from 'next/link'

type TermsVersion = {
  id: number
  type: string
  version: string
  summary: string | null
  effective_at: string
}

const TYPE_LABEL: Record<string, string> = {
  terms:   '이용약관',
  privacy: '개인정보처리방침',
}
const TYPE_HREF: Record<string, string> = {
  terms:   '/terms',
  privacy: '/privacy',
}

/**
 * 로그인한 사용자에게 미동의 약관이 있으면 전체 화면 모달을 띄워 동의를 강제.
 * root layout 내 AuthProvider 아래에 배치.
 */
export function ConsentGate() {
  const supabase = createClient()
  const [userId, setUserId] = useState<string | null>(null)
  const [pending, setPending] = useState<TermsVersion[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // auth 상태 감지
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_ev, session) => {
      setUserId(session?.user?.id ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // 미동의 약관 조회
  const checkPending = useCallback(async (uid: string) => {
    const { data } = await supabase.rpc('get_pending_term_versions', { p_user_id: uid })
    if (Array.isArray(data) && data.length > 0) {
      setPending(data as TermsVersion[])
      setChecked(new Set())
    }
  }, [])

  useEffect(() => {
    if (userId) checkPending(userId)
    else setPending([])
  }, [userId, checkPending])

  if (!userId || pending.length === 0) return null

  const allChecked = pending.every(t => checked.has(t.id))

  const toggle = (id: number) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id); else next.add(id)
    setChecked(next)
  }

  const submit = async () => {
    if (!allChecked) return
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termIds: Array.from(checked) }),
      })
      if (!res.ok) throw new Error()
      setPending([])
    } catch {
      setError('처리 중 오류가 발생했습니다. 다시 시도해주세요.')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-2xl">
        {/* 헤더 */}
        <div className="mb-5 text-center">
          <div className="flex justify-center mb-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
              <FileText className="h-7 w-7 text-blue-600" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">약관이 업데이트됐어요</h2>
          <p className="mt-1.5 text-sm text-gray-500">
            서비스를 계속 이용하려면 아래 변경된 약관에 동의해주세요.
          </p>
        </div>

        {/* 약관 목록 */}
        <div className="space-y-3 mb-5">
          {pending.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => toggle(t.id)}
              className="w-full flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all ${
                checked.has(t.id)
                  ? 'border-blue-500 bg-blue-500'
                  : 'border-gray-300 dark:border-gray-600'
              }`}>
                {checked.has(t.id) && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {TYPE_LABEL[t.type] ?? t.type} v{t.version}
                  </span>
                  <span className="text-xs font-medium text-red-500">(필수)</span>
                </div>
                {t.summary && (
                  <p className="mt-0.5 text-xs text-gray-500">{t.summary}</p>
                )}
                <Link
                  href={TYPE_HREF[t.type] ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                >
                  전문 보기 →
                </Link>
              </div>
            </button>
          ))}
        </div>

        {/* 에러 */}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* 동의 버튼 */}
        <button
          onClick={submit}
          disabled={!allChecked || submitting}
          className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? '처리 중...' : '모두 동의하고 계속하기'}
        </button>

        <p className="mt-3 text-center text-xs text-gray-500">
          동의하지 않으면 일부 서비스 이용이 제한될 수 있어요.
        </p>
      </div>
    </div>
  )
}
