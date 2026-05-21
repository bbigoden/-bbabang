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
  // 이전 직원 + 대표 이름 lookup (assignee 처리·일지 archive 라벨에 사용)
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
  const departingName = (fromProf.data as { name?: string } | null)?.name ?? null
  const ownerName = (toProf.data as { name?: string } | null)?.name ?? null

  // 1. 일지·일지묶음을 평소 화면에 합치지 않고 archive 테이블로 이동
  //    (대표만 '퇴사자 일지' 페이지에서 조회 가능)
  const { data: deptDiaries } = await supabase.from('broker_diary')
    .select('*').eq('broker_id', fromBrokerId)
  if (deptDiaries && deptDiaries.length > 0) {
    const archiveRows = deptDiaries.map(d => ({
      office_broker_id: toBrokerId,
      author_broker_id: fromBrokerId,
      author_name: departingName,
      date: d.date,
      title: d.title,
      content: d.content,
      work_summary: d.work_summary,
      ad_status: d.ad_status,
      suggestions: d.suggestions,
      delivery_notes: d.delivery_notes,
      sections_content: d.sections_content,
      original_created_at: d.created_at,
      original_updated_at: d.updated_at,
    }))
    const { error: archErr } = await supabase.from('broker_diary_archive').insert(archiveRows)
    if (archErr) return { error: { message: `일지 archive 실패: ${archErr.message}` } }
    const { error: delErr } = await supabase.from('broker_diary').delete().eq('broker_id', fromBrokerId)
    if (delErr) return { error: { message: `원본 일지 정리 실패: ${delErr.message}` } }
  }

  // 일지묶음 — customer 정보(이름·연락처)도 함께 스냅샷 보존
  const { data: deptDcusts } = await supabase.from('broker_diary_customers')
    .select('*, broker_customers(client_name, contact)').eq('broker_id', fromBrokerId)
  if (deptDcusts && deptDcusts.length > 0) {
    const archiveCustRows = deptDcusts.map((d: any) => ({
      office_broker_id: toBrokerId,
      author_broker_id: fromBrokerId,
      author_name: departingName,
      diary_date: d.diary_date,
      customer_id: d.customer_id,
      customer_name: d.broker_customers?.client_name ?? null,
      customer_contact: d.broker_customers?.contact ?? null,
      sort_order: d.sort_order,
      proposed_property_ids: d.proposed_property_ids,
    }))
    const { error: archErr } = await supabase.from('broker_diary_customers_archive').insert(archiveCustRows)
    if (archErr) return { error: { message: `일지묶음 archive 실패: ${archErr.message}` } }
    const { error: delErr } = await supabase.from('broker_diary_customers').delete().eq('broker_id', fromBrokerId)
    if (delErr) return { error: { message: `원본 일지묶음 정리 실패: ${delErr.message}` } }
  }

  // 2. 그 외 영업 기록은 대표 broker_id로 이전 (법적 책임 보존)
  const results = await Promise.all([
    supabase.from('broker_customers').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('broker_properties').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('broker_consultations').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('chat_rooms').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('proposals').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
    supabase.from('reviews').update({ broker_id: toBrokerId }).eq('broker_id', fromBrokerId),
  ])
  const err = results.find(r => r.error)?.error
  if (err) return { error: { message: err.message } }

  // 3. assignee 처리 — 떠난 직원이 단독 담당이던 매물·고객에 대표 이름을 함께 표기
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
