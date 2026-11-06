import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@supabase/supabase-js'
import { sendPushToUser } from '@/lib/push-server'
import { todayKST, addDays, hmKST } from '@/lib/date-kst'
import { kstInstant } from '@/lib/booking'

/**
 * 아침 예약 알림 — 매일 한국 08:00(vercel.json '0 23 * * *' = UTC 23:00) 담당 직원 폰으로
 * "오늘 예약 N건 · 11:00 꽃다발 …" 과 아직 확인 안 한 신청 수를 보낸다(11-06 사장님 1번).
 * 받는 사람은 일정의 담당(owner_broker_id) — 대표는 보기만 하므로 자기 일정이 없으면 안 받는다.
 * ?dry=1 은 보내지 않고 무엇을 보낼지만 돌려준다.
 */
type Row = { owner_broker_id: string; starts_at: string; title: string; customer_name: string | null; status: string }

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'configuration_error' }, { status: 500 })
  const supa = createServerClient(url, key)
  const dry = req.nextUrl.searchParams.get('dry') === '1'

  const today = todayKST()
  const from = kstInstant(today, '00:00').toISOString()
  const to = kstInstant(addDays(today, 1), '00:00').toISOString()
  const [{ data: todays, error: e1 }, { data: pend, error: e2 }] = await Promise.all([
    supa.from('office_events').select('owner_broker_id, starts_at, title, customer_name, status')
      .gte('starts_at', from).lt('starts_at', to).in('status', ['pending', 'confirmed']).order('starts_at'),
    supa.from('office_events').select('owner_broker_id').eq('status', 'pending').gte('starts_at', from),
  ])
  if (e1 || e2) return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 })

  const byOwner = new Map<string, { today: Row[]; pending: number }>()
  const get = (id: string) => byOwner.get(id) ?? (byOwner.set(id, { today: [], pending: 0 }), byOwner.get(id)!)
  for (const r of (todays ?? []) as Row[]) get(r.owner_broker_id).today.push(r)
  for (const r of pend ?? []) get(r.owner_broker_id as string).pending++
  if (!byOwner.size) return NextResponse.json({ ok: true, owners: 0 })

  const { data: owners } = await supa.from('broker_profiles').select('id, user_id').in('id', [...byOwner.keys()])
  const out: { owner: string; title: string; body: string; sent?: number }[] = []
  for (const o of owners ?? []) {
    const v = byOwner.get(o.id)!
    const title = v.today.length ? `오늘 예약 ${v.today.length}건` : '오늘 예약은 없어요'
    const lines = v.today.slice(0, 5).map(r => `${hmKST(r.starts_at)} ${r.title}${r.customer_name ? ` · ${r.customer_name}` : ''}${r.status === 'pending' ? ' (미확인)' : ''}`)
    if (v.today.length > 5) lines.push(`외 ${v.today.length - 5}건`)
    if (v.pending) lines.push(`확인 안 한 신청 ${v.pending}건`)
    const body = lines.join('\n')
    const item: (typeof out)[number] = { owner: o.id, title, body }
    if (!dry && o.user_id) {
      const r = await sendPushToUser(o.user_id, { title, body, url: '/broker/events', tag: 'events-morning' })
      item.sent = r.sent
    }
    out.push(item)
  }
  return NextResponse.json({ ok: true, today, dry, out })
}
