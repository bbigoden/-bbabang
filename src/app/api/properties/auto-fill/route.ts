import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rate-limit'
import { mapPurposeToRoomType } from '@/lib/property-types'
import { lookupBuilding, type AutoFillBody } from '@/lib/building-lookup'

// 봇/외부 클라이언트용: Authorization: Bearer <access_token> 헤더로 인증
async function getUserFromBearer(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const token = auth.slice(7).trim()
  if (!token) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url || !anon) return null
  const supa = createSupabaseClient(url, anon)
  const { data, error } = await supa.auth.getUser(token)
  if (error) return null
  return data.user
}

export async function POST(req: NextRequest) {
  if (!process.env.SEUM_API_KEY) {
    return NextResponse.json({ error: 'config_missing_seum_key' }, { status: 500 })
  }

  // 인증 확인 — 로그인한 사용자(중개사)만 호출 가능
  // Bearer 토큰(봇/외부 클라이언트) 우선, 없으면 쿠키 세션(브라우저)
  let user = await getUserFromBearer(req)
  if (!user) {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    user = data.user
  }
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Rate limit: 사용자당 시간당 30회 (세움터 API quota 보호)
  const allowed = await checkRateLimit(`user:${user.id}:auto-fill`, 30, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  let body: AutoFillBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  const r = await lookupBuilding(body, {
    seumKey: process.env.SEUM_API_KEY ?? '',
    kakaoKey: process.env.KAKAO_REST_KEY ?? '',
    mapRoomType: mapPurposeToRoomType,
  })
  return NextResponse.json(r.data, r.status === 200 ? undefined : { status: r.status })
}
