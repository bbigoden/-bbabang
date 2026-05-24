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
 * 구현: DB의 `transfer_broker_data` RPC를 호출 (SECURITY DEFINER).
 *   - RLS 우회 (관리자 권한으로 실행)
 *   - 매물 트리거 일시 비활성 (session_replication_role=replica)
 *   - 일지 archive·assignee 처리·broker_id 이전 모두 DB에서 트랜잭션으로 처리
 *
 * @returns 에러를 반환 (있으면). 없으면 null.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export async function transferBrokerData(
  supabase: SupabaseClient,
  fromBrokerId: string,
  toBrokerId: string,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase.rpc('transfer_broker_data', {
    from_broker_id: fromBrokerId,
    to_broker_id: toBrokerId,
  })
  if (error) return { error: { message: error.message } }
  return { error: null }
}
