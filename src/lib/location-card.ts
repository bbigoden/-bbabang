// 입지 카드 — 매물 소재지 하나로 토지·용도지역·건물·정화조·교통·주변 상권을 한 장에 모은다.
// 공장·창고·상가 상담에서 "이 땅에 뭘 지을 수 있나, 큰 차가 들어오나, IC 까지 얼마나"를 바로 답하려고 만들었다(11-06).
//
// 근거는 공공 원본만 쓴다 — 용도지역·지역지구는 브이월드 토지이용계획(토지이용규제정보서비스),
// 지목·면적·공시지가·도로접면은 브이월드 토지특성, 건물·정화조는 건축HUB 건축물대장, 거리는 카카오.
// 못 읽은 칸은 비워 둔다(추정해서 채우지 않는다). 거리는 모두 직선거리다.

export interface LocationDeps {
  seumKey: string
  kakaoKey: string
  vworldKey: string
  vworldDomain: string
}

export interface LocationCard {
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
  }[]
  septic: { mode: string; capacity: string }[]
  traffic: {
    ic: { name: string; distanceM: number }[]
    station: { name: string; distanceM: number } | null
  }
  nearby: { label: string; count: number }[]
  /** 조회하지 못한 원본 — 화면에 '못 읽음'으로 알린다 */
  missing: string[]
}

const SEUM_BASE = 'https://apis.data.go.kr/1613000/BldRgstHubService'
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

async function getJson(url: string, init?: RequestInit & { next?: { revalidate: number } }, timeoutMs = 15000): Promise<any | null> {
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

const asRows = (v: unknown): any[] => (v == null ? [] : Array.isArray(v) ? v : [v])
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
  const found = new Map<string, number>()
  for (const q of ['IC', '나들목']) {
    for (let page = 1; page <= 3; page++) {
      const j = await kakaoNear(key, 'keyword', q, x, y, 20000, page)
      for (const d of asRows(j?.documents)) {
        if (!/도로시설 > IC/.test(String(d.category_name ?? ''))) continue
        const name = String(d.place_name).replace(/\s*(하이패스|진출|진입|방면|방향).*$/, '')
        const dist = Number(d.distance)
        if (!found.has(name) || dist < found.get(name)!) found.set(name, dist)
      }
      if (j?.meta?.is_end !== false) break
    }
    if (found.size >= 2) break
  }
  return [...found.entries()].sort((a, b) => a[1] - b[1]).slice(0, 2).map(([name, distanceM]) => ({ name, distanceM }))
}

// 상가 상담용 — 반경 500m 안 점포 수. 카카오 분류 코드: FD6 음식점, CE7 카페, CS2 편의점, HP8 병원, AC5 학원
const NEARBY = [['FD6', '음식점'], ['CE7', '카페'], ['CS2', '편의점'], ['HP8', '병원'], ['AC5', '학원']] as const

export async function buildLocationCard(rawAddress: string, deps: LocationDeps): Promise<{ status: number; card?: LocationCard; error?: string }> {
  const address = cleanLocationAddress(rawAddress)
  if (!address) return { status: 400, error: 'address_required' }
  const g = await kakaoGeocode(address, deps.kakaoKey)
  if (!g) return { status: 404, error: 'geocode_failed' }
  const pnu = g.bcode + (g.san ? '2' : '1') + g.bun.padStart(4, '0') + g.ji.padStart(4, '0')
  const missing: string[] = []

  const [lc, lu, titles, wclf, ic, station, ...nearCounts] = await Promise.all([
    vworld(deps.vworldKey, deps.vworldDomain, 'getLandCharacteristics', pnu),
    vworld(deps.vworldKey, deps.vworldDomain, 'getLandUseAttr', pnu, { cnflcAt: '1' }),
    seum(deps.seumKey, 'getBrTitleInfo', g),
    seum(deps.seumKey, 'getBrWclfInfo', g),
    nearestIC(deps.kakaoKey, g.x, g.y),
    kakaoNear(deps.kakaoKey, 'category', 'SW8', g.x, g.y, 20000),
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
    }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ko', { numeric: true }))

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

  const st = asRows(station?.documents)[0]
  const nearby = NEARBY.map(([, label], i) => ({ label, count: Number(nearCounts[i]?.meta?.total_count ?? NaN) }))
    .filter(n => Number.isFinite(n.count))
  if (!station && nearby.length === 0) missing.push('주변 시설(카카오)')

  return {
    status: 200,
    card: {
      address: g.address,
      roadAddress: g.roadAddress,
      pnu,
      coord: { x: g.x, y: g.y },
      land,
      zones,
      zoneAlerts,
      buildings,
      septic,
      traffic: {
        ic,
        station: st ? { name: String(st.place_name), distanceM: Number(st.distance) } : null,
      },
      nearby,
      missing,
    },
  }
}
