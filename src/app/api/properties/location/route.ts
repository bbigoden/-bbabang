import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { buildLocationCard, locationKindOf } from '@/lib/location-card'
import { buildListingCopy } from '@/lib/listing-copy'

// 세움터는 느릴 때 20초까지 기다린다
export const maxDuration = 60

// 브이월드 키는 이 도메인으로 발급돼 있다(사업자 확인 auto-verify 와 같은 값)
const VWORLD_DOMAIN = 'bbabang.vercel.app'

/** 매물 소재지(+종류) → 입지 카드와 광고 문안. 로그인한 사무소 사람만. */
export async function POST(req: NextRequest) {
  const seumKey = process.env.SEUM_API_KEY
  const kakaoKey = process.env.KAKAO_REST_KEY
  const vworldKey = process.env.VWORLD_API_KEY
  if (!seumKey || !kakaoKey || !vworldKey) {
    return NextResponse.json({ error: 'config_missing' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 한 번 열 때 공공 API 를 수십 번 부른다(대부분 하루 캐시) — 사람당 시간에 60번이면 상담 중 넉넉하다
  if (!(await checkRateLimit(`user:${data.user.id}:location`, 60, 3600))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { address?: unknown; roomType?: unknown } | null
  const address = typeof body?.address === 'string' ? body.address.trim().slice(0, 200) : ''
  if (!address) return NextResponse.json({ error: 'address_required' }, { status: 400 })

  // 매물 종류(상가·공장창고·토지)에 따라 받는 재료와 문안이 다르다
  const kind = locationKindOf(typeof body?.roomType === 'string' ? body.roomType : null)
  const r = await buildLocationCard(address, { seumKey, kakaoKey, vworldKey, vworldDomain: VWORLD_DOMAIN }, kind)
  if (!r.card) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ card: r.card, copy: buildListingCopy(r.card) })
}
