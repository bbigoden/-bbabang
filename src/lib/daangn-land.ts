/**
 * 당근부동산(realty.daangn.com) 매물 조회.
 *
 * ## 새 매물을 어떻게 찾나
 *
 * **당근은 최신순을 주지 않는다.** 2026-09 개편 뒤로 지도 목록·동 첫 화면 목록 모두
 * 지도 위치순이고, 정렬 옵션도 받지 않는다. 날짜는 매물 상세에만 있는데 그것도
 * 끌올 시각이라 등록일이 아니다. 예전에는 목록이 '최근 활동순' 이라 동마다 앞의
 * 몇 쪽만 보면 됐는데, 이제 새 매물이 40쪽에 고르게 흩어진다(불당동에서 확인).
 * 그렇다고 전부 훑으면 천안·아산만 하루 1,000번 넘게 불러야 한다.
 *
 * 그래서 두 입구를 엮는다.
 *
 * 1. **사이트맵 = 문턱.** `sitemap-articles/1` 은 전국 매물 5만 건을 **번호 내림차순**
 *    으로 준다. 맨 앞 번호가 지금 가장 최근 매물이다. 지난번 맨 앞 번호보다 크면
 *    그 사이에 새로 올라온 것이다. 지역은 모르지만 '새 것' 의 기준은 정확하다.
 *
 * 2. **지도 칸 건수 = 어디에.** 지도는 매물을 작은 육각형 칸(한 변 60미터쯤)별 건수로
 *    준다. 지난번과 견줘 **건수가 늘어난 칸만** 열어 보고, 그 안에서 문턱보다 큰
 *    번호를 건진다.
 *
 * 같은 칸에서 하루에 하나 올라오고 하나 내려가면 건수가 그대로라 못 본다. 칸이
 * 아주 작아 드물다. 이 대가로 요청이 전부 훑기의 절반 아래로 준다.
 *
 * **사라짐 판정은 못 한다.** 늘어난 칸만 보므로, 안 본 매물이 내려갔는지 알 길이 없다.
 *
 * 서버에서는 못 부른다(네이버와 같은 이유). 사장님 PC의 광고 프로그램이 받아온다.
 *
 * ## 당근이 바꾸면 멈춘다
 *
 * 쿼리를 해시로 부르는 방식(persisted query)이라, 당근이 배포하면 해시·변수 모양·
 * 필요한 헤더가 바뀔 수 있다. 2026-09-09 께 실제로 셋 다 바뀌어 18일 동안 0건이었는데,
 * 결과가 `완료` 로 남아 아무도 몰랐다. 그래서 **못 받으면 반드시 던진다.**
 *
 * 다시 잡는 법 — realty.daangn.com/map/충청남도/천안시%20서북구/불당동 을 열고,
 * `window.fetch` 를 감싸 graphql 요청 본문을 모은다(요청이 스트림이라 네트워크 탭의
 * postData 로는 안 잡힌다). `articleClusters` 를 주는 것이 칸 건수, `articleFeed` +
 * `surface:"MAP"` 이 사각형 안 목록이다.
 */

const API = 'https://realty.kr.karrotmarket.com/graphql'
const SITEMAP = 'https://realty.daangn.com/sitemap-articles/1'

/** 요청 사이 간격. 네이버에서 몰아 부르다 막혀 봤다. 당근에도 같은 예의를 지킨다. */
const REQUEST_GAP_MS = 1_200

/** 한 쪽 건수. 당근이 20으로 못박는다 — 더 달라고 해도 20만 준다. */
const PAGE_SIZE = 20

/** 늘어난 칸 하나에서 받을 최대 쪽수. 칸이 작아 보통 1~4쪽이면 끝난다. */
const MAX_PAGES_PER_CELL = 10

/** 쿼리 해시. 다시 잡는 법은 맨 위에. */
const HASH = {
  /** 사각형 안 육각형 칸별 매물 수 */
  cells: 'a58cab672e69183bd6b12f51f08dea8f8d51af0bdfeedec579704460c362fbbe',
  /** 사각형 안 매물 목록 (커서 페이지네이션) */
  feed: 'fe0d66638e6508da75bd156a54a2f11624fdce3c575b06ff86f4ebfd8c3a31e3',
} as const

/**
 * 칸 건수를 받을 때 한 번에 보는 넓이(도).
 *
 * **당근은 넓이로 끊는다.** 0.07×0.05 까지는 칸을 주는데 0.1×0.08 부터는 한적한
 * 곳에서도 아무것도 안 준다. 넉넉히 작게 잡아, 0칸이 오면 '정말 비었다' 로 믿을 수
 * 있게 한다. 붐비는 곳이 조용히 0칸으로 읽히면 새 매물을 통째로 놓친다.
 */
const TILE = { lon: 0.06, lat: 0.045 }

/** 칸 크기. 10 이면 한 변 60미터쯤 — 칸마다 매물이 수십 건 아래로 든다. */
const CELL_ZOOM = 10

/**
 * 늘어난 칸을 열 때 둘레로 더 보는 넓이(도).
 *
 * 당근은 공개 좌표를 일부러 흐린다(실제로 100미터쯤 밀린 것을 봤다). 칸 딱 그만큼만
 * 열면 흐려진 좌표 때문에 그 칸에 셈해진 매물이 사각형 밖으로 빠질 수 있다.
 */
const CELL_MARGIN = { lon: 0.0015, lat: 0.0012 }

/**
 * 매물유형 — **당근 화면과 똑같이 나눈다.**
 *
 * 당근 필터의 비주거 항목 그대로다. 우리가 따로 나누면 당근에서 보던 것과 건수가
 * 어긋나 어느 쪽이 맞는지 알 수 없게 된다.
 */
export const DAANGN_KINDS = {
  상가: 'STORE',
  사무실: 'OFFICE',
  건물: 'BUILDING',
  '공장/창고': 'FACTORY',
  토지: 'LAND',
} as const

const KIND_BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(DAANGN_KINDS).map(([k, v]) => [v, k]),
)

/** 이 매물을 당근은 뭐라고 부르는가. 모르는 코드는 코드 그대로 보여준다. */
export function daangnKindOf(code: string): string {
  return KIND_BY_CODE[code] ?? code
}

/** 거래유형 코드 → 이름. 당근이 쓰는 값 그대로. */
export const DAANGN_TRADES = {
  BUY: '매매',
  YEAR: '전세',
  MONTH: '월세',
  SHORT: '단기',
} as const

/**
 * 감시 구역.
 *
 * 사각형을 합쳐 칸 받기 좋은 크기로 잘라 쓴다. 사각형이 시 경계보다 넓어 옆 동네가
 * 딸려 오므로, 받은 뒤 `division` 이 `divisionPrefix` 로 시작하는 것만 남긴다.
 */
export const DAANGN_REGIONS = [
  {
    id: 'cheonan-dongnam',
    name: '천안시 동남구',
    divisionPrefix: '천안시 동남구',
    searchBox: { neCoordinate: { lat: '36.87', lon: '127.45' }, swCoordinate: { lat: '36.62', lon: '127.10' } },
  },
  {
    id: 'cheonan-seobuk',
    name: '천안시 서북구',
    divisionPrefix: '천안시 서북구',
    searchBox: { neCoordinate: { lat: '37.03', lon: '127.24' }, swCoordinate: { lat: '36.75', lon: '127.03' } },
  },
  {
    id: 'asan',
    name: '아산시',
    divisionPrefix: '아산시',
    searchBox: { neCoordinate: { lat: '37.00', lon: '127.15' }, swCoordinate: { lat: '36.69', lon: '126.83' } },
  },
] as const

/** 화면에서 쓰는 매물 한 건. 표의 열과 이름을 맞춰 둔다. */
export type DaangnArticle = {
  article_no: string
  sales_type: string
  trade_type: string | null
  division: string | null
  sector: string | null
  writer_name: string | null
  area_exclusive: number | null
  area_supply: number | null
  area_land: number | null
  area_floor: number | null
  price_deal: number | null
  price_deposit: number | null
  price_rent: number | null
  /** 층. 네이버와 같은 모양 — "1/5" = 해당층/전체층, 전체층을 모르면 "1" */
  floor_info: string | null
}

/**
 * 다음 회차로 넘기는 기억.
 *
 * - `문턱` — 지난번 사이트맵 맨 앞 번호. 이보다 크면 그 뒤에 올라온 매물이다.
 * - `칸` — 지난번 칸별 건수. 이보다 늘어난 칸만 연다.
 */
export type DaangnState = { 문턱: number; 칸: Record<string, number>; at: string }

const HEADERS = {
  'content-type': 'application/json',
  accept: '*/*',
  'accept-language': 'ko-KR',
  origin: 'https://realty.daangn.com',
  referer: 'https://realty.daangn.com/',
  // **이게 없으면 403 이다.** 2026-09 개편 때 생겼다 — 웹 화면이 늘 보내는 값이다.
  'x-realty-platform': 'realty-web',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 해시가 안 맞아 수집이 멈춘 것인지 부르는 쪽이 알 수 있어야 한다. */
export class DaangnQueryStale extends Error {
  constructor() {
    super('당근이 바뀌어 받아올 수 없습니다 (쿼리 해시가 안 맞습니다)')
    this.name = 'DaangnQueryStale'
  }
}

async function call(hash: string, variables: Record<string, unknown>): Promise<any> {
  const body = JSON.stringify({ variables, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } })
  const res = await fetch(API, { method: 'POST', headers: HEADERS, body })
  if (!res.ok) throw new Error(`당근 응답 ${res.status}`)
  const json = await res.json()
  if (json?.errors?.length) {
    const code = json.errors[0]?.extensions?.code
    if (code === 'PERSISTED_QUERY_NOT_IN_LIST' || code === 'PERSISTED_QUERY_NOT_FOUND') throw new DaangnQueryStale()
    throw new Error(`당근 거절: ${String(json.errors[0]?.message ?? '알 수 없음').slice(0, 80)}`)
  }
  return json.data
}

const salesTypes = () => Object.values(DAANGN_KINDS)

type Box = { n: number; s: number; e: number; w: number }
const 좌표 = (b: Box) => ({
  neCoordinate: { lat: String(b.n), lon: String(b.e) },
  swCoordinate: { lat: String(b.s), lon: String(b.w) },
})

/**
 * 사이트맵 맨 앞 번호와, 지난 문턱 뒤로 전국에서 몇 건이 새로 올라왔는가.
 *
 * 5MB 짜리를 다 받지 않는다. 번호 내림차순이라 **문턱 아래로 내려가는 순간 멈춘다.**
 * 하루치면 앞의 1MB 남짓이다. 처음이면 맨 앞 하나만 읽고 멈춘다.
 */
async function 문턱읽기(이전: number | null): Promise<{ 맨앞: number; 전국새번호: number }> {
  const res = await fetch(SITEMAP, { headers: { 'user-agent': HEADERS['user-agent'] } })
  if (!res.ok || !res.body) throw new Error(`당근 사이트맵을 못 읽었습니다 (${res.status})`)
  const reader = res.body.getReader()
  const 풀기 = new TextDecoder()
  const 찾기 = /<loc>[^<]*\/articles\/(\d+)<\/loc>/g
  let 남은글 = ''
  let 맨앞 = 0
  let 새번호 = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      남은글 += 풀기.decode(value, { stream: true })
      찾기.lastIndex = 0
      let 읽은곳 = 0
      let m: RegExpExecArray | null
      while ((m = 찾기.exec(남은글))) {
        const no = Number(m[1])
        읽은곳 = 찾기.lastIndex
        if (!맨앞) 맨앞 = no
        if (이전 === null || no <= 이전) return { 맨앞, 전국새번호: 새번호 }
        새번호++
      }
      // 조각 끝에 걸친 반쪽 태그는 다음 조각과 이어 읽는다.
      남은글 = 남은글.slice(읽은곳)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  if (!맨앞) throw new Error('당근 사이트맵에 매물 번호가 없습니다 — 당근이 바뀌었을 수 있습니다')
  return { 맨앞, 전국새번호: 새번호 }
}

/** 감시 구역 전체를 칸 받기 좋은 크기로 자른다. 구역 사각형들을 한데 묶어 겹침을 없앤다. */
function 조각내기(regions: readonly (typeof DAANGN_REGIONS)[number][]): Box[] {
  const 합 = regions.reduce<Box>((a, r) => ({
    n: Math.max(a.n, Number(r.searchBox.neCoordinate.lat)),
    e: Math.max(a.e, Number(r.searchBox.neCoordinate.lon)),
    s: Math.min(a.s, Number(r.searchBox.swCoordinate.lat)),
    w: Math.min(a.w, Number(r.searchBox.swCoordinate.lon)),
  }), { n: -90, e: -180, s: 90, w: 180 })
  const 조각: Box[] = []
  for (let s = 합.s; s < 합.n; s += TILE.lat) {
    for (let w = 합.w; w < 합.e; w += TILE.lon) {
      조각.push({ s, w, n: Math.min(s + TILE.lat, 합.n), e: Math.min(w + TILE.lon, 합.e) })
    }
  }
  return 조각
}

type Cell = { count: number; lat: number; lon: number }

async function 칸받기(box: Box): Promise<Record<string, Cell>> {
  const data = await call(HASH.cells, {
    input: { locationFilter: 좌표(box), propertyFilter: { salesTypes: salesTypes() }, zoomLevel: CELL_ZOOM },
  })
  const out: Record<string, Cell> = {}
  for (const c of data?.articleClusters ?? []) {
    if (!c?.originalId || !c.count) continue
    out[c.originalId] = { count: c.count, lat: Number(c.coordinate?.lat), lon: Number(c.coordinate?.lon) }
  }
  return out
}

async function 목록받기(box: Box): Promise<any[]> {
  const rows: any[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES_PER_CELL; page++) {
    const data = await call(HASH.feed, {
      first: PAGE_SIZE, after,
      input: { locationFilter: 좌표(box), propertyFilter: { salesTypes: salesTypes() }, surface: 'MAP' },
    })
    const feed = data?.articleFeed
    for (const e of feed?.edges ?? []) if (e?.node?.article) rows.push(e.node.article)
    if (!feed?.pageInfo?.hasNextPage || !feed?.pageInfo?.endCursor) break
    after = feed.pageInfo.endCursor
    await sleep(REQUEST_GAP_MS)
  }
  return rows
}

/** 층을 네이버와 같은 모양으로. 당근은 "1.0" · "-1.0" 처럼 소수로 준다. */
function 층글(floor: unknown, top: unknown): string | null {
  if (floor === null || floor === undefined || floor === '') return null
  const f = Math.round(Number(floor))
  if (!Number.isFinite(f)) return null
  const t = top === null || top === undefined || top === '' ? null : Math.round(Number(top))
  return t && Number.isFinite(t) ? `${f}/${t}` : String(f)
}

/** 응답 한 건을 표의 한 행으로. */
function normalize(a: any): DaangnArticle | null {
  if (!a?.originalId) return null
  // trades 는 여럿일 수 있다. 화면이 앞세우는 것(preferred)을 쓴다.
  const trade = (a.trades ?? []).find((t: any) => t?.preferred) ?? (a.trades ?? [])[0]
  return {
    article_no: String(a.originalId),
    sales_type: a.salesTypeV3?.type ?? 'ETC',
    trade_type: trade?.type ?? null,
    division: a.region?.name2 ?? null,
    sector: a.region?.name3 ?? a.region?.name ?? null,
    // 목록의 bizProfile 에는 이름이 없다. 닉네임이 온다 — 우리 사무소는 '불당부동산은용소장'.
    writer_name: a.bizProfile?.name ?? a.writer?.nickname ?? null,
    // 당근은 면적을 글자로, 가격을 **만원**으로 준다. 거래 종류마다 이름이 달라
    // (매매는 price, 전세·월세는 deposit) 있는 쪽을 집는다.
    area_exclusive: Number(a.area) || null,
    area_supply: Number(a.supplyArea) || null,
    // 당근은 대지·연면적을 따로 주지 않는다. 토지도 `area` 하나뿐이다.
    area_land: null,
    area_floor: null,
    price_deal: trade?.type === 'BUY' ? (trade?.price ?? trade?.deposit ?? null) : null,
    price_deposit: trade?.type === 'BUY' ? null : (trade?.deposit ?? trade?.price ?? null),
    price_rent: trade?.monthlyPay ?? null,
    floor_info: 층글(a.floor, a.topFloor),
  }
}

/**
 * 지난번 뒤로 새로 올라온 감시 구역 매물을 받는다.
 *
 * `이전` 이 없으면(처음이거나 기억을 잃었으면) **기준만 잡고 매물은 안 받는다.**
 * 그때 늘어난 칸을 따지면 모든 칸이 늘어난 것이 되어 구역 전체를 훑게 된다 —
 * 하루 1,000번이 넘는 요청이다. 다음 회차부터 새 것이 들어온다.
 *
 * `상태` 는 **끝까지 다 봤을 때만** 돌려준다. 중간에 멈추고 새 건수를 기억하면,
 * 못 연 칸의 새 매물을 영영 놓친다.
 */
export async function fetchDaangnArticles(
  regions: readonly (typeof DAANGN_REGIONS)[number][],
  { 이전, onStep }: {
    이전?: DaangnState | null
    onStep?: (done: number, total: number) => boolean | Promise<boolean>
  } = {},
): Promise<{
  rows: DaangnArticle[]
  상태: DaangnState | null
  stopped: boolean
  통계: { 전국새번호: number; 칸수: number; 늘어난칸: number; 첫회: boolean }
}> {
  const { 맨앞, 전국새번호 } = await 문턱읽기(이전?.문턱 ?? null)
  // 사이트맵이 늦게 갱신돼 지난번보다 작게 나올 수 있다. 문턱을 내리지는 않는다.
  const 문턱 = Math.max(맨앞, 이전?.문턱 ?? 0)

  const 칸: Record<string, Cell> = {}
  const 조각 = 조각내기(regions)
  let 못받음 = 0
  for (const box of 조각) {
    try {
      Object.assign(칸, await 칸받기(box))
    } catch (e) {
      if (e instanceof DaangnQueryStale) throw e
      // 한 번은 다시 해 본다. 잠깐 튄 것 하나로 회차를 버리기는 아깝다.
      await sleep(REQUEST_GAP_MS * 3)
      try { Object.assign(칸, await 칸받기(box)) } catch { 못받음++ }
    }
    await sleep(REQUEST_GAP_MS)
  }
  // **못 본 자리가 있으면 이번 회차는 버린다.** 그 자리의 칸이 빠진 채로 기억하면,
  // 다음번에 그 칸들이 전부 '늘어난 칸' 이 되어 구역을 통째로 훑게 된다.
  if (못받음) throw new Error(`당근 지도 ${조각.length}조각 중 ${못받음}조각을 못 받았습니다`)
  const 칸수 = Object.keys(칸).length
  if (!칸수) throw new Error('당근 지도에서 칸을 하나도 못 받았습니다 — 당근이 바뀌었을 수 있습니다')

  const 새상태: DaangnState = {
    문턱,
    칸: Object.fromEntries(Object.entries(칸).map(([id, c]) => [id, c.count])),
    at: new Date().toISOString(),
  }
  if (!이전) {
    return { rows: [], 상태: 새상태, stopped: false, 통계: { 전국새번호, 칸수, 늘어난칸: 0, 첫회: true } }
  }

  const 늘어난 = Object.entries(칸)
    .filter(([id, c]) => c.count > (이전.칸[id] ?? 0))
    .map(([, c]) => c)
  const found = new Map<string, DaangnArticle>()
  let stopped = false
  for (let i = 0; i < 늘어난.length; i++) {
    const c = 늘어난[i]
    const box: Box = {
      n: c.lat + CELL_MARGIN.lat, s: c.lat - CELL_MARGIN.lat,
      e: c.lon + CELL_MARGIN.lon, w: c.lon - CELL_MARGIN.lon,
    }
    for (const raw of await 목록받기(box)) {
      const r = normalize(raw)
      if (!r || Number(r.article_no) <= 이전.문턱) continue
      // 사각형이 시 경계를 넘어 옆 동네가 섞여 온다. 감시 구역 것만 남긴다.
      if (regions.some(g => r.division?.startsWith(g.divisionPrefix))) found.set(r.article_no, r)
    }
    await sleep(REQUEST_GAP_MS)
    if (await onStep?.(i + 1, 늘어난.length)) { stopped = true; break }
  }

  return {
    rows: [...found.values()],
    상태: stopped ? null : 새상태,
    stopped,
    통계: { 전국새번호, 칸수, 늘어난칸: 늘어난.length, 첫회: false },
  }
}
