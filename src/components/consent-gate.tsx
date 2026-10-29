'use client'

import { useEffect, useState, useId } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuthOptional } from '@/lib/auth-context'
import { FileText, AlertCircle } from 'lucide-react'
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

/** 가입 폼이 동의 기록(/api/consent/signup)을 마치면 쏘는 신호 */
export const CONSENT_RECORDED_EVENT = 'consent-recorded'

/**
 * 로그인한 사용자에게 미동의 약관이 있으면 전체 화면 모달을 띄워 동의를 강제.
 * root layout 내 AuthProvider 아래에 배치.
 */
export function ConsentGate() {
  const supabase = createClient()
  // 로그인 상태는 AuthProvider 것을 그대로 쓴다. 여기서 따로 getUser 를 부르면
  // auth-js 가 getUser/getSession 을 한 줄로 세워서, 콜드스타트마다 첫 데이터 조회가
  // 이 확인 한 번을 더 기다렸다.
  const user = useAuthOptional().user
  const userId = user?.id ?? null
  const createdAt = user?.created_at ?? null
  const [pending, setPending] = useState<TermsVersion[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const titleId = useId()

  // 미동의 약관 조회. 사람이 바뀌면(다른 탭에서 로그아웃 뒤 바로 다른 계정) 앞사람 약관이
  // 남지 않게 먼저 비우고, 늦게 온 앞사람 응답은 버린다.
  //
  // 막 가입한 사람은 가입 순간 로그인돼 이 조회가 동의 기록보다 먼저 돌았다 — 가입하자마자
  // '약관이 업데이트됐어요'가 떠서 급한 사용자는 거기서 나갔다. 그래서 가입 2분 안이면
  // 가입 폼의 기록 완료 신호(없으면 8초)를 기다렸다가 조회한다.
  useEffect(() => {
    setPending([])
    if (!userId) return
    let 살아있음 = true
    const load = () => {
      void supabase.rpc('get_pending_term_versions', { p_user_id: userId }).then(({ data }) => {
        if (!살아있음) return
        setPending(Array.isArray(data) ? data as TermsVersion[] : [])
      })
    }
    const joinedAt = createdAt ? Date.parse(createdAt) : NaN
    const justJoined = Date.now() - joinedAt < 2 * 60_000
    if (!justJoined) { load(); return () => { 살아있음 = false } }
    let done = false
    const once = () => { if (done) return; done = true; load() }
    window.addEventListener(CONSENT_RECORDED_EVENT, once)
    const timer = window.setTimeout(once, 8000)
    return () => {
      살아있음 = false
      window.removeEventListener(CONSENT_RECORDED_EVENT, once)
      window.clearTimeout(timer)
    }
  }, [userId])

  if (!userId || pending.length === 0) return null

  // 버튼 이름이 '모두 동의하고 계속하기'라 누르는 것 자체가 전체 동의다. 예전엔 줄마다 체크해야
  // 버튼이 켜졌는데 그런 안내가 없어, 꺼진 버튼 앞에서 멈췄다.
  const submit = async () => {
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termIds: pending.map(t => t.id) }),
      })
      if (!res.ok) throw new Error()
      setPending([])
    } catch {
      setError('처리 중 오류가 발생했습니다. 다시 시도해주세요.')
    }
    setSubmitting(false)
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-2xl">
        {/* 헤더 */}
        <div className="mb-5 text-center">
          <div className="flex justify-center mb-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-900/30">
              <FileText className="h-7 w-7 text-blue-600" />
            </div>
          </div>
          <h2 id={titleId} className="text-xl font-bold text-gray-900 dark:text-white">약관이 업데이트됐어요</h2>
          <p className="mt-1.5 text-sm text-gray-500">
            서비스를 계속 이용하려면 아래 변경된 약관에 동의해주세요.
          </p>
        </div>

        {/* 약관 목록 */}
        <div className="space-y-3 mb-5">
          {pending.map(t => (
            <div
              key={t.id}
              className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 text-left"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {TYPE_LABEL[t.type] ?? t.type} v{t.version}
                </span>
                <span className="text-xs font-medium text-red-600">(필수)</span>
              </div>
              {t.summary && (
                <p className="mt-0.5 text-xs text-gray-500">{t.summary}</p>
              )}
              <Link
                href={TYPE_HREF[t.type] ?? '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-xs text-blue-600 hover:underline"
              >
                전문 보기 →
              </Link>
            </div>
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
          disabled={submitting}
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
