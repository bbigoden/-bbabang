import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rate-limit'

const SEUM_BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService'

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

interface AutoFillBody {
  address?: string
  bcode?: string
  sigunguCd?: string
  bjdongCd?: string
  bun?: string
  ji?: string
  ho?: string
  platGbCd?: string
}

async function geocodeAddress(address: string): Promise<{ sigunguCd: string; bjdongCd: string; bun: string; ji: string } | null> {
  try {
    const key = (process.env.KAKAO_REST_KEY ?? '').trim()
    if (!key) return null
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}&analyze_type=similar`
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, next: { revalidate: 86400 } })
    if (!res.ok) {
      console.error('[geocode] kakao api error', res.status, res.statusText)
      return null
    }
    const json = await res.json().catch((e: unknown) => { console.error('[geocode] json parse error', e); return null })
    const doc = json?.documents?.[0]
    if (!doc) return null
    const bCode: string = doc.address?.b_code ?? ''
    if (bCode.length !== 10) return null
    return {
      sigunguCd: bCode.slice(0, 5),
      bjdongCd: bCode.slice(5),
      bun: doc.address?.main_address_no ?? '',
      ji: doc.address?.sub_address_no || '0',
    }
  } catch (e) {
    console.error('[geocode] unexpected error', e)
    return null
  }
}

interface SeumItem {
  [k: string]: string | number | undefined
}

async function fetchWithTimeout(url: string, timeoutMs = 20000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { cache: 'no-store', signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function callSeumPage(url: string, retries = 2): Promise<{ items?: { item?: unknown }; totalCount?: unknown } | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url)
      if (!res.ok) {
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
      const json = await res.json().catch(() => null)
      const body = json?.response?.body
      if (!body) {
        if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
      return body
    } catch {
      if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)))
    }
  }
  return null
}

async function callSeum(endpoint: string, params: Record<string, string>): Promise<SeumItem[]> {
  const PAGE_SIZE = 100
  const all: SeumItem[] = []

  for (let page = 1; page <= 100; page++) {
    const url = new URL(`${SEUM_BASE}/${endpoint}`)
    url.searchParams.set('serviceKey', process.env.SEUM_API_KEY ?? '')
    url.searchParams.set('numOfRows', String(PAGE_SIZE))
    url.searchParams.set('pageNo', String(page))
    url.searchParams.set('startDate', '')
    url.searchParams.set('endDate', '')
    url.searchParams.set('_type', 'json')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    const body = await callSeumPage(url.toString())
    if (!body) break
    const item = body?.items?.item
    if (!item) break
    const rows = Array.isArray(item) ? item : [item]
    all.push(...rows)
    if (all.length >= Number(body?.totalCount ?? 0) || rows.length < PAGE_SIZE) break
  }

  return all
}

const pad4 = (s: string) => String(s || '0').padStart(4, '0')

function mapRoomType(purps: string): string | null {
  const p = purps || ''
  if (p.includes('아파트') || p.includes('공동주택')) return '아파트'
  if (p.includes('오피스텔')) return '오피스텔'
  if (p.includes('다세대') || p.includes('연립')) return '빌라/연립'
  if (p.includes('단독주택') || p.includes('다가구')) return '단독주택'
  if (p.includes('업무')) return '사무실'
  if (p.includes('근린생활') || p.includes('판매') || p.includes('소매') || p.includes('교육연구') || p.includes('교육시설')) return '상가'
  if (p.includes('공장') || p.includes('창고') || p.includes('위험물')) return '창고/공장'
  return null
}

function formatDate(s: unknown): string | null {
  const str = String(s ?? '')
  if (str.length !== 8) return null
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`
}

const m2ToPyeong = (m2: number) => +(m2 / 3.305785).toFixed(2)

function parseFloor(item: SeumItem): number | null {
  const nm = String(item.flrNoNm ?? '')
  if (nm.includes('~')) return null  // 지하1층~지상8층 등 범위 표기는 단일 층 특정 불가
  if (String(item.flrGbCd ?? '') === '10' || nm.includes('지하')) {
    const n = nm.replace(/[^0-9]/g, '')
    return n ? -Number(n) : (Number(item.flrNo) > 0 ? -Number(item.flrNo) : -1)
  }
  return Number(nm.replace(/[^0-9-]/g, '')) || null
}

export async function POST(req: NextRequest) {
  if (!process.env.SEUM_API_KEY) {
    return NextResponse.json({ error: 'SEUM_API_KEY 미설정' }, { status: 500 })
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
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  // Rate limit: 사용자당 시간당 30회 (세움터 API quota 보호)
  const allowed = await checkRateLimit(`user:${user.id}:auto-fill`, 30, 3600)
  if (!allowed) {
    return NextResponse.json({ error: '자동채움 호출 횟수 제한을 초과했습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 })
  }

  let body: AutoFillBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 })
  }

  const { ho, platGbCd } = body
  let { sigunguCd, bjdongCd, bun, ji } = body

  if (body.bcode && body.bcode.length === 10 && !sigunguCd) {
    sigunguCd = body.bcode.slice(0, 5)
    bjdongCd = body.bcode.slice(5)
    if (!bun && body.address) {
      // "불당동 1421 101동" 처럼 동(棟)번호로 끝나는 경우 제거 후 본번 추출
      const addrForBun = body.address.trim().replace(/\s+\d+동\s*$/, '').trim()
      const m = addrForBun.match(/(\d+)(?:-(\d+))?\s*$/)
      if (m) { bun = m[1]; ji = m[2] || '0' }
    }
  } else if (body.address && (!sigunguCd || !bjdongCd || !bun)) {
    const geo = await geocodeAddress(body.address)
    if (!geo) return NextResponse.json({ error: '주소를 찾을 수 없습니다 (KAKAO_REST_KEY 확인 필요)' }, { status: 400 })
    sigunguCd = geo.sigunguCd
    bjdongCd = geo.bjdongCd
    bun = geo.bun
    ji = geo.ji
  }

  if (!sigunguCd || !bjdongCd || !bun) {
    return NextResponse.json({ error: '시군구·법정동·본번이 필요합니다' }, { status: 400 })
  }

  // 주소에서 동(棟)번호 추출 (101동, 102동 등) — 다동 건물 필터링용
  const dongFilterMatch = body.address?.match(/\b(\d+)동(?:\s|$)/)
  const dongFilter = dongFilterMatch ? `${dongFilterMatch[1]}동` : ''

  const addr = {
    sigunguCd,
    bjdongCd,
    platGbCd: platGbCd ?? '0',
    bun: pad4(bun),
    ji: pad4(ji ?? '0'),
  }
  // 동(棟)이 지정되면 세움터 API의 dongNm 파라미터로 직접 필터 → 페이지 fetching 대폭 감소
  const dongParam: Record<string, string> = dongFilter ? { dongNm: dongFilter } : {}

  try {
    let title = await callSeum('getBrTitleInfo', { ...addr, ...dongParam, regstrKindCd: '4' })
    if (title.length === 0) title = await callSeum('getBrTitleInfo', { ...addr, ...dongParam })
    if (title.length === 0) {
      return NextResponse.json({ error: '건축물대장을 찾을 수 없습니다' }, { status: 404 })
    }

    // 동번호가 지정된 경우 해당 동의 표제부 선택
    const t = (dongFilter ? title.find(x => String(x.dongNm ?? '') === dongFilter) : null) ?? title[0]
    const totalFloors = Number(t.grndFlrCnt) || null
    const approvalDate = formatDate(t.useAprDay)
    const calcParking = (row: SeumItem) =>
      (Number(row.indrAutoUtcnt) || 0)
      + (Number(row.oudrAutoUtcnt) || 0)
      + (Number(row.indrMechUtcnt) || 0)
      + (Number(row.oudrMechUtcnt) || 0)
    let parkingTotal = calcParking(t)
    // 일부 단지는 동별 표제부에 주차 정보 없음 → 단지 전체 표제부 max → 총괄표제부 순으로 fallback
    if (parkingTotal === 0 && dongFilter) {
      const allTitles = await callSeum('getBrTitleInfo', { ...addr, regstrKindCd: '4' })
      const allMax = allTitles.reduce((m, row) => Math.max(m, calcParking(row)), 0)
      if (allMax > 0) parkingTotal = allMax
    }
    if (parkingTotal === 0) {
      // 아파트 단지는 총괄표제부에 단지 전체 주차(실내+옥외) 들어있음
      const recap = await callSeum('getBrRecapTitleInfo', addr)
      const recapMax = recap.reduce((m, row) => Math.max(m, calcParking(row)), 0)
      if (recapMax > 0) parkingTotal = recapMax
    }
    const mainPurps = String(t.mainPurpsCdNm ?? '')
    const buildingName = String(t.bldNm ?? '').trim() || null

    let floor: number | null = null
    let areaM2 = 0
    let areaSuppliedM2 = 0  // 공급 = 전용 + 주거공용
    let yongdoNm = ''

    let expos = await callSeum('getBrExposPubuseAreaInfo', { ...addr, ...dongParam, regstrKindCd: '4' })
    if (expos.length === 0) expos = await callSeum('getBrExposPubuseAreaInfo', { ...addr, ...dongParam })

    if (expos.length > 0) {
      const num = (s: unknown): number => {
        const d = String(s ?? '').replace(/[^0-9]/g, '')
        return d ? Number(d) : 0
      }
      const hoInt = num(ho)
      const dongInt = num(dongFilter)
      const matchHo = (f: SeumItem) => num(f.hoNm) === hoInt
      const matchDong = (f: SeumItem) => dongInt === 0 || num(f.dongNm) === dongInt
      const RESIDENTIAL = ['벽체', '계단', '승강기', '복도', '현관', '엘리베이터']
      const isResidentialPublic = (f: SeumItem) => {
        if (String(f.exposPubuseGbCd ?? '') !== '2') return false
        const txt = `${f.etcPurps ?? ''} ${f.mainPurpsCdNm ?? ''}`
        return RESIDENTIAL.some(k => txt.includes(k))
      }

      let matched: SeumItem[] = []
      if (hoInt) {
        matched = expos.filter(f => matchHo(f) && matchDong(f))
        // 동 미지정 시에만 호만으로 매칭 (동 지정됐는데 매칭 실패면 폴백 X — 잘못된 데이터 차단)
        if (matched.length === 0 && dongInt === 0) {
          matched = expos.filter(matchHo)
        }
      }
      const target = matched.length > 0
        ? matched
        : expos.filter(f => f.flrGbCd === '20' && Number(f.flrNo) === 1 && matchDong(f))

      if (target.length > 0) {
        const exclusive = target.filter(f => f.exposPubuseGbCd === '1')
        areaM2 = exclusive.reduce((sum, f) => sum + (Number(f.area) || 0), 0)
        const areaResidential = target.filter(isResidentialPublic).reduce((sum, f) => sum + (Number(f.area) || 0), 0)
        areaSuppliedM2 = areaM2 + areaResidential
        // 층 정보는 전용면적 행 우선(공용 행은 flrNoNm이 "각층"으로 층수 미표기)
        const flrSource = exclusive.length > 0 ? exclusive[0] : target[0]
        floor = parseFloor(flrSource)
        yongdoNm = String(flrSource.mainPurpsCdNm ?? '')
      }
    } else {
      const flrs = await callSeum('getBrFlrOulnInfo', addr)
      const target = ho
        ? flrs.filter(f => String(f.flrNoNm ?? '').includes(ho))
        : flrs.filter(f => Number(f.flrNo) === 1)
      if (target.length > 0) {
        // 같은 지번에 여러 동이 있는 일반건축물: 면적 합산 (예: 1동 912㎡ + 2동 96㎡ = 1008㎡)
        areaM2 = target.reduce((sum, f) => sum + (Number(f.area) || 0), 0)
        floor = parseFloor(target[0])
        yongdoNm = String(target[0].mainPurpsCdNm ?? '')
      } else if (flrs.length > 0) {
        areaM2 = Number(flrs[0].area) || 0
        yongdoNm = String(flrs[0].mainPurpsCdNm ?? '')
      }
    }

    const sizePyeong = areaM2 > 0 ? m2ToPyeong(areaM2) : null
    const sizePyeongSupplied = areaSuppliedM2 > 0 ? m2ToPyeong(areaSuppliedM2) : null
    // ho 지정 시 해당 유닛 용도 우선, ho 없으면 건물 전체 용도(mainPurps) 우선
    const roomType = ho
      ? mapRoomType(yongdoNm) || mapRoomType(mainPurps)
      : mapRoomType(mainPurps) || mapRoomType(yongdoNm)

    return NextResponse.json({
      size_m2: areaM2 > 0 ? +areaM2.toFixed(2) : null,
      size_pyeong: sizePyeong,
      size_m2_supplied: areaSuppliedM2 > 0 ? +areaSuppliedM2.toFixed(2) : null,
      size_pyeong_supplied: sizePyeongSupplied,
      floor,
      total_floors: totalFloors,
      approval_date: approvalDate,
      parking: parkingTotal > 0 ? String(parkingTotal) : null,
      room_type: roomType,
      building_name: buildingName,
      main_purpose: mainPurps || null,
    })
  } catch (err) {
    console.error('[auto-fill] error', err)
    return NextResponse.json({ error: '세움터 호출 실패' }, { status: 502 })
  }
}
