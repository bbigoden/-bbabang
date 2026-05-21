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
  // 1. broker_id 이전 — 영업 기록 전부
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
  if (err) return { error: { message: err.message } }

  // 2. assignee 처리 — 떠난 직원이 단독 담당이던 매물·고객에 대표 이름을 함께 표기
  // (이미 콤마로 여러 담당자 들어있는 경우는 사용자가 명시적으로 설정한 것이라 그대로 둠)
  const [fromRes, toRes] = await Promise.all([
    supabase.from('broker_profiles').select('user_id').eq('id', fromBrokerId).maybeSingle(),
    supabase.from('broker_profiles').select('user_id').eq('id', toBrokerId).maybeSingle(),
  ])
  const [fromProf, toProf] = await Promise.all([
    fromRes.data?.user_id
      ? supabase.from('profiles').select('name').eq('id', fromRes.data.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    toRes.data?.user_id
      ? supabase.from('profiles').select('name').eq('id', toRes.data.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const departingName = (fromProf.data as { name?: string } | null)?.name
  const ownerName = (toProf.data as { name?: string } | null)?.name

  if (departingName && ownerName && departingName !== ownerName) {
    const combined = `${departingName}, ${ownerName}`
    await Promise.all([
      supabase.from('broker_customers')
        .update({ assignee: combined })
        .eq('broker_id', toBrokerId)
        .eq('assignee', departingName),
      supabase.from('broker_properties')
        .update({ assignee: combined })
        .eq('broker_id', toBrokerId)
        .eq('assignee', departingName),
    ])
  }

  return { error: null }
}
