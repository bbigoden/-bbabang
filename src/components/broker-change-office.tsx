'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { transferBrokerData } from '@/lib/leave-office'
import { useToast } from '@/components/toast'

export function BrokerChangeOffice({ brokerId, parentBrokerId }: { brokerId: string; parentBrokerId: string }) {
  const supabase = createClient()
  const router = useRouter()
  const toast = useToast()
  const [loading, setLoading] = useState(false)

  const handleLeave = async () => {
    if (!confirm('사무소를 탈퇴할까요?\n입력하신 고객·매물·업무일지·채팅·제안·리뷰 등 모든 영업 기록은 사무소(대표)에 귀속됩니다.\n탈퇴 후 새 사무소 코드로 재등록할 수 있습니다.')) return
    setLoading(true)

    // 모든 영업 기록을 대표에게 이전 (법적 책임 보존)
    const { error } = await transferBrokerData(supabase, brokerId, parentBrokerId)
    if (error) {
      toast.error(`데이터 이전 실패: ${error.message}\n탈퇴를 중단했어요. 잠시 후 다시 시도해주세요.`)
      setLoading(false)
      return
    }

    // 사무소 연결 해제
    const { error: detachErr } = await supabase.from('broker_profiles').update({
      parent_broker_id: null,
      is_approved: false,
      permissions: null,
    }).eq('id', brokerId)
    if (detachErr) {
      toast.error(`사무소 분리 실패: ${detachErr.message}`)
      setLoading(false)
      return
    }

    router.push('/broker/register')
    router.refresh()
  }

  return (
    <button onClick={handleLeave} disabled={loading}
      className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
      <LogOut className="h-4 w-4" />
      {loading ? '처리 중...' : '사무소 탈퇴'}
    </button>
  )
}
