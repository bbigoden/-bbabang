import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

// 카카오 OVER_QUERY_LIMIT 회피용: 호수·층 부분을 제거해 같은 건물은 한 좌표로 캐싱.
// 매물장 page.tsx의 normalizeAddr와 동일 로직 (백필 스크립트와도 공유).
function normalizeAddr(a: string): string {
  return a
    .replace(/\s+[0-9A-Za-z\-]+\s*동\s+/, ' ')
    .replace(/\s+[0-9\-]+\s*호\s*$/, '')
    .replace(/\s*[Bb]?\d+층\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function POST(req: NextRequest) {
  // 인증 필수 — 중개사·관리자만 호출 가능
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Rate limit: 분당 60회 (등록·자동채움 폭주 대비)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const ok = await checkRateLimit(`ip:${ip}:geocode`, 60, 60)
  if (!ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const raw = String(body.address ?? '').trim()
  if (!raw) return NextResponse.json({ error: 'address_required' }, { status: 400 })

  const key = (process.env.KAKAO_REST_KEY ?? '').trim()
  if (!key) return NextResponse.json({ error: 'config_missing_kakao_key' }, { status: 500 })

  const query = normalizeAddr(raw)
  const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(query)}&analyze_type=similar`

  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, next: { revalidate: 86400 } })
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 })
  }
  if (!res.ok) return NextResponse.json({ error: 'upstream_failed', status: res.status }, { status: 502 })

  const json = await res.json().catch(() => null)
  const doc = json?.documents?.[0]
  if (!doc) return NextResponse.json({ lat: null, lng: null, normalized: query })

  const lat = parseFloat(doc.y)
  const lng = parseFloat(doc.x)
  if (!isFinite(lat) || !isFinite(lng)) return NextResponse.json({ lat: null, lng: null, normalized: query })

  return NextResponse.json({ lat, lng, normalized: query })
}
