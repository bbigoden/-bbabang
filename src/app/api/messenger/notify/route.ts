import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push-server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 사내 메신저 새 메시지 → 같은 스레드의 다른 멤버에게 푸시.
 * - group(사무소 전체): 사무소 소속 전원
 * - dm/team: office_chat_members 멤버 중 지금도 그 사무소 대표·승인 직원인 사람
 * 호출자(보낸 사람)는 제외. 인증은 세션 쿠키.
 *
 * 미리보기 문구는 호출자가 보낸 값을 그대로 쓰지 않는다. 예전엔 스레드 접근만 되면
 * 메시지를 보내지 않고도 사무소 전원에게 아무 문구나 무제한 푸시할 수 있었다.
 * 이제 방금(2분 안) 이 스레드에 내가 보낸 메시지가 있을 때만 보내고, 문구도 그 메시지로 만든다.
 */
const RECENT_MS = 2 * 60 * 1000

type MsgRow = { body: string | null; image_url: string | null; file_url: string | null; file_name: string | null }

/** 메신저 화면(send·sendAttachment)이 보내던 미리보기와 같은 규칙 */
function previewOf(m: MsgRow): string {
  if (m.body?.trim()) return m.body.slice(0, 80)
  if (m.image_url) return '사진을 보냈습니다'
  if (m.file_url) return `파일: ${m.file_name ?? ''}`.slice(0, 80)
  return '새 메시지'
}

export async function POST(req: NextRequest) {
  let body: { threadId?: unknown; preview?: unknown } = {}
  try { body = await req.json() } catch { /* noop */ }
  const threadId = typeof body.threadId === 'string' ? body.threadId : ''
  if (!threadId) return NextResponse.json({ error: 'thread_id_required' }, { status: 400 })

  // 호출자 인증
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth?.user
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 푸시는 strict — DB 장애 시 차단. 메시지마다 한 번이라 분당 60회면 넉넉하다.
  if (!await checkRateLimit(`user:${user.id}:messenger-notify`, 60, 60, true)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

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
  if (!me) return NextResponse.json({ error: 'not_broker' }, { status: 403 })
  const senderName = (Array.isArray((me as any).profiles) ? (me as any).profiles[0]?.name : (me as any).profiles?.name) ?? '직원'

  // 스레드
  const { data: thread } = await svc
    .from('office_chat_threads')
    .select('id, kind, title, office_broker_id')
    .eq('id', threadId)
    .maybeSingle()
  if (!thread) return NextResponse.json({ error: 'thread_not_found' }, { status: 404 })

  // 호출자가 이 스레드 접근 권한 있는지 확인 (RLS 함수 재사용)
  const { data: canAccess } = await supabase.rpc('can_access_office_thread', { p_thread: threadId })
  if (!canAccess) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // 방금 보낸 내 메시지. 연달아 보내면 여러 개라, 화면이 보낸 미리보기와 맞는 것을 고르고
  // 없으면 가장 최근 것으로 만든다. 하나도 없으면 실제 메시지가 없는 호출이라 보내지 않는다.
  const { data: recent } = await svc
    .from('office_chat_messages')
    .select('body, image_url, file_url, file_name')
    .eq('thread_id', threadId)
    .eq('sender_broker_id', me.id)
    .gte('created_at', new Date(Date.now() - RECENT_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(5)
  if (!recent?.length) return NextResponse.json({ ok: true, targets: 0, sent: 0, skipped: 'no_message' })
  const claimed = typeof body.preview === 'string' ? body.preview.slice(0, 80) : ''
  const previews = (recent as MsgRow[]).map(previewOf)
  const preview = previews.find(p => p === claimed) ?? previews[0]

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
      // 멤버 행은 퇴사·승인 취소 뒤에도 남는다 — 지금 그 사무소 대표이거나 승인 직원인 사람만
      const { data: profs } = await svc
        .from('broker_profiles')
        .select('id, user_id, parent_broker_id, is_approved')
        .in('id', ids)
      for (const p of profs ?? []) {
        const current = p.id === thread.office_broker_id
          || (p.parent_broker_id === thread.office_broker_id && p.is_approved)
        if (current && p.user_id) targetUserIds.add(p.user_id as string)
      }
    }
  }

  const roomName = thread.kind === 'group' ? '사무소 전체' : thread.kind === 'team' ? (thread.title || '단체방') : null
  const title = roomName ? `${roomName} · ${senderName}` : senderName

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
