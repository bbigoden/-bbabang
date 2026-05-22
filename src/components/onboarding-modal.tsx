'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Users, MessageSquare, Star, ChevronRight, ChevronLeft, X, Plus } from 'lucide-react'

const DISMISS_KEY = 'ppabang_onboarding_v1'

const STEPS = [
  {
    icon: FileText,
    color: 'bg-blue-100 text-blue-600',
    title: '1. 매물 조건 등록',
    desc: '원하는 지역·거래 유형·예산을 입력하면 끝. 중개사가 알아서 매물을 찾아 제안해줘요.',
  },
  {
    icon: Users,
    color: 'bg-purple-100 text-purple-600',
    title: '2. 중개사 제안 받기',
    desc: '여러 중개사가 매물 사진과 함께 제안을 보내요. 마음에 드는 제안만 골라서 응답하면 돼요.',
  },
  {
    icon: MessageSquare,
    color: 'bg-emerald-100 text-emerald-600',
    title: '3. 채팅으로 협의',
    desc: '수락한 중개사와 1:1 채팅으로 상세 협의. 매물 사진·전화번호 공유까지 한 곳에서.',
  },
  {
    icon: Star,
    color: 'bg-amber-100 text-amber-600',
    title: '4. 거래 후 리뷰',
    desc: '거래가 마무리되면 후기를 남겨주세요. 다른 고객에게 큰 도움이 돼요.',
  },
] as const

export function OnboardingModal() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem(DISMISS_KEY) === '1') return
    const t = setTimeout(() => setOpen(true), 600)
    return () => clearTimeout(t)
  }, [])

  const close = (mark = true) => {
    if (mark && typeof window !== 'undefined') localStorage.setItem(DISMISS_KEY, '1')
    setOpen(false)
  }

  if (!open) return null

  const isLast = step === STEPS.length - 1
  const s = STEPS[step]
  const Icon = s.icon

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm md:items-center p-0 md:p-4"
      onClick={() => close()}>
      <div className="w-full md:max-w-md rounded-t-2xl md:rounded-2xl bg-white dark:bg-gray-900 shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="relative flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-3.5">
          <span className="text-xs font-bold text-gray-400">빠방 사용 가이드</span>
          <button onClick={() => close()} aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 dark:bg-gray-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-7 text-center">
          <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl ${s.color}`}>
            <Icon className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{s.title}</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
        </div>

        {/* 인디케이터 */}
        <div className="flex justify-center gap-1.5 pb-3">
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => setStep(i)} aria-label={`${i + 1}단계로 이동`}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-blue-600' : 'w-1.5 bg-gray-200 hover:bg-gray-300'
              }`} />
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-100 dark:border-gray-800 px-5 py-4">
          {step > 0 ? (
            <button onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">
              <ChevronLeft className="h-4 w-4" />
              이전
            </button>
          ) : (
            <button onClick={() => close()}
              className="rounded-xl border border-gray-200 dark:border-gray-800 px-4 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 dark:bg-gray-950">
              건너뛰기
            </button>
          )}

          {!isLast ? (
            <button onClick={() => setStep(s => s + 1)}
              className="ml-auto inline-flex items-center gap-1 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
              다음
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <Link href="/request/new" onClick={() => close()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700">
              <Plus className="h-4 w-4" />
              지금 시작하기
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
