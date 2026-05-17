/**
 * 서버에서 푸시 알림 보내기 (web-push 사용).
 * @vercel/functions Node.js runtime 전제.
 */
import webpush from 'web-push'
import { createClient as createServerClient } from '@supabase/supabase-js'
import type { PushPayload } from './push'

let initialized = false
function init() {
  if (initialized) return
  const subject = process.env.VAPID_SUBJECT
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!subject || !pub || !priv) {
    throw new Error('VAPID 환경변수 누락 (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT)')
  }
  webpush.setVapidDetails(subject, pub, priv)
  initialized = true
}

/** 한 명의 모든 구독 디바이스로 알림 발송 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
  init()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  // service-role이 있으면 사용, 없으면 anon (RLS 통과 안 될 수 있어 service-role 권장)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const supa = createServerClient(url, key)

  const { data: subs } = await supa
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subs || subs.length === 0) return { sent: 0, failed: 0 }

  let sent = 0, failed = 0
  const expired: string[] = []

  await Promise.all(subs.map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      )
      sent++
    } catch (e: unknown) {
      failed++
      const err = e as { statusCode?: number }
      // 404/410이면 만료된 구독 → DB에서 삭제
      if (err.statusCode === 404 || err.statusCode === 410) {
        expired.push(s.id)
      }
    }
  }))

  if (expired.length > 0) {
    await supa.from('push_subscriptions').delete().in('id', expired)
  }

  return { sent, failed }
}
