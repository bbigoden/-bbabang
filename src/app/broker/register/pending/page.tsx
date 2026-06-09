'use client'

import { Header } from '@/components/layout/header'
import { Clock, CheckCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function PendingPage() {
  const router = useRouter()
  const supabase = createClient()
  const [checking, setChecking] = useState(false)
  const [approved, setApproved] = useState(false)

  // 승인 여부 폴링: 5초마다 체크 + Supabase Realtime 구독
  useEffect(() => {
    let cancelled = false
    let channelRef: ReturnType<typeof supabase.channel> | null = null

    const checkApproval = async () => {
      try {
        const { data: auth } = await supabase.auth.getUser()
        if (!auth.user) {
          router.push('/auth/login')
          return
        }
        const { data: broker } = await supabase
          .from('broker_profiles')
          .select('id, is_owner, is_approved')
          .eq('user_id', auth.user.id)
          .single()

        if (!broker) {
          // 직원 신청도 안 한 상태 → 대시보드로
          router.push('/dashboard/broker')
          return
        }
        // 이미 대표거나 승인됐으면 대시보드로
        if (broker.is_owner || broker.is_approved) {
          if (cancelled) return
          setApproved(true)
          setTimeout(() => router.push('/dashboard/broker'), 1500)
        }
      } catch {}
    }

    checkApproval()
    const interval = setInterval(checkApproval, 5000)

    // Realtime: broker_profiles 변경 즉시 감지
    ;(async () => {
      const { data: auth } = await supabase.auth.getUser()
      if (!auth.user || cancelled) return
      channelRef = supabase
        .channel(`broker-approval-${auth.user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'broker_profiles',
            filter: `user_id=eq.${auth.user.id}`,
          },
          (payload) => {
            const row = payload.new as { is_approved?: boolean }
            if (row.is_approved && !cancelled) {
              setApproved(true)
              setTimeout(() => router.push('/dashboard/broker'), 1500)
            }
          },
        )
        .subscribe()
    })()

    return () => {
      cancelled = true
      clearInterval(interval)
      if (channelRef) supabase.removeChannel(channelRef)
    }
  }, [router, supabase])

  const manualCheck = async () => {
    setChecking(true)
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) { router.push('/auth/login'); return }
    const { data: broker } = await supabase
      .from('broker_profiles')
      .select('is_owner, is_approved')
      .eq('user_id', auth.user.id)
      .single()
    if (broker?.is_owner || broker?.is_approved) {
      setApproved(true)
      setTimeout(() => router.push('/dashboard/broker'), 1500)
    }
    setChecking(false)
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-950">
      <Header />
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        {approved ? (
          <>
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-100">
              <CheckCircle className="h-10 w-10 text-green-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">승인되었습니다!</h1>
            <p className="text-gray-500 text-sm leading-relaxed">
              잠시 후 대시보드로 이동합니다...
            </p>
          </>
        ) : (
          <>
            <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-yellow-100">
              <Clock className="h-10 w-10 text-yellow-500" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">승인 대기 중</h1>
            <p className="text-gray-500 text-sm leading-relaxed mb-6">
              등록 신청이 완료되었습니다.<br />
              대표가 승인하면 자동으로 대시보드로 이동해요.<br />
              승인 여부는 대표에게 문의해주세요.
            </p>
            <button
              onClick={manualCheck}
              disabled={checking}
              className="rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              {checking ? '확인 중...' : '지금 확인'}
            </button>
            <p className="mt-4 text-xs text-gray-500">자동으로 5초마다 확인합니다</p>
          </>
        )}
      </div>
    </div>
  )
}
