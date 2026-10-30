import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { parseBankAddress, splitRoadAddress } from '@/lib/bank-draft-plan'

/**
 * 도로명으로 적힌 소재지 → 뱅크가 받는 지번 소재지.
 * '충남 천안시 서북구 불당33길 7 베스트타워 403호'
 *   → '충남 천안시 서북구 불당동 1638 베스트타워 403호 (충남 천안시 서북구 불당33길 7)'
 * 뱅크 등록 화면은 읍·면·동과 본번·부번을 고르는 칸이라 도로명을 받지 않는다(#2098).
 * 원래 도로명은 괄호로 남긴다 — parseBankAddress 가 괄호는 상세주소에서 뺀다.
 * 못 찾으면 { address: null }.
 */
export async function POST(req: NextRequest) {
  const supa = await createClient()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!await checkRateLimit(`ip:${ip}:bank-address`, 30, 60)) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const split = splitRoadAddress(String(body.address ?? ''))
  if (!split) return NextResponse.json({ address: null })

  const key = (process.env.KAKAO_REST_KEY ?? '').trim()
  if (!key) return NextResponse.json({ error: 'config_missing_kakao_key' }, { status: 500 })

  let doc: any = null
  try {
    const res = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(split.road)}`,
      { headers: { Authorization: `KakaoAK ${key}` }, next: { revalidate: 86400 } })
    if (!res.ok) return NextResponse.json({ error: 'upstream_failed' }, { status: 502 })
    doc = (await res.json().catch(() => null))?.documents?.[0] ?? null
  } catch {
    return NextResponse.json({ error: 'upstream_failed' }, { status: 502 })
  }
  // 산 지번은 뱅크에서 '산' 을 따로 골라야 해 아직 못 넣는다
  const jibun = doc?.address
  if (!jibun?.address_name || jibun.mountain_yn === 'Y') return NextResponse.json({ address: null })

  const address = `${jibun.address_name}${split.rest ? ` ${split.rest}` : ''} (${split.road})`
  if (!parseBankAddress(address)) return NextResponse.json({ address: null })
  return NextResponse.json({ address })
}
