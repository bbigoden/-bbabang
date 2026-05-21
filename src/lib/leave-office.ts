/**
 * 직원이 사무소를 떠날 때 모든 영업 기록을 대표(parent_broker_id)에게 이전.
 *
 * 사용처:
 * - 사무소 탈퇴 (`<BrokerChangeOffice/>`)
 * - 회원탈퇴 (`/settings/account`) — 직원이면 user 삭제 전 호출
 * - 사장의 직원 제거 (`/broker/team` removeEmployee)
 *
 * 법적 책임이 대표에게 있으므로 매물·고객·일지·채팅·제안·리뷰 등 영업 기록 전부 이전.
 *
 * @returns 첫 에러를 반환 (있으면). 없으면 null.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function transferBrokerData(
  supabase: SupabaseClient,
  fromBrokerId: string,
  toBrokerId: string,
): Promise<{ error: { message: string } | null }> {
  const results = await Promise.all([
    // 사무소 자산 (매물·고객·일지·상담)
    supabase.from('broker_customers').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('broker_properties').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('broker_consultations').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('broker_diary').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('broker_diary_customers').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),

    // 영업 활동 (채팅·제안·리뷰) — 법적 책임 보존
    supabase.from('chat_rooms').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('proposals').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('reviews').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
  ])
  const err = results.find(r => r.error)?.error
  return { error: err ? { message: err.message } : null }
}
