import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push-server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 매물 등록 후 호출 — 매칭되는 활성 요청 고객에게 푸시 발송.
 * (DB notifications는 broker_properties INSERT 트리거가 이미 처리)
 *
 * POST { propertyId } — 인증된 broker 본인의 매물만 대상
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { propertyId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }) }
  if (!body.propertyId) return NextResponse.json({ error: 'missing_fields' }, { status: 400 })

  // Rate limit
  const allowed = await checkRateLimit(`user:${user.id}:notify-customers`, 10, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // 매물 + 본인 확인
  const { data: prop } = await supabase
    .from('broker_properties')
    .select('id, broker_id, address, deal_type, room_type, price, status, broker_profiles(office_name, user_id)')
    .eq('id', body.propertyId)
    .single()
  if (!prop) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // P2-3: as any 캐스팅 제거. Supabase가 단일/배열로 다르게 반환할 수 있어 정규화.
  type BrokerProfileMin = { office_name: string | null; user_id: string }
  const brokerProfile = (Array.isArray(prop.broker_profiles)
    ? prop.broker_profiles[0]
    : prop.broker_profiles) as BrokerProfileMin | null
  const brokerUserId = brokerProfile?.user_id

  if (brokerUserId !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  if (prop.status !== 'available') return NextResponse.json({ ok: true, sent: 0, skipped: 'not_available' })

  // notifications 테이블에서 이 매물 알림을 받은 사용자 id 목록 조회 (트리거가 이미 채움)
  // 링크는 매물 상세 기준 — 중개사 공개 프로필 페이지 제거됨 (트리거와 형식 일치 필수)
  const link = `/property/${prop.id}`
  const { data: notifs } = await supabase
    .from('notifications')
    .select('user_id')
    .eq('type', 'new_matching_property')
    .eq('link', link)
    .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // 최근 5분 내 (이 매물 등록 직후 트리거된 것들)

  const userIds = Array.from(new Set((notifs ?? []).map(n => n.user_id)))
  if (userIds.length === 0) return NextResponse.json({ ok: true, sent: 0, matched: 0 })

  const officeName = brokerProfile?.office_name ?? '중개사'
  const title = `${officeName} - 내 조건 매물 등록 🏠`
  const region = prop.address ? prop.address.split(' ').slice(0, 2).join(' ') : ''
  const bodyText = [prop.deal_type, region].filter(Boolean).join(' · ') || '조건에 맞는 매물이 등록됐어요'

  let totalSent = 0
  await Promise.all(userIds.map(async uid => {
    try {
      const r = await sendPushToUser(uid, {
        title,
        body: bodyText,
        url: link,
        tag: `property-match-${prop.id}`,
      })
      totalSent += r.sent
    } catch (e) {
      console.error('[notify-customers] send failed', uid, e)
    }
  }))

  return NextResponse.json({ ok: true, matched: userIds.length, sent: totalSent })
}
