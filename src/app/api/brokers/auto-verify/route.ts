import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rate-limit'

/**
 * 사무소 자동 인증 — 사업자등록번호(국세청) + 중개사무소등록번호(국토부 VWorld)
 * 둘 다 통과하면 관리자 손 없이 is_verified 배지를 자동 부여한다.
 *
 * POST (body 없음) — 검증 재료는 클라이언트를 믿지 않고 전부 DB에 저장된 값으로 재조회:
 *   broker_profiles.business_reg_number / office_reg_number / office_name + profiles.name
 *
 * 판정 기준 (전부 충족 시에만 자동 부여, 하나라도 미달이면 기존 수동 인증 폴백):
 *   A. 국세청 상태조회: 계속사업자(b_stt_cd=01)
 *   B. 국토부 중개업 조회(jurirno=등록번호): 등록 존재 + 영업중(sttusSeCode=1)
 *      + 상호명 일치(공백 제거 비교) + 중개업자명(brkrNm) = 가입자 이름
 *
 * is_verified 쓰기는 guard 트리거(20260730_auto_verify_guard.sql)가 일반 사용자를
 * 차단하므로 service_role 클라이언트로 수행한다.
 *
 * env: PUBLICDATA_API_KEY(국세청), VWORLD_API_KEY(국토부), SUPABASE_SERVICE_ROLE_KEY
 */

// VWorld 키는 발급 시 등록한 도메인과 함께 호출해야 한다
const VWORLD_DOMAIN = 'bbabang.vercel.app'

const normName = (s: string | null | undefined) => (s ?? '').replace(/\s/g, '')

export async function POST() {
  const ntsKey = process.env.PUBLICDATA_API_KEY
  const vworldKey = process.env.VWORLD_API_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!ntsKey || !vworldKey || !serviceKey || !supabaseUrl) {
    return NextResponse.json({ error: 'config_missing' }, { status: 500 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const allowed = await checkRateLimit(`user:${user.id}:auto-verify`, 5, 3600)
  if (!allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  const [{ data: broker }, { data: profile }] = await Promise.all([
    supabase.from('broker_profiles')
      .select('id, is_owner, is_verified, office_name, office_reg_number, business_reg_number, verification_info')
      .eq('user_id', user.id).maybeSingle(),
    supabase.from('profiles').select('name').eq('id', user.id).maybeSingle(),
  ])
  if (!broker) return NextResponse.json({ error: 'no_broker_profile' }, { status: 404 })
  if (broker.is_owner === false) return NextResponse.json({ error: 'owner_only' }, { status: 403 })
  if (broker.is_verified) return NextResponse.json({ verified: true, already: true })

  const reasons: string[] = []

  // ── A. 국세청 사업자 상태조회 ─────────────────────────────
  const bn = (broker.business_reg_number ?? '').replace(/[^0-9]/g, '')
  let bizOk = false
  let bizStatus: Record<string, unknown> | null = null
  if (bn.length !== 10) {
    reasons.push('invalid_business_number')
  } else {
    try {
      const r = await fetch(
        `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(ntsKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ b_no: [bn] }),
          cache: 'no-store',
        },
      )
      const j = await r.json() as { data?: Array<Record<string, unknown>> }
      const row = j.data?.[0]
      bizStatus = row ?? null
      if (String(row?.b_stt_cd ?? '') === '01') bizOk = true
      else reasons.push('business_not_active')
    } catch {
      reasons.push('nts_unreachable')
    }
  }

  // ── B. 국토부 중개사무소 등록 조회 (VWorld) ────────────────
  const regNo = (broker.office_reg_number ?? '').trim()
  let officeOk = false
  let officeRecord: Record<string, unknown> | null = null
  if (!regNo) {
    reasons.push('missing_office_reg_number')
  } else {
    try {
      const url = `https://api.vworld.kr/ned/data/getEBOfficeInfo?key=${encodeURIComponent(vworldKey)}`
        + `&domain=${encodeURIComponent(VWORLD_DOMAIN)}&format=json&numOfRows=5&pageNo=1`
        + `&jurirno=${encodeURIComponent(regNo)}`
      const r = await fetch(url, { cache: 'no-store' })
      const j = await r.json() as { EDOffices?: { field?: Array<Record<string, unknown>> } }
      const rec = j.EDOffices?.field?.[0]
      officeRecord = rec ?? null
      if (!rec) {
        reasons.push('office_not_found')
      } else {
        const statusOk = String(rec.sttusSeCode ?? '') === '1'
        const nameOk = normName(String(rec.bsnmCmpnm ?? '')) === normName(broker.office_name)
        const ownerOk = normName(String(rec.brkrNm ?? '')) === normName(profile?.name)
        if (!statusOk) reasons.push('office_not_operating')
        if (!nameOk) reasons.push('office_name_mismatch')
        if (!ownerOk) reasons.push('owner_name_mismatch')
        officeOk = statusOk && nameOk && ownerOk
      }
    } catch {
      reasons.push('vworld_unreachable')
    }
  }

  // ── 판정·기록 ────────────────────────────────────────────
  const verified = bizOk && officeOk
  const admin = createAdminClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const merged = {
    ...((broker.verification_info as Record<string, unknown>) ?? {}),
    auto: {
      checked_at: new Date().toISOString(),
      verified,
      reasons,
      business: bizStatus,
      office: officeRecord,
    },
  }
  const update: Record<string, unknown> = { verification_info: merged }
  if (verified) update.is_verified = true
  const { error: upErr } = await admin.from('broker_profiles').update(update).eq('id', broker.id)
  if (upErr) {
    console.error('[auto-verify] update failed', upErr)
    return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  return NextResponse.json({ verified, reasons })
}
