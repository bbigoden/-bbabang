import { NextRequest, NextResponse, after } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendPushToUser } from '@/lib/push-server'
import { isBookable, normalizePhone, bookingSource, inAppSource, kstInstant, type BookingConfig, type BookingProduct } from '@/lib/booking'

/**
 * 예약 링크 페이지(/b/<slug>)의 서버.
 * GET  — 페이지 설정(상품·영업시간·쉬는 날). 켜진 페이지만.
 * POST — 손님 신청 → office_events 에 '확인 필요'로 넣고 담당 직원 폰에 알림.
 *
 * 손님은 로그인하지 않는다. 그래서 표(office_booking_pages·office_events)에 anon 정책을 두지 않고
 * 이 서버가 service_role 로만 읽고 쓴다. 받는 값은 전부 다시 검사한다(날짜·시각은 isBookable).
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/
const PUBLIC_COLS = 'title, intro, products, open_time, close_time, slot_minutes, closed_weekdays, lead_hours, max_days'

function service() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createServiceClient(url, key, { auth: { persistSession: false } })
}
const ipOf = (req: NextRequest) =>
  req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!(await checkRateLimit(`ip:${ipOf(req)}:booking-get`, 60, 60))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  const supa = service()
  if (!supa) return NextResponse.json({ error: 'config' }, { status: 500 })
  const { data } = await supa.from('office_booking_pages').select(PUBLIC_COLS).eq('slug', slug).eq('active', true).maybeSingle()
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const ip = ipOf(req)
  // 장난 신청 막기: 같은 곳에서 10분에 5번, 한 페이지에 1시간 40번
  const ok = await checkRateLimit(`ip:${ip}:booking-post`, 5, 600, true)
    && await checkRateLimit(`booking:${slug}:post`, 40, 3600, true)
  if (!ok) return NextResponse.json({ error: '신청이 너무 많아요. 잠시 뒤에 다시 해 주세요.' }, { status: 429 })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const str = (k: string, max: number) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '')

  // 사람 눈엔 안 보이는 칸 — 채워져 오면 로봇. 성공한 척만 한다
  if (str('website', 200)) return NextResponse.json({ ok: true })

  if (b.consent !== true) return NextResponse.json({ error: '개인정보 수집에 동의해 주세요.' }, { status: 400 })
  const name = str('name', 30)
  if (!name) return NextResponse.json({ error: '이름을 적어 주세요.' }, { status: 400 })
  const phone = normalizePhone(str('phone', 20))
  if (!phone) return NextResponse.json({ error: '연락처를 확인해 주세요.' }, { status: 400 })
  const date = str('date', 10), time = str('time', 5)
  const request = str('request', 500)
  const productName = str('product', 60)

  const supa = service()
  if (!supa) return NextResponse.json({ error: 'config' }, { status: 500 })
  const { data: page } = await supa.from('office_booking_pages')
    .select(`office_broker_id, owner_broker_id, ${PUBLIC_COLS}`).eq('slug', slug).eq('active', true).maybeSingle()
  if (!page) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const cfg = page as unknown as BookingConfig & { office_broker_id: string; owner_broker_id: string }

  if (!isBookable(cfg, date, time)) {
    return NextResponse.json({ error: '고를 수 없는 날짜·시간이에요. 다시 골라 주세요.' }, { status: 400 })
  }
  const products = (Array.isArray(cfg.products) ? cfg.products : []) as BookingProduct[]
  const product = products.find(p => p.name === productName)
  if (products.length && !product) return NextResponse.json({ error: '상품을 골라 주세요.' }, { status: 400 })

  const ua = req.headers.get('user-agent')
  const picked = str('from', 10)
  const source = bookingSource(ua, picked)
  const how = inAppSource(ua) ? '앱 안에서 열림(자동)' : source !== 'link' ? '손님이 고름' : '알 수 없음'
  const title = product ? product.name : '예약'
  const { error } = await supa.from('office_events').insert({
    office_broker_id: cfg.office_broker_id,
    owner_broker_id: cfg.owner_broker_id,
    starts_at: kstInstant(date, time).toISOString(),
    title,
    amount: product?.price ?? null,
    customer_name: name,
    customer_phone: phone,
    memo: request || null,
    source,
    source_text: `예약 페이지에서 신청 · 들어온 곳: ${how}\n상품: ${title}${request ? `\n요청: ${request}` : ''}`,
    status: 'pending',
  })
  if (error) {
    console.error('[booking] insert failed', error)
    return NextResponse.json({ error: '접수하지 못했어요. 잠시 뒤에 다시 해 주세요.' }, { status: 500 })
  }

  // 담당 직원 폰에 알림 — 손님에게 먼저 답하고 그 뒤에 보낸다(기기 4대에 보내느라 '보내는 중'이 길었다).
  // 실패해도 신청은 받은 것
  after(async () => {
    try {
      const { data: owner } = await supa.from('broker_profiles').select('user_id').eq('id', cfg.owner_broker_id).maybeSingle()
      if (owner?.user_id) {
        const [, m, d] = date.split('-').map(Number)
        await sendPushToUser(owner.user_id, {
          title: '새 예약 신청',
          body: `${name} · ${m}/${d} ${time} · ${title}`,
          url: '/broker/events',
          tag: 'booking',
        })
      }
    } catch (e) {
      console.error('[booking] push failed', e)
    }
  })

  return NextResponse.json({ ok: true })
}
