import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push-server'

/**
 * 사내 메신저 새 메시지 → 같은 스레드의 다른 멤버에게 푸시.
 * - group(사무소 전체): 사무소 소속 전원
 * - dm/team: office_chat_members 멤버
 * 호출자(보낸 사람)는 제외. 인증은 세션 쿠키.
 */
export async function POST(req: NextRequest) {
  let body: { threadId?: string; preview?: string } = {}
  try { body = await req.json() } catch { /* noop */ }
  const threadId = body.threadId
  if (!threadId) return NextResponse.json({ error: 'threadId required' }, { status: 400 })

  // 호출자 인증
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  const svc = createServiceClient(url, serviceKey)

  // 보낸 사람 broker + 이름
  const { data: me } = await svc
    .from('broker_profiles')
    .select('id, profiles:user_id(name)')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!me) return NextResponse.json({ error: 'not a broker' }, { status: 403 })
  const senderName = (Array.isArray((me as any).profiles) ? (me as any).profiles[0]?.name : (me as any).profiles?.name) ?? '직원'

  // 스레드
  const { data: thread } = await svc
    .from('office_chat_threads')
    .select('id, kind, title, office_broker_id')
    .eq('id', threadId)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'thread not found' }, { status: 404 })

  // 호출자가 이 스레드 접근 권한 있는지 확인 (RLS 함수 재사용)
  const { data: canAccess } = await supabase.rpc('can_access_office_thread', { p_thread: threadId })
  if (!canAccess) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // 대상 user_id 수집
  const targetUserIds = new Set<string>()
  if (thread.kind === 'group') {
    const { data: rows } = await svc
      .from('broker_profiles')
      .select('user_id, is_owner, is_approved, parent_broker_id, id')
      .or(`id.eq.${thread.office_broker_id},parent_broker_id.eq.${thread.office_broker_id}`)
    for (const r of rows ?? []) {
      if (r.id === me.id) continue
      if (!(r.is_owner || r.is_approved)) continue
      if (r.user_id) targetUserIds.add(r.user_id as string)
    }
  } else {
    const { data: mems } = await svc.from('office_chat_members').select('broker_id').eq('thread_id', threadId)
    const ids = (mems ?? []).map(m => m.broker_id).filter(id => id !== me.id)
    if (ids.length) {
      const { data: profs } = await svc.from('broker_profiles').select('user_id').in('id', ids)
      for (const p of profs ?? []) if (p.user_id) targetUserIds.add(p.user_id as string)
    }
  }

  const roomName = thread.kind === 'group' ? '사무소 전체' : thread.kind === 'team' ? (thread.title || '단체방') : null
  const title = roomName ? `${roomName} · ${senderName}` : senderName
  const preview = (body.preview ?? '').slice(0, 80) || '새 메시지'

  let sent = 0
  await Promise.all([...targetUserIds].map(async uid => {
    try {
      const r = await sendPushToUser(uid, {
        title,
        body: preview,
        url: '/broker/messenger',
        tag: `office-chat-${threadId}`,
      })
      sent += r.sent
    } catch { /* 푸시 실패 무시 */ }
  }))

  return NextResponse.json({ ok: true, targets: targetUserIds.size, sent })
}
