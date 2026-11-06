import { NextRequest, NextResponse, after } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createHash, timingSafeEqual } from 'crypto'
import { sendPushToUser } from '@/lib/push-server'
import { kstInstant, normalizePhone } from '@/lib/booking'
import { inboundKey, looksLikeNaverBooking, mailText, parseNaverMail } from '@/lib/naver-booking-mail'

/**
 * 네이버예약 알림 메일 받기 — POST /api/inbound/naver/<예약링크 slug>?key=<열쇠>
 *
 * 넘겨주는 쪽 두 가지를 다 받는다.
 *  - 구글 스크립트(scripts/naver-booking-gmail.gs): { from, subject, text, html, id }
 *  - Postmark 받기: { From, Subject, TextBody, HtmlBody, MessageID }
 *
 * 어느 사무소·누구 일정으로 넣을지는 그 slug 의 예약 페이지(office_booking_pages)를 따른다.
 * 담당을 바꾸려면 예약 페이지 담당만 바꾸면 된다.
 * 열쇠는 slug 와 CRON_SECRET 으로 만든다(inboundKey) — CRON_SECRET 을 바꾸면 스크립트 주소도 바꿔야 한다.
 */

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const given = req.nextUrl.searchParams.get('key') ?? ''
  const want = inboundKey(slug)
  if (!process.env.CRON_SECRET || given.length !== want.length
    || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const from = s(b.from ?? b.From, 300)
  const subject = s(b.subject ?? b.Subject, 300)
  const body = mailText(s(b.text ?? b.TextBody, 50_000), s(b.html ?? b.HtmlBody, 200_000)).slice(0, 20_000)
  const msgId = s(b.id ?? b.MessageID, 300)

  if (!looksLikeNaverBooking(from, subject, body)) return NextResponse.json({ ok: true, skipped: 'not_naver_booking' })

  const supa = service()
  if (!supa) return NextResponse.json({ error: 'config' }, { status: 500 })
  const { data: page } = await supa.from('office_booking_pages')
    .select('office_broker_id, owner_broker_id').eq('slug', slug).maybeSingle()
  if (!page) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const m = parseNaverMail(subject, body)
  // 예약번호를 못 읽으면 메일 번호로 — 스크립트가 같은 메일을 두 번 보내도 한 건만
  const ref = m.ref ?? `mail:${createHash('sha1').update(msgId || `${subject}\n${body}`).digest('hex').slice(0, 20)}`
  const startsAt = m.date ? kstInstant(m.date, m.time ?? '00:00').toISOString() : null
  const sourceText = `네이버예약 메일 · ${subject}\n\n${body}`.slice(0, 8000)

  // 취소·변경은 이미 들어온 같은 예약번호를 고친다
  if (m.ref && (m.kind === 'canceled' || m.kind === 'changed')) {
    const { data: old } = await supa.from('office_events').select('id, status')
      .eq('office_broker_id', page.office_broker_id).eq('source', 'naver').eq('source_ref', m.ref).maybeSingle()
    if (old) {
      const patch: Record<string, unknown> = { source_text: sourceText }
      if (m.kind === 'canceled') patch.status = 'canceled'
      else if (startsAt) patch.starts_at = startsAt
      await supa.from('office_events').update(patch).eq('id', old.id)
      notify(supa, page.owner_broker_id, m.kind === 'canceled' ? '네이버예약 취소' : '네이버예약 변경', m, 'naver-change')
      return NextResponse.json({ ok: true, updated: old.id })
    }
    if (m.kind === 'canceled') return NextResponse.json({ ok: true, skipped: 'cancel_unknown' })
  }

  const { error } = await supa.from('office_events').insert({
    office_broker_id: page.office_broker_id,
    owner_broker_id: page.owner_broker_id,
    starts_at: startsAt,
    title: m.product || '네이버예약',
    amount: m.amount,
    customer_name: m.name,
    customer_phone: (m.phone && normalizePhone(m.phone)) || m.phone,
    memo: m.request,
    source: 'naver',
    source_ref: ref,
    source_text: sourceText,
    status: m.kind === 'confirmed' ? 'confirmed' : 'pending',
  })
  if (error) {
    if (error.code === '23505') return NextResponse.json({ ok: true, skipped: 'duplicate' })
    console.error('[inbound-naver] insert failed', error)
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }
  notify(supa, page.owner_broker_id, '새 네이버예약', m, 'booking')
  return NextResponse.json({ ok: true, parsed: { ref: m.ref, name: m.name, date: m.date, time: m.time, product: m.product } })
}

function notify(supa: NonNullable<ReturnType<typeof service>>, ownerId: string, title: string, m: ReturnType<typeof parseNaverMail>, tag: string) {
  after(async () => {
    try {
      const { data: owner } = await supa.from('broker_profiles').select('user_id').eq('id', ownerId).maybeSingle()
      if (!owner?.user_id) return
      const when = m.date ? `${Number(m.date.slice(5, 7))}/${Number(m.date.slice(8, 10))}${m.time ? ` ${m.time}` : ''}` : '날짜 확인 필요'
      await sendPushToUser(owner.user_id, {
        title,
        body: [m.name, when, m.product].filter(Boolean).join(' · '),
        url: '/broker/events',
        tag,
      })
    } catch (e) {
      console.error('[inbound-naver] push failed', e)
    }
  })
}
