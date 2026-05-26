/**
 * 직원(중개사)이 매물/고객/업무일지/정산을 등록할 때
 * 사무소 대표(parent_broker_id의 user_id)에게 알림 발송.
 *
 * - 본인이 대표(is_owner=true)거나 사무소 미가입(parent_broker_id 없음)이면 건너뜀.
 * - 인앱(notifications) + 웹푸시 둘 다 발송. 실패는 조용히 무시(UX 비차단).
 */
import { createClient } from '@/lib/supabase/client'

type ActionKind = 'property' | 'customer' | 'diary' | 'settlement'

const META: Record<ActionKind, { icon: string; label: string; link: string }> = {
  property:   { icon: '🏠', label: '매물',     link: '/broker/properties' },
  customer:   { icon: '👤', label: '고객',     link: '/broker/customers' },
  diary:      { icon: '📝', label: '업무일지', link: '/broker/diary' },
  settlement: { icon: '💰', label: '정산',     link: '/broker/settlement' },
}

export async function notifyOwnerOfBrokerAction(
  brokerId: string | null | undefined,
  kind: ActionKind,
  detail?: string,
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

    // 직원 이름
    const { data: meName } = me.user_id
      ? await supabase.from('profiles').select('name').eq('id', me.user_id).maybeSingle()
      : { data: null as { name: string | null } | null }
    const staffName = (meName as any)?.name ?? '직원'

    const meta = META[kind]
    const title = `${meta.icon} ${staffName} 님이 ${meta.label} 등록`
    const body  = detail || `${meta.label}이(가) 새로 추가됐어요.`

    // 인앱 알림 (종 아이콘)
    await supabase.from('notifications').insert({
      user_id: owner.user_id,
      type: `staff_${kind}_added`,
      title,
      body,
      link: meta.link,
    })

    // 웹 푸시 (실패 무시 — 푸시 미허용 대표도 인앱은 받음)
    fetch('/api/push/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetUserId: owner.user_id,
        title,
        body,
        url: meta.link,
        tag: `staff-${kind}-${brokerId}`,
      }),
    }).catch(() => {})
  } catch {
    /* 알림 실패는 메인 작업을 방해하지 않음 */
  }
}

/**
 * 대표가 매물·고객의 담당자(assignee)를 직원 이름으로 지정/변경하면
 * 그 직원에게 "대표님이 배정했어요" 알림 발송.
 *
 * - 행위자가 대표가 아니면 무시 (직원이 본인 매물 작성 시 알림 X)
 * - 변경 전·후 값이 같으면 무시
 * - assignee가 콤마 구분 다중값일 수 있으므로 "새로 추가된 이름"만 알림
 * - 대표 본인 이름이거나 사무소 직원과 매칭 안 되면 무시
 */
const ASSIGN_META: Record<'property' | 'customer', { icon: string; label: string; link: string }> = {
  property: { icon: '🏠', label: '매물', link: '/broker/properties' },
  customer: { icon: '👤', label: '고객', link: '/broker/customers' },
}

export async function notifyAssigneeOfAssignment(
  actorBrokerId: string | null | undefined,
  kind: 'property' | 'customer',
  newAssigneeRaw: string | null | undefined,
  prevAssigneeRaw: string | null | undefined,
  detail?: string,
): Promise<void> {
  if (!actorBrokerId) return
  const parse = (s: string | null | undefined) =>
    new Set((s ?? '').split(',').map(x => x.trim()).filter(Boolean))
  const newSet  = parse(newAssigneeRaw)
  const prevSet = parse(prevAssigneeRaw)
  const added = [...newSet].filter(n => !prevSet.has(n))
  if (added.length === 0) return

  try {
    const supabase = createClient()

    // 행위자: 대표여야만 진행
    const { data: actor } = await supabase
      .from('broker_profiles')
      .select('id, user_id, is_owner')
      .eq('id', actorBrokerId)
      .maybeSingle()
    if (!actor || !actor.is_owner) return

    // 사무소 직원 목록 (대표의 broker_profile.id를 parent_broker_id로 가지는 사람)
    const { data: members } = await supabase
      .from('broker_profiles')
      .select('id, user_id, profiles(name)')
      .eq('parent_broker_id', actor.id)
    if (!members || members.length === 0) return

    const meta = ASSIGN_META[kind]

    for (const name of added) {
      const target = (members as any[]).find(m => (m.profiles as any)?.name === name)
      if (!target?.user_id || target.user_id === actor.user_id) continue

      const title = `${meta.icon} 대표님이 ${meta.label} 담당으로 지정`
      const body  = detail || `대표님이 회원님을 ${meta.label} 담당자로 지정했어요.`

      await supabase.from('notifications').insert({
        user_id: target.user_id,
        type: `assignee_${kind}_assigned`,
        title,
        body,
        link: meta.link,
      })
      fetch('/api/push/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUserId: target.user_id,
          title,
          body,
          url: meta.link,
          tag: `assignee-${kind}-${target.id}-${Date.now()}`,
        }),
      }).catch(() => {})
    }
  } catch {
    /* 무시 */
  }
}
