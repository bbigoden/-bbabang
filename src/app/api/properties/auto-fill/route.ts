import { NextRequest, NextResponse } from 'next/server'

const SEUM_BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService'

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
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } })
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

async function callSeum(endpoint: string, params: Record<string, string>): Promise<SeumItem[]> {
  const PAGE_SIZE = 100
  const all: SeumItem[] = []

  for (let page = 1; page <= 20; page++) {
    const url = new URL(`${SEUM_BASE}/${endpoint}`)
    url.searchParams.set('serviceKey', process.env.SEUM_API_KEY ?? '')
    url.searchParams.set('numOfRows', String(PAGE_SIZE))
    url.searchParams.set('pageNo', String(page))
    url.searchParams.set('startDate', '')
    url.searchParams.set('endDate', '')
    url.searchParams.set('_type', 'json')
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

    const res = await fetch(url.toString(), { cache: 'no-store' })
    if (!res.ok) break
    const json = await res.json().catch(() => null)
    const body = json?.response?.body
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
  if (p.includes('아파트')) return '아파트'
  if (p.includes('오피스텔')) return '오피스텔'
  if (p.includes('다세대') || p.includes('연립')) return '빌라/연립'
  if (p.includes('업무')) return '사무실'
  if (p.includes('근린생활') || p.includes('판매') || p.includes('소매')) return '상가'
  return null
}

function formatDate(s: unknown): string | null {
  const str = String(s ?? '')
  if (str.length !== 8) return null
  return `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`
}

const m2ToPyeong = (m2: number) => +(m2 / 3.305785).toFixed(2)

export async function POST(req: NextRequest) {
  if (!process.env.SEUM_API_KEY) {
    return NextResponse.json({ error: 'SEUM_API_KEY 미설정' }, { status: 500 })
  }

  let body: AutoFillBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식' }, { status: 400 })
  }

  let { sigunguCd, bjdongCd, bun, ji, ho, platGbCd } = body

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

  try {
    let title = await callSeum('getBrTitleInfo', { ...addr, regstrKindCd: '4' })
    if (title.length === 0) title = await callSeum('getBrTitleInfo', addr)
    if (title.length === 0) {
      return NextResponse.json({ error: '건축물대장을 찾을 수 없습니다' }, { status: 404 })
    }

    // 동번호가 지정된 경우 해당 동의 표제부 선택
    const t = (dongFilter ? title.find(x => String(x.dongNm ?? '') === dongFilter) : null) ?? title[0]
    const totalFloors = Number(t.grndFlrCnt) || null
    const approvalDate = formatDate(t.useAprDay)
    const parkingTotal =
      (Number(t.indrAutoUtcnt) || 0) +
      (Number(t.oudrAutoUtcnt) || 0) +
      (Number(t.indrMechUtcnt) || 0) +
      (Number(t.oudrMechUtcnt) || 0)
    const mainPurps = String(t.mainPurpsCdNm ?? '')
    const buildingName = String(t.bldNm ?? '').trim() || null

    let floor: number | null = null
    let areaM2 = 0
    let yongdoNm = ''

    let expos = await callSeum('getBrExposPubuseAreaInfo', { ...addr, regstrKindCd: '4' })
    if (expos.length === 0) expos = await callSeum('getBrExposPubuseAreaInfo', addr)

    if (expos.length > 0) {
      const hoNorm = String(ho ?? '').replace(/호$/, '').trim()
      const matched = hoNorm
        ? expos.filter(f => {
            if (String(f.hoNm ?? '').replace(/호$/, '').trim() !== hoNorm) return false
            // 동번호가 지정된 경우 해당 동만 필터 (다동 건물 면적 중복 합산 방지)
            if (dongFilter) return String(f.dongNm ?? '') === dongFilter
            return true
          })
        : []
      const target =
        matched.length > 0
          ? matched
          : expos.filter(f => f.flrGbCd === '20' && Number(f.flrNo) === 1)

      if (target.length > 0) {
        const exclusive = target.filter(f => f.exposPubuseGbCd === '1')
        areaM2 = exclusive.reduce((sum, f) => sum + (Number(f.area) || 0), 0)
        // 층 정보는 전용면적 행 우선(공용 행은 flrNoNm이 "각층"으로 층수 미표기)
        const flrSource = exclusive.length > 0 ? exclusive[0] : target[0]
        const flrStr = String(flrSource.flrNoNm ?? '').replace(/[^0-9-]/g, '')
        floor = Number(flrStr) || null
        yongdoNm = String(flrSource.mainPurpsCdNm ?? '')
      }
    } else {
      const flrs = await callSeum('getBrFlrOulnInfo', addr)
      const target = ho
        ? flrs.filter(f => String(f.flrNoNm ?? '').includes(ho))
        : flrs.filter(f => Number(f.flrNo) === 1)
      if (target.length > 0) {
        areaM2 = Number(target[0].area) || 0
        const flrStr = String(target[0].flrNoNm ?? '').replace(/[^0-9-]/g, '')
        floor = Number(flrStr) || null
        yongdoNm = String(target[0].mainPurpsCdNm ?? '')
      } else if (flrs.length > 0) {
        areaM2 = Number(flrs[0].area) || 0
        yongdoNm = String(flrs[0].mainPurpsCdNm ?? '')
      }
    }

    const sizePyeong = areaM2 > 0 ? m2ToPyeong(areaM2) : null
    const roomType = mapRoomType(yongdoNm) || mapRoomType(mainPurps)

    return NextResponse.json({
      size_m2: areaM2 > 0 ? +areaM2.toFixed(2) : null,
      size_pyeong: sizePyeong,
      floor,
      total_floors: totalFloors,
      approval_date: approvalDate,
      parking: parkingTotal > 0 ? `${parkingTotal}대` : null,
      room_type: roomType,
      building_name: buildingName,
      main_purpose: mainPurps || null,
    })
  } catch (err) {
    console.error('[auto-fill] error', err)
    return NextResponse.json({ error: '세움터 호출 실패' }, { status: 502 })
  }
}
