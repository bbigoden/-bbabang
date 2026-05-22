import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push-server'

/**
 * 매일 1회 호출 (Vercel cron). vercel.json에 정의.
 * - 25일 이상 활성 요청 → 갱신 권유 알림 (한 번만)
 * - 30일 이상 활성 요청 → 자동 마감
 *
 * 인증: Vercel cron은 자동으로 헤더에 CRON_SECRET을 포함시킴.
 * 또는 Authorization: Bearer CRON_SECRET 검증.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const secret = process.env.CRON_SECRET
  // Vercel cron은 Authorization: Bearer <CRON_SECRET>를 자동 추가.
  // secret 미설정 시 호출 전부 차단 (서비스 가용성보다 보안 우선)
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    // 내부 환경변수 이름 노출 금지
    console.error('[cron/expire-requests] 서버 설정 누락')
    return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  }

  const supa = createServerClient(url, serviceKey)
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  // 25~30일 활성 요청 → 갱신 권유 (이미 알림 받은 건 제외)
  const renewalSince = new Date(now - 30 * day).toISOString()
  const renewalUntil = new Date(now - 25 * day).toISOString()
  const { data: renewalTargets } = await supa
    .from('request_posts')
    .select('id, user_id, city, district')
    .eq('status', 'active')
    .gte('created_at', renewalSince)
    .lte('created_at', renewalUntil)

  let renewalNotified = 0
  let renewalPushed = 0
  for (const r of renewalTargets ?? []) {
    // 이미 갱신 권유 알림을 받았는지 체크
    const { data: existing } = await supa
      .from('notifications')
      .select('id')
      .eq('user_id', r.user_id)
      .eq('type', 'request_renewal_reminder')
      .eq('link', `/request/${r.id}`)
      .limit(1)
      .maybeSingle()
    if (existing) continue

    const region = [r.city, r.district].filter(Boolean).join(' ') || '내'
    await supa.from('notifications').insert({
      user_id: r.user_id,
      type: 'request_renewal_reminder',
      title: '요청이 곧 마감돼요 ⏰',
      body: `'${region}' 요청이 5일 후 자동 마감됩니다. 아직 찾고 계시면 갱신해주세요.`,
      link: `/request/${r.id}`,
    })
    renewalNotified++

    try {
      const p = await sendPushToUser(r.user_id, {
        title: '요청이 곧 마감돼요',
        body: `'${region}' 요청이 5일 후 자동 마감됩니다.`,
        url: `/request/${r.id}`,
        tag: `renewal-${r.id}`,
      })
      renewalPushed += p.sent
    } catch {/* 푸시 실패 무시 */}
  }

  // 30일 이상 활성 요청 → 자동 마감
  const expireBefore = new Date(now - 30 * day).toISOString()
  const { data: expireTargets } = await supa
    .from('request_posts')
    .select('id, user_id, city, district')
    .eq('status', 'active')
    .lte('created_at', expireBefore)

  let expired = 0
  for (const r of expireTargets ?? []) {
    const { error } = await supa
      .from('request_posts')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('id', r.id)
    if (error) continue
    expired++

    const region = [r.city, r.district].filter(Boolean).join(' ') || '내'
    await supa.from('notifications').insert({
      user_id: r.user_id,
      type: 'request_expired',
      title: '요청이 자동 마감됐어요',
      body: `'${region}' 요청이 30일 경과로 마감됐어요. 다시 등록하면 새 제안을 받을 수 있어요.`,
      link: `/request/${r.id}`,
    })
  }

  // ─────────────────────────────────────────────
  // 매물 자동 정리 — 180일 이상 available인 매물에게 갱신 권유
  // ─────────────────────────────────────────────
  const propertyOldSince = new Date(now - 180 * day).toISOString()
  const { data: oldProperties } = await supa
    .from('broker_properties')
    .select('id, broker_id, address, broker_profiles(user_id)')
    .eq('status', 'available')
    .lte('created_at', propertyOldSince)

  let propertyNotified = 0
  for (const p of oldProperties ?? []) {
    const brokerUserId = (p.broker_profiles as any)?.user_id
    if (!brokerUserId) continue

    // 이미 알림 받은 적 있는지 (최근 30일)
    const { data: existing } = await supa
      .from('notifications')
      .select('id')
      .eq('user_id', brokerUserId)
      .eq('type', 'property_stale_reminder')
      .eq('link', `/broker/properties/${p.id}`)
      .gte('created_at', new Date(now - 30 * day).toISOString())
      .limit(1)
      .maybeSingle()
    if (existing) continue

    await supa.from('notifications').insert({
      user_id: brokerUserId,
      type: 'property_stale_reminder',
      title: '오래된 매물 확인 필요 🏚️',
      body: `'${p.address ?? '주소 없음'}' 매물이 180일 넘게 활성 상태예요. 계약 완료됐다면 상태를 변경해주세요.`,
      link: `/broker/properties/${p.id}`,
    })
    propertyNotified++

    try {
      await sendPushToUser(brokerUserId, {
        title: '오래된 매물 확인',
        body: `'${(p.address ?? '').slice(0, 30)}' 매물 상태를 확인해주세요`,
        url: `/broker/properties/${p.id}`,
        tag: `stale-prop-${p.id}`,
      })
    } catch {}
  }

  // ─────────────────────────────────────────────
  // 저장된 검색 — last_checked_at 이후 매칭되는 새 데이터 있으면 알림
  // ─────────────────────────────────────────────
  const { data: searches } = await supa
    .from('saved_searches')
    .select('*')

  let savedSearchNotified = 0
  for (const s of searches ?? []) {
    const since = s.last_checked_at
    let matchCount = 0
    let label = ''

    if (s.target === 'broker') {
      let q = supa.from('broker_profiles').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('is_owner', true)
      if (s.filters.sido) q = q.ilike('address', `${s.filters.sido}%`)
      if (s.filters.sigungu) q = q.ilike('address', `%${s.filters.sigungu}%`)
      if (s.filters.verified) q = q.eq('is_verified', true)
      const { count } = await q
      matchCount = count ?? 0
      label = s.label || '저장된 중개사 검색'
    } else if (s.target === 'request') {
      let q = supa.from('request_posts').select('id', { count: 'exact', head: true }).gte('created_at', since).eq('status', 'active')
      if (s.filters.city) q = q.eq('city', s.filters.city)
      if (s.filters.district) q = q.eq('district', s.filters.district)
      if (s.filters.dong) q = q.eq('dong', s.filters.dong)
      if (s.filters.deal_type) q = q.ilike('deal_type', `%${s.filters.deal_type}%`)
      const { count } = await q
      matchCount = count ?? 0
      label = s.label || '저장된 요청 검색'
    }

    if (matchCount > 0) {
      await supa.from('notifications').insert({
        user_id: s.user_id,
        type: 'saved_search_match',
        title: `'${label}' 새 매칭 ${matchCount}건`,
        body: `저장한 조건에 맞는 ${s.target === 'broker' ? '중개사' : '요청'}가 새로 등록됐어요`,
        link: '/saved-searches',
      })
      savedSearchNotified++
    }
    // 마지막 체크 시각 갱신
    await supa.from('saved_searches').update({ last_checked_at: new Date().toISOString() }).eq('id', s.id)
  }

  // ─────────────────────────────────────────────
  // 빈 매물 자동 청소 — 24시간 이상 모든 핵심 필드가 빈 매물 삭제
  // (+ 매물 등록 버튼만 누르고 떠난 잔존물)
  // ─────────────────────────────────────────────
  const emptyBefore = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const { data: emptyRows } = await supa
    .from('broker_properties')
    .select('id')
    .eq('status', 'available')
    .or('address.is.null,address.eq.')
    .or('deal_type.is.null,deal_type.eq.')
    .or('room_type.is.null,room_type.eq.')
    .eq('price', 0)
    .lt('created_at', emptyBefore)

  let emptyCleaned = 0
  if (emptyRows && emptyRows.length > 0) {
    const ids = emptyRows.map(r => r.id)
    const { error } = await supa.from('broker_properties').delete().in('id', ids)
    if (!error) emptyCleaned = ids.length
  }

  return NextResponse.json({
    ok: true,
    renewalReminders: { matched: renewalTargets?.length ?? 0, notified: renewalNotified, pushed: renewalPushed },
    expired,
    staleProperties: { matched: oldProperties?.length ?? 0, notified: propertyNotified },
    savedSearches: { checked: searches?.length ?? 0, notified: savedSearchNotified },
    emptyPropertiesCleaned: emptyCleaned,
  })
}
