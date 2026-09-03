/**
 * 직원(중개사)이 매물/고객/업무일지/정산을 등록할 때
 * 사무소 대표(parent_broker_id의 user_id)에게 알림 발송.
 *
 * - 본인이 대표(is_owner=true)거나 사무소 미가입(parent_broker_id 없음)이면 건너뜀.
 * - 인앱(notifications) + 웹푸시 둘 다 발송. 실패는 조용히 무시(UX 비차단).
 */
import { createClient } from '@/lib/supabase/client'

type ActionKind = 'property' | 'customer' | 'diary' | 'settlement'

const META: Record<ActionKind, { icon: string; title: string; link: string }> = {
  property:   { icon: '🏠', title: '신규 매물이 등록되었습니다',   link: '/broker/properties' },
  customer:   { icon: '👤', title: '신규 고객이 등록되었습니다',   link: '/broker/customers' },
  diary:      { icon: '📝', title: '신규 업무일지가 등록되었습니다', link: '/broker/diary' },
  settlement: { icon: '💰', title: '신규 정산이 등록되었습니다',   link: '/broker/settlement' },
}

export async function notifyOwnerOfBrokerAction(
  brokerId: string | null | undefined,
  kind: ActionKind,
  link?: string,  // 알림 클릭 시 이동할 URL (없으면 기본 페이지로)
): Promise<void> {
  if (!brokerId) return
  try {
    const supabase = createClient()

    // 행동한 직원 정보
    const { data: me } = await supabase
      .from('broker_profiles')
      .select('id, user_id, is_owner, parent_broker_id')
      .eq('id', brokerId)
      .maybeSingle()
    if (!me) return
    if (me.is_owner) return                 // 본인이 대표 → 자기에게 안 보냄
    if (!me.parent_broker_id) return        // 사무소 미가입

    // 대표(parent broker)의 user_id
    const { data: owner } = await supabase
      .from('broker_profiles')
      .select('user_id')
      .eq('id', me.parent_broker_id)
      .maybeSingle()
    if (!owner?.user_id || owner.user_id === me.user_id) return

    // 직원 이름 조회 (body에 "○○○ 님" 표시용)
    const { data: nameRow } = me.user_id
      ? await supabase.from('profiles').select('name').eq('id', me.user_id).maybeSingle()
      : { data: null as { name: string | null } | null }
    const staffName = (nameRow as any)?.name ?? '직원'

    const meta = META[kind]
    const title = `${meta.icon} ${meta.title}`
    const body  = `${staffName} 님`
    const finalLink = link || meta.link

    // 인앱 알림 (종 아이콘)
    await supabase.from('notifications').insert({
      user_id: owner.user_id,
      type: `staff_${kind}_added`,
      title,
      body,
      link: finalLink,
    })

    // 웹 푸시 (실패 무시 — 푸시 미허용 대표도 인앱은 받음)
    fetch('/api/push/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId: owner.user_id,
        title,
        body,
        url: finalLink,
        tag: `staff-${kind}-${brokerId}-${Date.now()}`,
      }),
    }).catch(() => {})
  } catch {
    /* 알림 실패는 메인 작업을 방해하지 않음 */
  }
}
