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

type MsgRow = { body: string | null; image_url: string | null; image_paths: string[] | null; file_url: string | null; file_name: string | null; mention_ids: string[] | null }

/** 메신저 화면(ChatRoom 의 send·sendFiles)이 보내는 미리보기와 같은 규칙 */
function previewOf(m: MsgRow): string {
  if (m.body?.trim()) return m.body.slice(0, 80)
  if ((m.image_paths?.length ?? 0) > 1) return `사진 ${m.image_paths!.length}장을 보냈습니다`
  if (m.image_url || m.image_paths?.length) return '사진을 보냈습니다'
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

  // 조회는 두 번에 몰아 묻는다(예전엔 메시지마다 8~10번을 차례로 물었다).
  //  1차: 보낸 사람 · 스레드 · 접근 권한 · 방 멤버(알림 끔·대상 판정·설정까지 한 번에)
  //  2차: 방금 보낸 내 메시지 · (사무소 전체 방이면) 사무소 소속 전원
  // 권한 확인은 결과를 쓰기 전에 그대로 먼저 본다 — 같이 물어도 확인 전엔 아무에게도 보내지 않는다.
  type Pref = { notification_preferences: Record<string, boolean> | null }
  type Prefs = Pref | Pref[] | null
  type MemberProf = { user_id: string | null; parent_broker_id: string | null; is_approved: boolean | null; profiles: Prefs }
  type MemberRow = { broker_id: string; muted: boolean; broker_profiles: MemberProf | MemberProf[] | null }
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
  const chatOff = (p: Prefs) => one(p)?.notification_preferences?.office_chat === false

  const [meRes, threadRes, accessRes, memRes] = await Promise.all([
    // 보낸 사람 broker + 이름
    svc.from('broker_profiles').select('id, profiles:user_id(name)').eq('user_id', user.id).maybeSingle(),
    svc.from('office_chat_threads').select('id, kind, title, office_broker_id').eq('id', threadId).maybeSingle(),
    // 호출자가 이 스레드 접근 권한 있는지 확인 (RLS 함수 재사용)
    supabase.rpc('can_access_office_thread', { p_thread: threadId }),
    svc.from('office_chat_members')
      .select('broker_id, muted, broker_profiles!inner(user_id, parent_broker_id, is_approved, profiles:user_id(notification_preferences))')
      .eq('thread_id', threadId),
  ])
  const me = meRes.data
  if (!me) return NextResponse.json({ error: 'not_broker' }, { status: 403 })
  const senderName = (Array.isArray((me as any).profiles) ? (me as any).profiles[0]?.name : (me as any).profiles?.name) ?? '직원'
  const thread = threadRes.data
  if (!thread) return NextResponse.json({ error: 'thread_not_found' }, { status: 404 })
  if (!accessRes.data) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const members = (memRes.data ?? []) as unknown as MemberRow[]

  const [recentRes, groupRes] = await Promise.all([
    // 방금 보낸 내 메시지. 연달아 보내면 여러 개라, 화면이 보낸 미리보기와 맞는 것을 고르고
    // 없으면 가장 최근 것으로 만든다. 하나도 없으면 실제 메시지가 없는 호출이라 보내지 않는다.
    svc.from('office_chat_messages')
      .select('body, image_url, image_paths, file_url, file_name, mention_ids')
      .eq('thread_id', threadId)
      .eq('sender_broker_id', me.id)
      .is('deleted_at', null)
      .gte('created_at', new Date(Date.now() - RECENT_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(5),
    thread.kind === 'group'
      ? svc.from('broker_profiles')
        .select('user_id, is_owner, is_approved, parent_broker_id, id, profiles:user_id(notification_preferences)')
        .or(`id.eq.${thread.office_broker_id},parent_broker_id.eq.${thread.office_broker_id}`)
      : null,
  ])
  const recent = recentRes.data
  if (!recent?.length) return NextResponse.json({ ok: true, targets: 0, sent: 0, skipped: 'no_message' })
  const claimed = typeof body.preview === 'string' ? body.preview.slice(0, 80) : ''
  const previews = (recent as MsgRow[]).map(previewOf)
  const picked = Math.max(0, previews.indexOf(claimed))
  const preview = previews[picked]
  const mentionIds = new Set((recent as MsgRow[])[picked].mention_ids ?? [])

  // 대상 user_id 수집 — broker id 도 같이 둬서 @태그(broker id)를 따로 묻지 않고 맞춘다
  // (broker_profiles.user_id 는 한 사람에 한 줄 — 위 maybeSingle 이 그걸 전제로 한다)
  const targetUserIds = new Set<string>()
  const taggedUserIds = new Set<string>()
  const prefOff = new Set<string>()
  const add = (brokerId: string, userId: string | null, prefs: Prefs) => {
    if (!userId) return
    targetUserIds.add(userId)
    // @태그된 사람(지금 대상에 든 사람만) — 방 알림을 꺼 둬도 받는다
    if (mentionIds.has(brokerId)) taggedUserIds.add(userId)
    if (chatOff(prefs)) prefOff.add(userId)
  }
  if (thread.kind === 'group') {
    for (const r of groupRes?.data ?? []) {
      if (r.id === me.id) continue
      if (!(r.is_owner || r.is_approved)) continue
      add(r.id as string, r.user_id as string | null, (r as { profiles: Prefs }).profiles)
    }
  } else {
    // 멤버 행은 퇴사·승인 취소 뒤에도 남는다 — 지금 그 사무소 대표이거나 승인 직원인 사람만
    for (const m of members) {
      if (m.broker_id === me.id) continue
      const p = one(m.broker_profiles)
      if (!p) continue
      const current = m.broker_id === thread.office_broker_id
        || (p.parent_broker_id === thread.office_broker_id && p.is_approved)
      if (current) add(m.broker_id, p.user_id, p.profiles)
    }
  }

  // 이 방 알림을 끈 사람은 뺀다(채팅방 서랍의 '알림 끄기') — 태그된 사람은 남긴다
  for (const m of members) {
    if (!m.muted) continue
    const uid = one(m.broker_profiles)?.user_id
    if (uid && !taggedUserIds.has(uid)) targetUserIds.delete(uid)
  }

  // 설정 → 알림에서 '메시지' 를 끈 사람도 뺀다(키 office_chat — 옛 고객 화면의 messages 와 따로)
  for (const uid of prefOff) targetUserIds.delete(uid)

  const roomName = thread.kind === 'group' ? '사무소 전체' : thread.kind === 'team' ? (thread.title || '단체방') : null
  const title = roomName ? `${roomName} · ${senderName}` : senderName

  let sent = 0
  await Promise.all([...targetUserIds].map(async uid => {
    try {
      const r = await sendPushToUser(uid, {
        title: taggedUserIds.has(uid) ? `${title} · 나를 태그했어요` : title,
        body: preview,
        url: `/broker/messenger?t=${threadId}`,   // 알림을 누르면 그 방이 바로 열린다
        tag: `office-chat-${threadId}`,
      })
      sent += r.sent
    } catch { /* 푸시 실패 무시 */ }
  }))

  return NextResponse.json({ ok: true, targets: targetUserIds.size, sent })
}
