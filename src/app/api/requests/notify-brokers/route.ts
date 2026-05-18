import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendPushToUser } from '@/lib/push-server'

/**
 * 새 고객 요청 등록 후 호출.
 * - request의 city/district/dong과 매칭되는 alert_regions를 가진 중개사를 찾아
 * - 각 중개사에게 푸시 알림 발송
 *
 * POST { requestId } — 인증된 사용자 본인의 request만 대상
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

  let body: { requestId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: '잘못된 요청' }, { status: 400 }) }
  if (!body.requestId) return NextResponse.json({ error: 'requestId 필요' }, { status: 400 })

  // 요청 본문 조회 + 소유권 확인
  const { data: post } = await supabase
    .from('request_posts')
    .select('id, user_id, city, district, dong, deal_type, room_type, min_price, max_price')
    .eq('id', body.requestId)
    .single()
  if (!post) return NextResponse.json({ error: '요청을 찾을 수 없습니다' }, { status: 404 })
  if (post.user_id !== user.id) return NextResponse.json({ error: '본인 요청만 알림 발송 가능' }, { status: 403 })
  if (!post.city || !post.district) return NextResponse.json({ ok: true, sent: 0, skipped: 'region_empty' })

  // 점수 기반 추천 — 상위 20명에게만 푸시 (스팸 방지)
  const { data: matches, error: rpcErr } = await supabase.rpc('recommend_brokers_for_request', {
    p_request_id: post.id,
    p_limit: 20,
  })
  if (rpcErr) {
    console.error('[notify-brokers] rpc error', rpcErr)
    return NextResponse.json({ error: '매칭 조회 실패' }, { status: 500 })
  }

  // score > 0 + 지역 매칭(region_score > 0)인 중개사만 푸시
  const targets = ((matches ?? []) as Array<{ user_id: string; broker_id: string; score: number; region_score: number }>)
    .filter(m => m.region_score > 0)
  if (targets.length === 0) return NextResponse.json({ ok: true, sent: 0, matched: 0 })

  // 푸시 발송 (실패는 무시, 다음 단계로 진행)
  const region = `${post.city} ${post.district}${post.dong ? ` ${post.dong}` : ''}`
  const summary = [post.deal_type, post.room_type].filter(Boolean).join(' · ')
  const title = `${region} 새 고객 요청`
  const bodyText = summary || '새 고객 요청이 등록됐어요'

  let totalSent = 0
  await Promise.all(targets.map(async t => {
    try {
      const r = await sendPushToUser(t.user_id, {
        title,
        body: bodyText,
        url: `/request/${post.id}`,
        tag: `request-${post.id}`,
      })
      totalSent += r.sent
    } catch (e) {
      console.error('[notify-brokers] send failed', t.user_id, e)
    }
  }))

  return NextResponse.json({ ok: true, matched: targets.length, sent: totalSent })
}
