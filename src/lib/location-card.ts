// 입지 카드 — 매물 소재지 하나로 토지·용도지역·건물·정화조·교통·주변 상권을 한 장에 모은다.
// 공장·창고·상가 상담에서 "이 땅에 뭘 지을 수 있나, 큰 차가 들어오나, IC 까지 얼마나"를 바로 답하려고 만들었다(11-06).
//
// 근거는 공공 원본만 쓴다 — 용도지역·지역지구는 브이월드 토지이용계획(토지이용규제정보서비스),
// 지목·면적·공시지가·도로접면은 브이월드 토지특성, 건물·정화조는 건축HUB 건축물대장, 거리는 카카오.
// 못 읽은 칸은 비워 둔다(추정해서 채우지 않는다). 거리는 직선거리, 차량 시간만 카카오 길찾기 실제 경로다.
//
// 11-06 2차: "기본적인 것뿐이라 광고에 쓸 게 없다"(사장님) — 상세설명·카페글에 바로 들어갈 재료를 더 받는다.
// 상가는 건물 내 입점 업종·반경 300m 업종 구성(소상공인 상가정보)·배후 아파트 세대수(건축물대장),
// 공장·창고·토지는 IC 차량 시간·같은 종류 실거래(국토부). 공공데이터포털 키는 모두 SEUM_API_KEY(같은 계정).

/** 매물 종류에 따라 받는 재료가 다르다 — 상가는 상권·배후 세대, 공장·창고·토지는 실거래·IC */
export type LocationKind = 'shop' | 'factory' | 'land' | 'other'

export function locationKindOf(roomType: string | null | undefined): LocationKind {
  const r = roomType ?? ''
  if (/공장|창고/.test(r)) return 'factory'
  if (/토지/.test(r)) return 'land'
  if (/상가|업무|근생|오피스|사무/.test(r)) return 'shop'
  return 'other'
}

export interface LocationDeps {
  seumKey: string
  kakaoKey: string
  vworldKey: string
  vworldDomain: string
}

export interface LocationTrade {
  date: string
  place: string
  use: string
  areaPyeong: number | null
  /** 만원 */
  amount: number
  /** 만원/평 */
  perPyeong: number | null
}

export interface LocationCard {
  kind: LocationKind
  address: string
  roadAddress: string | null
  pnu: string
  coord: { x: number; y: number }
  land: {
    jimok: string | null
    areaM2: number | null
    zoning: string | null
    zoning2: string | null
    officialPricePerM2: number | null
    priceYear: string | null
    roadSide: string | null
    shape: string | null
    slope: string | null
    useStatus: string | null
  } | null
  /** 토지이용계획에 걸린 지역·지구 이름 전부(중복 제거) */
  zones: string[]
  /** 그중 공장·창고·상가 상담에서 먼저 짚어야 할 것 */
  zoneAlerts: string[]
  buildings: {
    name: string | null
    purpose: string | null
    structure: string | null
    totalAreaM2: number | null
    heightM: number | null
    floorsAbove: number | null
    floorsBelow: number | null
    approvalDate: string | null
    /** 승용·비상용 승강기 합 */
    elevators: number | null
    /** 옥내외 자주식·기계식 주차 합 */
    parking: number | null
  }[]
  /** 집합건물(구분 소유) — 실거래를 전용면적으로 볼지 대지로 볼지 가른다 */
  collective: boolean
  septic: { mode: string; capacity: string }[]
  traffic: {
    /** driveMin·driveKm 는 카카오 길찾기 실제 경로(못 받으면 null) */
    ic: { name: string; distanceM: number; driveMin: number | null; driveKm: number | null }[]
    station: { name: string; distanceM: number } | null
  }
  /** 가장 가까운 초·중·고 하나씩 */
  schools: { kind: '초' | '중' | '고'; name: string; distanceM: number }[]
  nearby: { label: string; count: number }[]
  /** 상가만 — 소상공인 상가정보 */
  stores: {
    /** 이 필지(건물)에 등록된 업소 */
    inBuilding: { total: number; groups: { label: string; count: number; names: string[] }[] } | null
    /** 반경 300m 업종 묶음 */
    radius: { radiusM: number; total: number; groups: { label: string; count: number }[] } | null
  } | null
  /** 상가만 — 반경 1km 아파트(카카오 위치 + 건축물대장 세대수) */
  apartments: { radiusM: number; households: number; complexes: { name: string; households: number; year: string | null; distanceM: number }[] } | null
  /** 같은 종류 최근 1년 매매 실거래(국토부) */
  trades: {
    label: string
    /** 어디까지 모았나 — '불당동' 또는 '천안시 서북구 전체' */
    scope: string
    /** 평당 값의 기준 — 전용면적 / 대지면적 / 토지면적 */
    basis: string
    count: number
    /** 만원/평 */
    medianPerPyeong: number | null
    recent: LocationTrade[]
  } | null
  /** 조회하지 못한 원본 — 화면에 '못 읽음'으로 알린다 */
  missing: string[]
}

const SEUM_BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService'
const SDSC = 'https://apis.data.go.kr/B553077/api/open/sdsc2'
const DAY = 86400

/** 소재지 칸에서 지번(또는 도로명 번호)까지만 남긴다 — '319-2 2동 전체', '1535 303호', '296 5동-1' 의 뒤를 뗀다 */
export function cleanLocationAddress(raw: string): string {
  const tokens = raw.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    out.push(t)
    const prev = tokens[i - 1] ?? ''
    if (/^(산\s*)?\d+(-\d+)?(번지)?$/.test(t) && /(동|리|가|로|길|산)$/.test(prev) && i >= 2) break
  }
  return out.join(' ').replace(/번지$/, '')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function getJson(url: string, init?: RequestInit & { next?: { revalidate: number } }, timeoutMs = 15000): Promise<Json | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) return null
    return await res.json().catch(() => null)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const asRows = (v: unknown): Json[] => (v == null ? [] : Array.isArray(v) ? v : [v])
const num = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
const txt = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return s && s !== '지정되지않음' && s !== '.' ? s : null
}
const ymd = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : null
}

// 공장·창고·상가 상담에서 먼저 짚어야 하는 지역·지구. 이름에 이 말이 들어가면 알림으로 올린다.
// 가축사육제한구역은 뺐다 — 천안·아산은 시내 상가까지 거의 다 걸려 있어 알림이 늘 떠 의미가 없었다.
const ALERT_WORDS = [
  '개발제한구역', '공장설립', '성장관리', '농업진흥', '보전산지', '상수원', '수변구역', '군사', '비행안전',
  '문화재', '문화유산', '자연취락', '하천구역', '접도구역', '토지거래', '도시자연공원', '배출시설설치제한',
]

async function kakaoGeocode(address: string, key: string) {
  const j = await getJson(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}&analyze_type=similar`,
    { headers: { Authorization: `KakaoAK ${key}` }, next: { revalidate: DAY } })
  const d = j?.documents?.[0]
  const a = d?.address
  if (!a || String(a.b_code ?? '').length !== 10) return null
  return {
    bcode: String(a.b_code),
    san: a.mountain_yn === 'Y',
    bun: String(a.main_address_no || '0'),
    ji: String(a.sub_address_no || '0'),
    address: String(a.address_name ?? address),
    /** 실거래 umdNm 과 같은 꼴 — '불당동', '목천읍 운전리' */
    umd: String(a.region_3depth_name ?? '').trim(),
    roadAddress: d.road_address?.address_name ? String(d.road_address.address_name) : null,
    x: Number(d.x), y: Number(d.y),
  }
}

async function seum(key: string, endpoint: string, p: { bcode: string; san: boolean; bun: string; ji: string }) {
  const u = new URL(`${SEUM_BASE}/${endpoint}`)
  const q: Record<string, string> = {
    serviceKey: key, sigunguCd: p.bcode.slice(0, 5), bjdongCd: p.bcode.slice(5),
    platGbCd: p.san ? '1' : '0', bun: p.bun.padStart(4, '0'), ji: p.ji.padStart(4, '0'),
    numOfRows: '100', pageNo: '1', _type: 'json',
  }
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
  const j = await getJson(u.toString(), { next: { revalidate: DAY } }, 20000)
  const body = j?.response?.body
  if (!body) return null
  return asRows(body.items?.item)
}

async function vworld(key: string, domain: string, path: string, pnu: string, extra: Record<string, string> = {}) {
  const u = new URL(`https://api.vworld.kr/ned/data/${path}`)
  for (const [k, v] of Object.entries({ key, domain, format: 'json', numOfRows: '100', pageNo: '1', pnu, ...extra })) u.searchParams.set(k, v)
  return getJson(u.toString(), { next: { revalidate: DAY } })
}

async function kakaoNear(key: string, kind: 'keyword' | 'category', q: string, x: number, y: number, radius: number, page = 1) {
  const param = kind === 'keyword' ? `query=${encodeURIComponent(q)}` : `category_group_code=${q}`
  return getJson(`https://dapi.kakao.com/v2/local/search/${kind}.json?${param}&x=${x}&y=${y}&radius=${radius}&sort=distance&page=${page}`,
    { headers: { Authorization: `KakaoAK ${key}` }, next: { revalidate: DAY } })
}

/** 가까운 고속도로 IC 두 곳 — 'IC' 로 찾으면 'OOIC점' 편의점·다리까지 섞여 나와 분류가 IC 인 것만 고른다 */
async function nearestIC(key: string, x: number, y: number) {
  const found = new Map<string, { distanceM: number; x: number; y: number }>()
  for (const q of ['IC', '나들목']) {
    for (let page = 1; page <= 3; page++) {
      const j = await kakaoNear(key, 'keyword', q, x, y, 20000, page)
      for (const d of asRows(j?.documents)) {
        if (!/도로시설 > IC/.test(String(d.category_name ?? ''))) continue
        const name = String(d.place_name).replace(/\s*(하이패스|진출|진입|방면|방향).*$/, '')
        const dist = Number(d.distance)
        if (!found.has(name) || dist < found.get(name)!.distanceM) found.set(name, { distanceM: dist, x: Number(d.x), y: Number(d.y) })
      }
      if (j?.meta?.is_end !== false) break
    }
    if (found.size >= 2) break
  }
  return [...found.entries()].sort((a, b) => a[1].distanceM - b[1].distanceM).slice(0, 2).map(([name, v]) => ({ name, ...v }))
}

/** 카카오 길찾기 — 자동차 추천 경로의 시간·거리 */
async function driveTo(key: string, x: number, y: number, tx: number, ty: number): Promise<{ min: number; km: number } | null> {
  const j = await getJson(`https://apis-navi.kakaomobility.com/v1/directions?origin=${x},${y}&destination=${tx},${ty}&priority=RECOMMEND`,
    { headers: { Authorization: `KakaoAK ${key}` }, next: { revalidate: DAY } })
  const s = j?.routes?.[0]?.result_code === 0 ? j.routes[0].summary : null
  if (!s) return null
  return { min: Math.max(1, Math.round(Number(s.duration) / 60)), km: +(Number(s.distance) / 1000).toFixed(1) }
}

/** 가장 가까운 초·중·고 — 카카오 학교 분류(SC4)에서 이름 끝으로 가른다 */
async function nearestSchools(key: string, x: number, y: number) {
  const out: { kind: '초' | '중' | '고'; name: string; distanceM: number }[] = []
  for (let page = 1; page <= 3 && out.length < 3; page++) {
    const j = await kakaoNear(key, 'category', 'SC4', x, y, 3000, page)
    for (const d of asRows(j?.documents)) {
      const name = String(d.place_name).trim()
      const k = /초등학교$/.test(name) ? '초' : /중학교$/.test(name) ? '중' : /고등학교$/.test(name) ? '고' : null
      if (!k || out.some(o => o.kind === k)) continue
      out.push({ kind: k, name, distanceM: Number(d.distance) })
    }
    if (j?.meta?.is_end !== false) break
  }
  return out.sort((a, b) => a.distanceM - b.distanceM)
}

// 상가정보 업종 묶음 — 손님을 끄는 의료·약국은 따로, 교육은 하나로, 나머지는 중분류로 센다
function storeLabel(it: Json): string {
  const l = String(it.indsLclsNm ?? ''), m = String(it.indsMclsNm ?? ''), sc = String(it.indsSclsNm ?? '')
  if (sc.includes('약국')) return '약국'
  if (l === '보건의료') return sc.includes('치과') ? '치과' : sc.includes('한의원') ? '한의원' : m === '의원' ? '의원' : m
  if (l === '교육') return '학원·교육'
  // 상가정보 중분류 '비알코올' 은 카페·음료점이다 — 그대로 쓰면 광고 문안에 '비알코올 21' 로 찍힌다
  if (m.startsWith('비알코올')) return '카페'
  return m || l || '기타'
}

/** 상가 — 이 필지 안 업소와 반경 300m 업종 구성 */
async function storesAround(key: string, pnu: string, x: number, y: number): Promise<LocationCard['stores']> {
  const q = (path: string, extra: Record<string, string>) => {
    const u = new URL(`${SDSC}/${path}`)
    for (const [k, v] of Object.entries({ serviceKey: key, type: 'json', numOfRows: '1000', pageNo: '1', ...extra })) u.searchParams.set(k, v)
    return getJson(u.toString(), { next: { revalidate: DAY } }, 20000)
  }
  const [b, r] = await Promise.all([q('storeListInPnu', { key: pnu }), q('storeListInRadius', { radius: '300', cx: String(x), cy: String(y) })])
  if (!b?.body && !r?.body) return null

  let inBuilding: NonNullable<LocationCard['stores']>['inBuilding'] = null
  const bi = asRows(b?.body?.items)
  if (bi.length) {
    const g = new Map<string, string[]>()
    for (const it of bi) {
      const k = storeLabel(it)
      const nm = String(it.bizesNm ?? '').trim()
      g.set(k, [...(g.get(k) ?? []), nm])
    }
    inBuilding = {
      total: Number(b.body.totalCount ?? bi.length),
      groups: [...g.entries()].map(([label, names]) => ({ label, count: names.length, names: names.filter(Boolean).slice(0, 3) }))
        .sort((a, b) => b.count - a.count),
    }
  }

  let radius: NonNullable<LocationCard['stores']>['radius'] = null
  const ri = asRows(r?.body?.items)
  if (ri.length) {
    const total = Number(r.body.totalCount ?? ri.length)
    const g = new Map<string, number>()
    for (const it of ri) { const k = storeLabel(it); g.set(k, (g.get(k) ?? 0) + 1) }
    // 1000건을 넘으면 받은 만큼의 비율로 전체를 어림한다(순위·비중만 쓴다)
    const scale = total > ri.length ? total / ri.length : 1
    radius = {
      radiusM: 300, total,
      groups: [...g.entries()].map(([label, c]) => ({ label, count: Math.round(c * scale) })).sort((a, b) => b.count - a.count).slice(0, 8),
    }
  }
  return { inBuilding, radius }
}

/** 두 좌표 사이 직선거리(m) */
function meters(x1: number, y1: number, x2: number, y2: number) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (y2 - y1) * rad, dLng = (x2 - x1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(y1 * rad) * Math.cos(y2 * rad) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)))
}

/**
 * 배후 아파트 — 반경 1km 안 단지의 세대수 합.
 * 단지 위치는 카카오(아파트·관리사무소 검색 → 지번), 세대수는 그 지번의 건축물대장(총괄표제부)에서 읽는다.
 * K-apt 단지목록은 쓰지 않는다 — 천안 서북구가 233개뿐이고 불당지웰더샵조차 빠져 있었다(11-06).
 */
async function apartmentsAround(seumKey: string, kakaoKey: string, x: number, y: number): Promise<LocationCard['apartments']> {
  const RADIUS = 1000
  const spots = new Map<string, { name: string; address: string; distanceM: number }>()
  // 카카오 검색은 한 번에 45건까지라, 정문·관리사무소가 섞이면 단지가 몇 개만 남는다.
  // 반경을 네 칸(사분면)으로 나눠 칸마다 따로 찾고, 거리는 직접 재서 1km 밖은 버린다.
  const dLat = RADIUS / 111320, dLng = RADIUS / (111320 * Math.cos(y * Math.PI / 180))
  const rects = [[x - dLng, y - dLat, x, y], [x, y - dLat, x + dLng, y], [x - dLng, y, x, y + dLat], [x, y, x + dLng, y + dLat]]
  await Promise.all(rects.map(async ([x1, y1, x2, y2]) => {
    for (let page = 1; page <= 3; page++) {
      const j = await getJson(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent('아파트')}&rect=${x1},${y1},${x2},${y2}&page=${page}`,
        { headers: { Authorization: `KakaoAK ${kakaoKey}` }, next: { revalidate: DAY } })
      for (const d of asRows(j?.documents)) {
        const cat = String(d.category_name ?? '')
        const name = String(d.place_name ?? '')
        const apt = cat.trim() === '부동산 > 주거시설 > 아파트'
        const office = cat.includes('건물관리사무소') && /아파트|단지/.test(name)
        if (!apt && !office) continue
        const address = String(d.address_name ?? '').trim()
        if (!/\d/.test(address)) continue
        const dist = meters(x, y, Number(d.x), Number(d.y))
        if (dist > RADIUS) continue
        const prev = spots.get(address)
        // 이름은 아파트 분류 쪽을 쓴다(관리사무소 이름엔 '관리사무소'가 붙는다)
        if (!prev || (apt && /관리사무소|정문|후문|경비실/.test(prev.name))) {
          spots.set(address, { name: name.replace(/\s*(관리사무소|정문|후문|경비실)$/, ''), address, distanceM: Math.min(dist, prev?.distanceM ?? dist) })
        }
      }
      if (j?.meta?.is_end !== false) break
    }
  }))
  if (!spots.size) return { radiusM: RADIUS, households: 0, complexes: [] }

  const complexes: NonNullable<LocationCard['apartments']>['complexes'] = []
  let failed = 0
  await Promise.all([...spots.values()].slice(0, 60).map(async s => {
    const g = await kakaoGeocode(s.address, kakaoKey)
    if (!g) { failed++; return }
    // 총괄표제부(여러 동 단지)에 세대수 합이 있다. 동이 하나뿐인 단지는 총괄이 없어 표제부를 더한다.
    const recap = await seum(seumKey, 'getBrRecapTitleInfo', g)
    if (recap == null) { failed++; return }
    let households = recap.reduce((sum, r) => sum + (Number(r.hhldCnt) || 0), 0)
    let year = ymd(recap[0]?.useAprDay)?.slice(0, 4) ?? null
    if (!households) {
      const titles = await seum(seumKey, 'getBrTitleInfo', g)
      const homes = (titles ?? []).filter(t => /공동주택/.test(String(t.mainPurpsCdNm ?? '')))
      households = homes.reduce((sum, t) => sum + (Number(t.hhldCnt) || 0), 0)
      year = year ?? ymd(homes[0]?.useAprDay)?.slice(0, 4) ?? null
    }
    if (!households) return
    complexes.push({ name: s.name.replace(/아파트$/, '').trim(), households, year, distanceM: s.distanceM })
  }))
  if (!complexes.length && failed) return null
  complexes.sort((a, b) => a.distanceM - b.distanceM)
  return { radiusM: RADIUS, households: complexes.reduce((s, c) => s + c.households, 0), complexes }
}

/** 지난 12개월(이번 달 제외) 'YYYYMM' — 서버가 UTC 라 한국 날짜로 센다 */
function lastMonths(n: number): string[] {
  const [y, m] = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7).split('-').map(Number)
  const out: string[] = []
  for (let i = 1; i <= n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const h = Math.floor(s.length / 2)
  return Math.round(s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2)
}

/**
 * 같은 종류 최근 1년 매매 실거래 — 상가는 같은 동 근린·판매·업무(집합이면 집합끼리, 전용면적 평당),
 * 공장·창고는 시군구 전체 공장·창고(대지면적 평당), 토지는 같은 동(토지면적 평당).
 * 지분 거래·해제된 거래는 뺀다. 같은 동에 3건이 안 되면 시군구로 넓힌다.
 */
async function tradesNear(key: string, kind: LocationKind, sigungu: string, umd: string, collective: boolean): Promise<LocationCard['trades']> {
  const land = kind === 'land'
  // 공장·창고는 상업업무용과 다른 서비스다(공장 및 창고 등 부동산 매매) — 상업업무용에는 공장 거래가 없다
  const svc = land ? 'RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade'
    : kind === 'factory' ? 'RTMSDataSvcInduTrade/getRTMSDataSvcInduTrade'
    : 'RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade'
  const pages = await Promise.all(lastMonths(12).map(ym => getJson(
    `https://apis.data.go.kr/1613000/${svc}?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${sigungu}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=1&_type=json`,
    { next: { revalidate: DAY } }, 20000)))
  if (pages.every(p => !p?.response?.body)) return null
  const rows = pages.flatMap(p => asRows(p?.response?.body?.items?.item))
    .filter(r => String(r.cdealType ?? '').trim() !== 'O' && String(r.shareDealingType ?? '').trim() !== '지분')

  const shopCollective = kind === 'shop' && collective
  const pick = (r: Json) => {
    if (land) return true
    const use = String(r.buildingUse ?? '')
    // 공장·창고 서비스에는 지식산업센터 호실(집합, 대지면적 없음)과 동식물 관련시설도 섞여 온다 — 대지 평당으로 비교할 수 있는 일반 공장·창고만
    if (kind === 'factory') return /공장|창고/.test(use) && String(r.buildingType) !== '집합'
    if (!/근린|판매|업무/.test(use)) return false
    return collective ? String(r.buildingType) === '집합' : String(r.buildingType) !== '집합'
  }
  const areaOf = (r: Json) => Number(land ? r.dealArea : shopCollective ? r.buildingAr : r.plottageAr)
  const basis = land ? '토지면적' : shopCollective ? '전용면적' : '대지면적'

  const matched = rows.filter(pick)
  const sameUmd = kind === 'factory' ? [] : matched.filter(r => String(r.umdNm ?? '').trim() === umd)
  const local = sameUmd.length >= 3
  const use = local ? sameUmd : matched
  const scope = local ? umd : `${String(rows[0]?.sggNm ?? '시군구').trim()} 전체`

  const recent: LocationTrade[] = use.map(r => {
    const amount = Number(String(r.dealAmount ?? '').replace(/,/g, '')) || 0
    const a = areaOf(r)
    const areaPyeong = Number.isFinite(a) && a > 0 ? +(a / 3.305785).toFixed(1) : null
    return {
      date: `${r.dealYear}-${String(r.dealMonth).padStart(2, '0')}-${String(r.dealDay).padStart(2, '0')}`,
      place: `${String(r.umdNm ?? '').trim()} ${String(r.jibun ?? '').trim()}`.trim(),
      use: String(r.buildingUse ?? r.jimok ?? '').trim(),
      areaPyeong,
      amount,
      perPyeong: areaPyeong ? Math.round(amount / areaPyeong) : null,
    }
  }).filter(r => r.amount > 0).sort((a, b) => b.date.localeCompare(a.date))

  const label = land ? '토지 매매' : kind === 'factory' ? '공장·창고 매매' : collective ? '집합 상가 매매' : '상가건물 매매'
  return {
    label, scope, basis,
    count: recent.length,
    medianPerPyeong: median(recent.map(r => r.perPyeong).filter((n): n is number => n != null)),
    recent: recent.slice(0, 5),
  }
}

// 상가 상담용 — 반경 500m 안 점포 수. 카카오 분류 코드: FD6 음식점, CE7 카페, CS2 편의점, HP8 병원, AC5 학원
const NEARBY = [['FD6', '음식점'], ['CE7', '카페'], ['CS2', '편의점'], ['HP8', '병원'], ['AC5', '학원']] as const

export async function buildLocationCard(rawAddress: string, deps: LocationDeps, kind: LocationKind = 'other'): Promise<{ status: number; card?: LocationCard; error?: string }> {
  const address = cleanLocationAddress(rawAddress)
  if (!address) return { status: 400, error: 'address_required' }
  const g = await kakaoGeocode(address, deps.kakaoKey)
  if (!g) return { status: 404, error: 'geocode_failed' }
  const pnu = g.bcode + (g.san ? '2' : '1') + g.bun.padStart(4, '0') + g.ji.padStart(4, '0')
  const sigungu = g.bcode.slice(0, 5)
  const missing: string[] = []

  const [lc, lu, titles, wclf, icRaw, station, schools, stores, apartments, ...nearCounts] = await Promise.all([
    vworld(deps.vworldKey, deps.vworldDomain, 'getLandCharacteristics', pnu),
    vworld(deps.vworldKey, deps.vworldDomain, 'getLandUseAttr', pnu, { cnflcAt: '1' }),
    seum(deps.seumKey, 'getBrTitleInfo', g),
    seum(deps.seumKey, 'getBrWclfInfo', g),
    nearestIC(deps.kakaoKey, g.x, g.y),
    kakaoNear(deps.kakaoKey, 'category', 'SW8', g.x, g.y, 20000),
    nearestSchools(deps.kakaoKey, g.x, g.y),
    kind === 'shop' ? storesAround(deps.seumKey, pnu, g.x, g.y) : Promise.resolve(null),
    kind === 'shop' ? apartmentsAround(deps.seumKey, deps.kakaoKey, g.x, g.y) : Promise.resolve(null),
    ...NEARBY.map(([code]) => kakaoNear(deps.kakaoKey, 'category', code, g.x, g.y, 500)),
  ])

  // 토지특성 — 같은 필지가 해마다·고칠 때마다 한 줄씩 쌓여 온다. 가장 최근 기준연도·갱신일 것을 쓴다.
  const lcRows = asRows(lc?.landCharacteristicss?.field)
  if (!lc) missing.push('토지특성(브이월드)')
  const latest = lcRows.sort((a, b) => `${b.stdrYear}${b.lastUpdtDt}`.localeCompare(`${a.stdrYear}${a.lastUpdtDt}`))[0]
  const land = latest ? {
    jimok: txt(latest.lndcgrCodeNm),
    areaM2: num(latest.lndpclAr),
    zoning: txt(latest.prposArea1Nm),
    zoning2: txt(latest.prposArea2Nm),
    officialPricePerM2: num(latest.pblntfPclnd),
    priceYear: txt(latest.stdrYear),
    roadSide: txt(latest.roadSideCodeNm),
    shape: txt(latest.tpgrphFrmCodeNm),
    slope: txt(latest.tpgrphHgCodeNm),
    useStatus: txt(latest.ladUseSittnNm),
  } : null

  if (!lu) missing.push('토지이용계획(브이월드)')
  const zones = [...new Set(asRows(lu?.landUses?.field).map(r => txt(r.prposAreaDstrcCodeNm)).filter((s): s is string => !!s))]
  const zoneAlerts = zones.filter(z => ALERT_WORDS.some(w => z.includes(w)))

  if (titles == null) missing.push('건축물대장(세움터)')
  // 총괄표제부(regstrKindCd 1)는 동별 표제부와 겹친다 — 동이 따로 있으면 빼고, 없을 때만 쓴다
  const titleRows = titles ?? []
  const perDong = titleRows.filter(t => String(t.regstrKindCd) !== '1')
  const buildings = (perDong.length ? perDong : titleRows)
    .map(t => ({
      name: txt(t.dongNm) ? `${txt(t.dongNm)}${/동$/.test(String(t.dongNm).trim()) ? '' : '동'}` : txt(t.bldNm),
      purpose: txt(t.mainPurpsCdNm) ?? txt(t.etcPurps),
      structure: txt(t.strctCdNm) ?? txt(t.etcStrct),
      totalAreaM2: num(t.totArea),
      heightM: num(t.heit),
      floorsAbove: num(t.grndFlrCnt),
      floorsBelow: num(t.ugrndFlrCnt),
      approvalDate: ymd(t.useAprDay),
      elevators: num((Number(t.rideUseElvtCnt) || 0) + (Number(t.emgenUseElvtCnt) || 0)),
      parking: num(['indrAutoUtcnt', 'oudrAutoUtcnt', 'indrMechUtcnt', 'oudrMechUtcnt'].reduce((s, k) => s + (Number(t[k]) || 0), 0)),
    }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ko', { numeric: true }))
  // 집합건물 — 표제부 대장 종류가 집합(3)·전유부(4)
  const collective = titleRows.some(t => ['3', '4'].includes(String(t.regstrKindCd)) || String(t.regstrKindCdNm ?? '').includes('집합'))

  if (wclf == null) missing.push('정화조(세움터)')
  const septicSeen = new Set<string>()
  const septic: { mode: string; capacity: string }[] = []
  for (const w of wclf ?? []) {
    const mode = txt(w.modeCdNm) ?? txt(w.etcMode)
    if (!mode) continue
    // 정화조 용량은 처리대상 인원(인용) 또는 하루 처리량(㎥/일) 둘 중 하나로 적힌다
    // 하수종말처리장 연결은 개별 정화조가 없는 곳이다 — 용량 대신 그 사실만 한 줄로
    const sewer = mode.includes('하수종말처리')
    const capacity = sewer ? '공공하수도 연결(개별 정화조 없음)'
      : num(w.capaPsper) ? `${num(w.capaPsper)}인용` : num(w.capaLube) ? `${num(w.capaLube)}㎥/일` : '용량 기재 없음'
    const k = sewer ? 'sewer' : `${mode}|${capacity}`
    if (septicSeen.has(k)) continue
    septicSeen.add(k)
    septic.push({ mode, capacity })
  }

  // IC 차량 시간 — 직선거리는 강·산을 돌아가면 크게 틀린다. 카카오 길찾기 실제 경로로 다시 잰다.
  const [ic, trades] = await Promise.all([
    Promise.all(icRaw.map(async c => {
      const d = await driveTo(deps.kakaoKey, g.x, g.y, c.x, c.y)
      return { name: c.name, distanceM: c.distanceM, driveMin: d?.min ?? null, driveKm: d?.km ?? null }
    })),
    kind === 'other' ? Promise.resolve(null) : tradesNear(deps.seumKey, kind, sigungu, g.umd, collective).catch(() => null),
  ])
  if (kind !== 'other' && !trades) missing.push('실거래(국토부)')
  if (kind === 'shop' && !stores) missing.push('상가정보(소상공인)')
  if (kind === 'shop' && !apartments) missing.push('배후 아파트 세대수')

  const st = asRows(station?.documents)[0]
  const nearby = NEARBY.map(([, label], i) => ({ label, count: Number(nearCounts[i]?.meta?.total_count ?? NaN) }))
    .filter(n => Number.isFinite(n.count))
  if (!station && nearby.length === 0) missing.push('주변 시설(카카오)')

  return {
    status: 200,
    card: {
      kind,
      address: g.address,
      roadAddress: g.roadAddress,
      pnu,
      coord: { x: g.x, y: g.y },
      land,
      zones,
      zoneAlerts,
      buildings,
      collective,
      septic,
      traffic: {
        ic,
        station: st ? { name: String(st.place_name), distanceM: Number(st.distance) } : null,
      },
      schools,
      nearby,
      stores,
      apartments,
      trades,
      missing,
    },
  }
}
