import { NextRequest, NextResponse } from 'next/server'

const SEUM_BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService'

interface AutoFillBody {
  sigunguCd: string
  bjdongCd: string
  bun: string
  ji?: string
  ho?: string
  platGbCd?: string
}

interface SeumItem {
  [k: string]: string | number | undefined
}

async function callSeum(endpoint: string, params: Record<string, string>): Promise<SeumItem[]> {
  const url = new URL(`${SEUM_BASE}/${endpoint}`)
  url.searchParams.set('serviceKey', process.env.SEUM_API_KEY ?? '')
  url.searchParams.set('numOfRows', '1000')
  url.searchParams.set('pageNo', '1')
  url.searchParams.set('startDate', '')
  url.searchParams.set('endDate', '')
  url.searchParams.set('_type', 'json')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) return []
  const json = await res.json().catch(() => null)
  const item = json?.response?.body?.items?.item
  if (!item) return []
  return Array.isArray(item) ? item : [item]
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

  const { sigunguCd, bjdongCd, bun, ji, ho, platGbCd } = body
  if (!sigunguCd || !bjdongCd || !bun) {
    return NextResponse.json({ error: '시군구·법정동·본번이 필요합니다' }, { status: 400 })
  }

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

    const t = title[0]
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

    const expos = await callSeum('getBrExposPubuseAreaInfo', { ...addr, regstrKindCd: '4' })

    if (expos.length > 0) {
      const hoNorm = String(ho ?? '').trim()
      const matched = hoNorm
        ? expos.filter(f => String(f.hoNm ?? '').trim() === hoNorm)
        : []
      const target =
        matched.length > 0
          ? matched
          : expos.filter(f => f.flrGbCd === '20' && Number(f.flrNo) === 1)

      if (target.length > 0) {
        const exclusive = target.filter(f => f.exposPubuseGbCd === '1')
        areaM2 = exclusive.reduce((sum, f) => sum + (Number(f.area) || 0), 0)
        const flrStr = String(target[0].flrNoNm ?? '').replace(/[^0-9-]/g, '')
        floor = Number(flrStr) || null
        yongdoNm = String(target[0].mainPurpsCdNm ?? '')
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
