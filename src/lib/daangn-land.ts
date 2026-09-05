/**
 * 당근부동산(realty.daangn.com) 매물 조회.
 *
 * 당근도 네이버와 같다 — **화면에 최신순 정렬이 없다.** 필터를 끝까지 봐도(전체·
 * 매물종류·거래유형·평형·거래방식·층수·방개수·사용승인일), 목록에도, 서버가 받는
 * 필터 항목 21개에도 정렬 키가 없다.
 *
 * 다만 **목록이 '최근 활동순'** 이다. 매물번호가 대체로 내림차순인데 중간에 오래된
 * 번호가 섞인다 — 그게 끌올한 매물이다. 그래서 새 매물은 늘 앞쪽에 있고, 동마다
 * 앞의 몇 쪽만 받으면 된다.
 *
 * **당근은 날짜를 안 준다.** 응답에 등록일·수정일이 아예 없다. 언제 올라왔는지는
 * 우리가 처음 본 날로만 안다 — 네이버에서도 재등록 때문에 결국 그게 진짜 기준이었다.
 *
 * 서버에서는 못 부른다(네이버와 같은 이유). 사장님 PC의 광고 프로그램이 받아온다.
 *
 * **약점 하나 — 쿼리를 해시로 부른다.** 당근이 앱을 새로 배포해 쿼리가 바뀌면 해시가
 * 안 맞아 `PersistedQueryNotFound` 가 떨어지고 수집이 멈춘다. 조용히 0건이 되지
 * 않도록 그때는 분명한 오류로 알린다. 해시는 브라우저에서 다시 잡아 갈아끼우면 된다.
 */

const API = 'https://realty.kr.karrotmarket.com/graphql'

/** 요청 사이 간격. 네이버에서 몰아 부르다 막혀 봤다. 당근에도 같은 예의를 지킨다. */
const REQUEST_GAP_MS = 1_200

/** 한 동에서 받을 최대 쪽수. 새 매물은 앞쪽에 있으므로 깊이 갈 이유가 없다. */
const MAX_PAGES = 4

/** 한 쪽 건수. 화면이 쓰는 값 그대로. */
const PAGE_SIZE = 20

/**
 * 당근이 쓰는 쿼리 해시.
 *
 * 쿼리문 자체가 아니라 그 해시만 보내는 방식(persisted query)이다. **당근이 배포하면
 * 바뀔 수 있다.** 그때는 PersistedQueryNotFound 가 떨어지므로 바로 알 수 있다.
 *
 * 다시 잡는 법 — realty.daangn.com 지도를 열고 개발자도구 네트워크에서 graphql
 * 요청의 본문을 보면 `extensions.persistedQuery.sha256Hash` 가 있다.
 *   지역목록: 지도를 움직일 때 나가는, clusterType:"REGION" 이 든 요청
 *   매물목록: 동을 눌렀을 때 나가는, clusterId 가 든 요청
 */
const HASH = {
  /** 사각형 안의 동별 지역ID·이름·매물수 */
  regions: 'b7a44d54dd3cc584d7467d427cfa9d45d299615479acf6d7d8c24d28cb5060f1',
  /** 한 지역의 매물 목록 (커서 페이지네이션) */
  articles: '6372d5842a05f6a94d520e2045657c0661489faeab85ced23e504e5f0354b28c',
} as const

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

export type DaangnKind = keyof typeof DAANGN_KINDS

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

export function daangnTradeOf(code: string | null): string {
  return (DAANGN_TRADES as Record<string, string>)[code ?? ''] ?? (code ?? '')
}

/**
 * 감시 구역.
 *
 * 당근은 지도 사각형이 아니라 **동(지역ID)** 단위로 매물을 준다. 사각형은 그 동
 * 목록을 받아오는 데만 쓴다. 사각형이 시 경계보다 넓어 옆 동네가 딸려 오므로,
 * 받은 뒤 `division` 이 `divisionPrefix` 로 시작하는 것만 남긴다.
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
}

const HEADERS = {
  'content-type': 'application/json',
  accept: '*/*',
  origin: 'https://realty.daangn.com',
  referer: 'https://realty.daangn.com/',
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

/** 사각형 안의 동 목록. 지역ID·이름·매물수를 한 번에 준다. */
async function fetchRegions(searchBox: unknown): Promise<{ id: string; name: string; count: number }[]> {
  const data = await call(HASH.regions, {
    input: {
      clusterType: 'REGION',
      locationFilter: searchBox,
      propertyFilter: { salesTypes: salesTypes() },
      zoomLevel: 11,
    },
  })
  return (data?.articleClusters ?? [])
    .filter((c: any) => c?.originalId?.startsWith('REGION:') && c.count > 0)
    .map((c: any) => ({ id: c.originalId, name: c.name, count: c.count }))
}

/** 한 동의 매물 한 쪽. */
async function fetchPage(clusterId: string, after: string | null) {
  const data = await call(HASH.articles, {
    first: PAGE_SIZE,
    after,
    input: { clusterId, propertyFilter: { salesTypes: salesTypes() } },
  })
  const conn = data?.articleByClusterId
  return {
    rows: (conn?.edges ?? []).map((e: any) => e?.node?.article).filter(Boolean),
    cursor: conn?.pageInfo?.endCursor ?? null,
    hasNext: !!conn?.pageInfo?.hasNextPage,
  }
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
    writer_name: a.bizProfile?.name ?? a.writer?.nickname ?? null,
  }
}

/**
 * 감시 구역의 매물을 받는다.
 *
 * 동 목록을 먼저 받고(구역당 한 번), 동마다 앞의 몇 쪽을 훑는다. 목록이 최근
 * 활동순이라 새 매물은 앞에 있다 — 깊이 갈 이유가 없다.
 *
 * `onStep` 이 참을 돌려주면 그 자리에서 멈춘다. 받아 둔 것은 그대로 돌려준다.
 */
export async function fetchDaangnArticles(
  regions: readonly (typeof DAANGN_REGIONS)[number][],
  { onStep }: { onStep?: (done: number, total: number) => boolean | Promise<boolean> } = {},
): Promise<{ rows: DaangnArticle[]; areas: number; failed: string[]; stopped: boolean }> {
  const dongs: { id: string; name: string }[] = []
  const failed: string[] = []
  for (const region of regions) {
    try {
      for (const d of await fetchRegions(region.searchBox)) dongs.push(d)
    } catch (e) {
      if (e instanceof DaangnQueryStale) throw e
      failed.push(region.name)
    }
    await sleep(REQUEST_GAP_MS)
  }
  // 구역 사각형이 겹쳐 같은 동이 두 번 올 수 있다.
  const uniq = [...new Map(dongs.map(d => [d.id, d])).values()]

  const found = new Map<string, DaangnArticle>()
  let stopped = false
  for (let i = 0; i < uniq.length; i++) {
    try {
      let after: string | null = null
      let 우리것 = 0
      for (let page = 0; page < MAX_PAGES; page++) {
        await sleep(REQUEST_GAP_MS)
        const res: { rows: any[]; cursor: string | null; hasNext: boolean } = await fetchPage(uniq[i].id, after)
        for (const raw of res.rows) {
          const r = normalize(raw)
          // 사각형이 시 경계를 넘어 옆 동네가 섞여 온다. 감시 구역 것만 남긴다.
          if (r && regions.some(g => r.division?.startsWith(g.divisionPrefix))) { found.set(r.article_no, r); 우리것++ }
        }
        // **첫 쪽에 우리 지역 매물이 하나도 없으면 거기서 그만둔다.** 한 동에서 오는
        // 매물은 모두 그 동 것이므로, 첫 쪽이 전부 남의 동네면 그 동은 우리 동네가
        // 아니다. 사각형이 시 경계보다 넓어 옆 동네가 딸려 오는데, 그런 곳까지 네
        // 쪽씩 받으면 시간도 당근에 보내는 요청도 두 배가 된다 —
        // 실제로 150곳을 훑어 71곳만 남았다.
        if (page === 0 && 우리것 === 0) break
        if (!res.hasNext || !res.cursor) break
        after = res.cursor
      }
    } catch (e) {
      if (e instanceof DaangnQueryStale) throw e
      failed.push(uniq[i].name)
    }
    if (await onStep?.(i + 1, uniq.length)) { stopped = true; break }
  }

  return { rows: [...found.values()], areas: uniq.length, failed, stopped }
}
