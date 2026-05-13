'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export function BrokerChangeOffice({ brokerId, parentBrokerId }: { brokerId: string; parentBrokerId: string }) {
  const supabase = createClient()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handleLeave = async () => {
    if (!confirm('사무소를 탈퇴할까요?\n입력하신 고객·매물·업무일지 데이터는 사무소에 귀속됩니다.\n탈퇴 후 새 사무소 코드로 재등록할 수 있습니다.')) return
    setLoading(true)

    // 데이터를 대표 broker_id로 이전
    await Promise.all([
      supabase.from('broker_customers').update({ broker_id: parentBrokerId }).eq('broker_id', brokerId),
      supabase.from('broker_properties').update({ broker_id: parentBrokerId }).eq('broker_id', brokerId),
      supabase.from('broker_consultations').update({ broker_id: parentBrokerId }).eq('broker_id', brokerId),
    ])

    // 사무소 연결 해제
    await supabase.from('broker_profiles').update({
      parent_broker_id: null,
      is_approved: false,
      permissions: null,
    }).eq('id', brokerId)

    router.push('/broker/register')
    router.refresh()
  }

  return (
    <button onClick={handleLeave} disabled={loading}
      className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50">
      <LogOut className="h-4 w-4" />
      {loading ? '처리 중...' : '사무소 탈퇴'}
    </button>
  )
}
