import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 국세청 사업자등록 상태조회 API wrapper.
 *
 * POST { businessNumber: "123-45-67890" } (또는 숫자만)
 *  → { ok: true, status: { b_stt, b_stt_cd, ... }, raw }
 *
 * 이 라우트는 인증된 사용자가 자기 broker_profile의 사업자번호를 검증할 때 호출.
 * 검증 성공 시 broker_profiles.verification_info.business JSONB에 결과 저장.
 *
 * env: PUBLICDATA_API_KEY (공공데이터포털 발급, decoding 인증키)
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.PUBLICDATA_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'config_missing_publicdata_key' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Rate limit: 사용자당 시간당 5회 (사업자번호 검증 quota 보호)
  const allowed = await checkRateLimit(`user:${user.id}:verify-business`, 5, 3600)
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  let body: { businessNumber?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }) }

  const rawBn = (body.businessNumber ?? '').replace(/[^0-9]/g, '')
  if (rawBn.length !== 10) {
    return NextResponse.json({ error: 'invalid_business_number' }, { status: 400 })
  }

  // 국세청 사업자등록 상태조회 API (status)
  // 엔드포인트: https://api.odcloud.kr/api/nts-businessman/v1/status
  // POST JSON: { b_no: ["1234567890"] }
  // 응답 data[0]: { b_no, b_stt(계속사업자/휴업자/폐업자), b_stt_cd(01/02/03), tax_type, end_dt, utcc_yn, ... }
  const url = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(apiKey)}`
  let r: Response
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ b_no: [rawBn] }),
      cache: 'no-store',
    })
  } catch (e) {
    console.error('[verify-business] fetch failed', e)
    return NextResponse.json({ error: 'upstream_fetch_failed' }, { status: 502 })
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    return NextResponse.json({ error: 'upstream_error', status: r.status, detail: text.slice(0, 200) }, { status: 502 })
  }

  const json = await r.json() as { data?: Array<Record<string, unknown>>; status_code?: string }
  const row = json.data?.[0]
  if (!row) {
    return NextResponse.json({ error: 'upstream_empty', raw: json }, { status: 502 })
  }

  // b_stt_cd: 01=계속사업자, 02=휴업자, 03=폐업자
  const bSttCd = String(row.b_stt_cd ?? '')
  const isActive = bSttCd === '01'

  // broker_profile 업데이트 (해당 사용자 본인 것만)
  const verifyInfo = {
    verified_at: new Date().toISOString(),
    b_no: rawBn,
    b_stt: row.b_stt,
    b_stt_cd: row.b_stt_cd,
    tax_type: row.tax_type,
    end_dt: row.end_dt,
    is_active: isActive,
  }

  // 기존 verification_info 보존 + business 키만 갱신 (office/manual 영향 X)
  const { data: existing } = await supabase
    .from('broker_profiles')
    .select('verification_info')
    .eq('user_id', user.id)
    .maybeSingle()

  const merged = {
    ...((existing?.verification_info as Record<string, unknown>) ?? {}),
    business: verifyInfo,
  }
  await supabase
    .from('broker_profiles')
    .update({ verification_info: merged })
    .eq('user_id', user.id)

  return NextResponse.json({
    ok: true,
    isActive,
    status: verifyInfo,
  })
}
