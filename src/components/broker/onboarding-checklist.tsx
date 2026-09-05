'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CheckCircle2, Circle, Rocket, X, ChevronRight } from 'lucide-react'
import { sendAndForget } from '@/lib/send-and-forget'

export interface OnboardingItems {
  property: boolean
  employee: boolean
  settlement: boolean
}

// 신규 사무소 대표용 시작 가이드 — 3항목 전부 완료되면 서버에서 아예 렌더하지 않으므로
// 이 컴포넌트는 "미완료가 하나라도 있는 대표"에게만 보인다.
// 숨기기는 broker_profiles.onboarding_dismissed_at에 저장 (기기 무관, 1인 사무소 대응).
export function OnboardingChecklist({ brokerId, items }: { brokerId: string; items: OnboardingItems }) {
  const supabase = createClient()
  const [hidden, setHidden] = useState(false)

  const steps = [
    {
      done: items.property,
      title: '첫 매물 등록하기',
      desc: '매물장에서 + 버튼으로 바로 추가할 수 있어요',
      href: '/broker/properties',
    },
    {
      done: items.employee,
      title: '직원 초대하기',
      desc: '팀 관리에서 사무소 코드를 발급해 직원에게 공유하세요',
      href: '/broker/team',
    },
    {
      done: items.settlement,
      title: '정산 기준 설정하기',
      desc: '월 기본경비와 수수료 분배율을 사무소에 맞게 저장하세요',
      href: '/broker/settlement',
    },
  ]
  const doneCount = steps.filter(s => s.done).length

  const dismiss = () => {
    setHidden(true)
    sendAndForget(supabase.from('broker_profiles')
      .update({ onboarding_dismissed_at: new Date().toISOString() })
      .eq('id', brokerId))
  }

  if (hidden) return null

  return (
    <div className="mb-6 rounded-2xl border border-blue-100 dark:border-blue-500/20 bg-blue-50/60 dark:bg-blue-500/5 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <h2 className="font-bold text-gray-900 dark:text-white">사무소 시작 가이드</h2>
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">{doneCount}/{steps.length} 완료</span>
        </div>
        <button onClick={dismiss} aria-label="시작 가이드 숨기기"
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-1.5">
        {steps.map(s => s.done ? (
          <div key={s.title} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
            <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-400 dark:text-gray-600 line-through">{s.title}</span>
          </div>
        ) : (
          <Link key={s.title} href={s.href}
            className="flex items-center gap-3 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 px-3 py-2.5 hover:border-blue-300 dark:hover:border-blue-500/40 transition-colors group">
            <Circle className="h-5 w-5 text-gray-300 dark:text-gray-700 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{s.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.desc}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 transition-colors" />
          </Link>
        ))}
      </div>
    </div>
  )
}
